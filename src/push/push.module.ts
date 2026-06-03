import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Notification } from '../notifications/entities/notification.entity';
import { DeviceToken } from './entities/device-token.entity';
import { PublicDevicesController, PushController } from './push.controller';
import { PushService } from './push.service';

/**
 * Push notification infrastructure (Expo Push). Imported by modules that
 * send notifications (Orders). Owns the device-token registration endpoint.
 */
@Module({
  imports: [TypeOrmModule.forFeature([DeviceToken, Notification])],
  controllers: [PushController, PublicDevicesController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
