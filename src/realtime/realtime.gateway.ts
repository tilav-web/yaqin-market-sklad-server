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
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';

/**
 * Single Socket.IO gateway for customer + seller real-time updates.
 *
 * Auth: the client passes its access token via `handshake.auth.token` (or the
 * `Authorization` header). On connect we verify it and join the socket to a
 * personal room `user:{userId}`. Sellers additionally join `shop:{shopId}`
 * rooms when they emit `join:shop` (validated elsewhere by REST permissions).
 * Customers (or anyone watching an order — see canWatchOrder) join
 * `order:{orderId}` rooms via `join:order` to receive that order's live
 * courier-location stream.
 *
 * Emitting is done through {@link emitToUser} / {@link emitToShop} /
 * {@link emitToOrder}, called by domain services (e.g. OrdersService) — this
 * gateway holds no business logic itself. Courier location updates in
 * particular are POSTed over REST (`OrdersService.updateCourierLocation`),
 * not pushed through this socket — a courier's background location task
 * runs in a short-lived, isolated JS context that can't reliably keep a
 * WebSocket connection alive, so a plain HTTP request is the robust path;
 * this gateway only fans the result back out to whoever is watching.
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
  ) {}

  /** Only the shop owner or an active staff member may watch a shop's stream. */
  private async canWatchShop(userId: string, shopId: string): Promise<boolean> {
    const shop = await this.shops.findOne({
      where: { id: shopId },
      select: { id: true, ownerId: true },
    });
    if (!shop) return false;
    if (shop.ownerId === userId) return true;
    const member = await this.staff.findOne({
      where: { shopId, userId, isActive: true },
    });
    return !!member;
  }

  /**
   * Only the customer who placed the order, the shop owner, or staff holding
   * the matching order-view permission may watch it (mirrors
   * OrdersService.staffCanViewOrder — merely being active shop staff isn't
   * enough, e.g. a warehouse-only hire shouldn't follow another order's chat).
   */
  private async canWatchOrder(
    userId: string,
    orderId: string,
  ): Promise<boolean> {
    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: { shop: true },
      select: {
        id: true,
        userId: true,
        shopId: true,
        assignedStaffId: true,
        shop: { id: true, ownerId: true },
      },
    });
    if (!order) return false;
    if (order.userId === userId || order.shop.ownerId === userId) return true;
    const member = await this.staff.findOne({
      where: { shopId: order.shopId, userId, isActive: true },
    });
    if (!member) return false;
    if (member.permissions.includes('orders.view_all')) return true;
    return (
      member.permissions.includes('orders.view_assigned') &&
      order.assignedStaffId === member.id
    );
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

  /** Push an event to everyone watching an order (customer + shop devices). */
  emitToOrder(orderId: string, event: string, payload: unknown): void {
    this.server?.to(`order:${orderId}`).emit(event, payload);
  }
}
