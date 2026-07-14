import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

/**
 * Backs the Socket.IO gateway with Redis pub/sub so `emitToUser`/`emitToShop`
 * reach clients connected to ANY server process, not just the one handling
 * the current request. A no-op improvement on a single instance; required
 * once the API runs as more than one process (PM2 cluster, multiple VPS).
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  connectToRedis(pubClient: Redis, subClient: Redis): void {
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
