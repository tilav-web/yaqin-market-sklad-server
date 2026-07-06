import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';

import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import type { EnvironmentVariables } from '../config/configuration';
import { Order } from '../orders/entities/order.entity';
import { RedisService } from '../redis/redis.service';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';

/**
 * Single Socket.IO gateway for customer + seller real-time updates.
 *
 * Auth: the client passes its access token via `handshake.auth.token` (or the
 * `Authorization` header). On connect we verify it and join the socket to a
 * personal room `user:{userId}`. Sellers additionally join `shop:{shopId}`
 * rooms when they emit `join:shop` (validated elsewhere by REST permissions).
 *
 * Emitting is done through {@link emitToUser} / {@link emitToShop}, called by
 * domain services (e.g. OrdersService) — this gateway holds no business logic.
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(ShopStaff)
    private readonly staff: Repository<ShopStaff>,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    private readonly redis: RedisService,
  ) {}

  /** Only the shop owner or an active staff member may watch a shop's stream. */
  private async canWatchShop(userId: string, shopId: string): Promise<boolean> {
    const shop = await this.shops.findOne({ where: { id: shopId }, select: { id: true, ownerId: true } });
    if (!shop) return false;
    if (shop.ownerId === userId) return true;
    const member = await this.staff.findOne({ where: { shopId, userId, isActive: true } });
    return !!member;
  }

  /** Only the customer who placed the order, the shop owner, or active shop staff may watch it. */
  private async canWatchOrder(userId: string, orderId: string): Promise<boolean> {
    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: { shop: true },
      select: { id: true, userId: true, shopId: true, shop: { id: true, ownerId: true } },
    });
    if (!order) return false;
    if (order.userId === userId || order.shop.ownerId === userId) return true;
    const member = await this.staff.findOne({ where: { shopId: order.shopId, userId, isActive: true } });
    return !!member;
  }

  /** True only if `userId` is the staff member currently assigned to deliver this order. */
  private async isAssignedCourier(userId: string, orderId: string): Promise<boolean> {
    const order = await this.orders.findOne({
      where: { id: orderId },
      select: { id: true, assignedStaffId: true },
    });
    if (!order?.assignedStaffId) return false;
    const member = await this.staff.findOne({
      where: { id: order.assignedStaffId, userId, isActive: true },
    });
    return !!member;
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        client.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (!token) {
        client.disconnect(true);
        return;
      }
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.get('JWT_SECRET', { infer: true }),
      });
      client.data.userId = payload.sub;
      await client.join(`user:${payload.sub}`);

      // Sellers/staff ask to subscribe to a shop's order stream — only the
      // owner or an active staff member is allowed into the room.
      client.on('join:shop', (shopId: unknown) => {
        if (typeof shopId !== 'string' || shopId.length === 0) return;
        void this.canWatchShop(payload.sub, shopId).then((ok) => {
          if (ok) void client.join(`shop:${shopId}`);
        });
      });
      client.on('leave:shop', (shopId: unknown) => {
        if (typeof shopId === 'string') void client.leave(`shop:${shopId}`);
      });

      // Customer subscribes to an order's real-time stream (courier location, etc.)
      // Only a party to the order (customer, shop owner, or active shop staff) may join.
      client.on('join:order', (orderId: unknown) => {
        if (typeof orderId !== 'string' || orderId.length === 0) return;
        void this.canWatchOrder(payload.sub, orderId).then((ok) => {
          if (ok) void client.join(`order:${orderId}`);
        });
      });
      client.on('leave:order', (orderId: unknown) => {
        if (typeof orderId === 'string') void client.leave(`order:${orderId}`);
      });

      // Courier (staff) emits location while delivering — only the staff member
      // actually assigned to this order may push/broadcast its GPS position.
      client.on('courier:location', (data: unknown) => {
        if (
          typeof data !== 'object' || data === null ||
          !('orderId' in data) || !('lat' in data) || !('lng' in data)
        ) return;
        const { orderId, lat, lng } = data as { orderId: string; lat: number; lng: number };
        if (typeof orderId !== 'string' || typeof lat !== 'number' || typeof lng !== 'number') return;

        void this.isAssignedCourier(payload.sub, orderId).then((ok) => {
          if (!ok) return;
          const locationPayload = { lat, lng, updatedAt: new Date().toISOString() };
          // Cache in Redis for 60s so latecomers can GET it via REST
          void this.redis.client.set(
            `courier:location:${orderId}`,
            JSON.stringify(locationPayload),
            'EX',
            60,
          );
          // Broadcast to everyone watching this order (customer, etc.)
          this.server.to(`order:${orderId}`).emit('courier:location', locationPayload);
        });
      });
    } catch {
      client.disconnect(true);
    }
  }

  /** Push an event to a single user's devices (all their connected sockets). */
  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  /** Push an event to everyone watching a shop (owner + staff devices). */
  emitToShop(shopId: string, event: string, payload: unknown): void {
    this.server?.to(`shop:${shopId}`).emit(event, payload);
  }
}
