import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InventoryMovement } from '../products/entities/inventory-movement.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { StockBatch } from '../products/entities/stock-batch.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Order } from '../orders/entities/order.entity';
import { PushModule } from '../push/push.module';
import { Shop } from '../shops/entities/shop.entity';
import { User } from '../users/entities/user.entity';
import { AdminAnalyticsController, AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ExpiryAlertService } from './expiry-alert.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, ProductVariant, StockBatch, InventoryMovement, Shop, User]),
    PushModule,
  ],
  controllers: [AnalyticsController, AdminAnalyticsController],
  providers: [AnalyticsService, ExpiryAlertService],
})
export class AnalyticsModule {}
