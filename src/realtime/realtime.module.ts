import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { RealtimeGateway } from './realtime.gateway';

/**
 * Provides the shared Socket.IO gateway. Domain modules import this and inject
 * {@link RealtimeGateway} to push real-time events.
 */
@Module({
  imports: [JwtModule.register({})],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
