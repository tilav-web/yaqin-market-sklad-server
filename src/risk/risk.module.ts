import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { Order } from '../orders/entities/order.entity';
import { RedisModule } from '../redis/redis.module';
import { SettingsModule } from '../settings/settings.module';
import { User } from '../users/entities/user.entity';
import { CourierLocationPing } from './entities/courier-location-ping.entity';
import { DeviceAccount } from './entities/device-account.entity';
import { RiskFlag } from './entities/risk-flag.entity';
import { AdminRiskController } from './risk.controller';
import { RiskFlagsService } from './risk-flags.service';
import { RiskHandshakeService } from './risk-handshake.service';
import { RiskPingService } from './risk-ping.service';
import { RiskService } from './risk.service';

/**
 * Repositories only, not feature modules (OrdersModule/UsersModule/etc all
 * import THIS module — importing them back would cycle). One-directional:
 * RiskModule -> {AuditLogModule, RedisModule, SettingsModule}, never the
 * other way.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RiskFlag,
      CourierLocationPing,
      DeviceAccount,
      User,
      Order,
    ]),
    RedisModule,
    SettingsModule,
    AuditLogModule,
  ],
  controllers: [AdminRiskController],
  providers: [
    RiskFlagsService,
    RiskPingService,
    RiskHandshakeService,
    RiskService,
  ],
  exports: [RiskService],
})
export class RiskModule {}
