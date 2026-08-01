import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { ClickModule } from '../click/click.module';
import { ComplaintsModule } from '../complaints/complaints.module';
import { FiscalModule } from '../fiscal/fiscal.module';
import { InventoryMovement } from '../products/entities/inventory-movement.entity';
import { SellerTransaction } from '../payments/entities/seller-transaction.entity';
import { PaymentsModule } from '../payments/payments.module';
import { PrimeModule } from '../prime/prime.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { PushModule } from '../push/push.module';
import { SettingsModule } from '../settings/settings.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RedisModule } from '../redis/redis.module';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { UserAddress } from '../users/entities/user-address.entity';
import { GlobalProduct } from '../products/entities/global-product.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { Review } from './entities/review.entity';
import { AdminOrdersController, OrdersController, SellerOrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      Review,
      ChatMessage,
      Shop,
      ShopStaff,
      GlobalProduct,
      ProductVariant,
      InventoryMovement,
      UserAddress,
      SellerTransaction,
    ]),
    RealtimeModule,
    RedisModule,
    PushModule,
    PaymentsModule,
    PrimeModule,
    PromotionsModule,
    SettingsModule,
    ComplaintsModule,
    AuditLogModule,
    ClickModule,
    FiscalModule,
  ],
  controllers: [OrdersController, SellerOrdersController, AdminOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
