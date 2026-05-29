import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import type { EnvironmentVariables } from '../config/configuration';

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
  ) {}

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

      // Sellers/staff ask to subscribe to a shop's order stream.
      client.on('join:shop', (shopId: unknown) => {
        if (typeof shopId === 'string' && shopId.length > 0) {
          void client.join(`shop:${shopId}`);
        }
      });
      client.on('leave:shop', (shopId: unknown) => {
        if (typeof shopId === 'string') void client.leave(`shop:${shopId}`);
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
