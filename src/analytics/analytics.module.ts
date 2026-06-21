import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InventoryMovement } from '../products/entities/inventory-movement.entity';
import { GlobalProduct } from '../products/entities/global-product.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { StockBatch } from '../products/entities/stock-batch.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Order } from '../orders/entities/order.entity';
import { PushModule } from '../push/push.module';
import { SettingsModule } from '../settings/settings.module';
import { Shop } from '../shops/entities/shop.entity';
import { User } from '../users/entities/user.entity';
import { AdminAnalyticsController, AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ExpiryAlertService } from './expiry-alert.service';
import { LowStockAlertService } from './low-stock-alert.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, GlobalProduct, ProductVariant, StockBatch, InventoryMovement, Shop, User]),
    PushModule,
    SettingsModule,
  ],
  controllers: [AnalyticsController, AdminAnalyticsController],
  providers: [AnalyticsService, ExpiryAlertService, LowStockAlertService],
})
export class AnalyticsModule {}
