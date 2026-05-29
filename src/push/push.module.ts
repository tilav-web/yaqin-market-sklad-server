import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DeviceToken } from './entities/device-token.entity';
import { PushController } from './push.controller';
import { PushService } from './push.service';

/**
 * Push notification infrastructure (Expo Push). Imported by modules that
 * send notifications (Orders). Owns the device-token registration endpoint.
 */
@Module({
  imports: [TypeOrmModule.forFeature([DeviceToken])],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
