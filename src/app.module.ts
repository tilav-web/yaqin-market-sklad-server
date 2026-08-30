import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { AdminUsersModule } from './admin-users/admin-users.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AppReleasesModule } from './app-releases/app-releases.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { CategoriesModule } from './categories/categories.module';
import { ChatTemplatesModule } from './chat-templates/chat-templates.module';
import { ClickModule } from './click/click.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ComplaintsModule } from './complaints/complaints.module';
import { EnvironmentVariables, validateEnv } from './config/configuration';
import { ContactModule } from './contact/contact.module';
import { buildTypeOrmOptions } from './database/typeorm.config';
import { DebtsModule } from './debts/debts.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { PayablesModule } from './payables/payables.module';
import { PaymentsModule } from './payments/payments.module';
import { PrimeModule } from './prime/prime.module';
import { ProductsModule } from './products/products.module';
import { PromotionsModule } from './promotions/promotions.module';
import { PushModule } from './push/push.module';
import { RedisModule } from './redis/redis.module';
import { RiskModule } from './risk/risk.module';
import { SellersModule } from './sellers/sellers.module';
import { SettingsModule } from './settings/settings.module';
import { ShopsModule } from './shops/shops.module';
import { SmsModule } from './sms/sms.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        buildTypeOrmOptions(config),
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    SmsModule,
    UsersModule,
    AdminUsersModule,
    AuthModule,
    AdminAuthModule,
    CategoriesModule,
    SellersModule,
    ShopsModule,
    ProductsModule,
    OrdersModule,
    PushModule,
    UploadsModule,
    AnalyticsModule,
    DebtsModule,
    PayablesModule,
    NotificationsModule,
    AppReleasesModule,
    ContactModule,
    HealthModule,
    SettingsModule,
    PaymentsModule,
    PrimeModule,
    PromotionsModule,
    ChatTemplatesModule,
    ClickModule,
    ComplaintsModule,
    AuditLogModule,
    FiscalModule,
    RiskModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
