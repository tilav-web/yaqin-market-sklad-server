import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PushModule } from '../push/push.module';
import { User } from '../users/entities/user.entity';
import { Notification } from './entities/notification.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { AdminNotificationsController, NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, NotificationTemplate, User]), PushModule],
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
