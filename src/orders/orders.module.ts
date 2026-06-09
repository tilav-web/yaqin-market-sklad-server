import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InventoryMovement } from '../products/entities/inventory-movement.entity';
import { PaymentsModule } from '../payments/payments.module';
import { PrimeModule } from '../prime/prime.module';
import { PushModule } from '../push/push.module';
import { SettingsModule } from '../settings/settings.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { UserAddress } from '../users/entities/user-address.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { Review } from './entities/review.entity';
import { OrdersController, SellerOrdersController } from './orders.controller';
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
      ProductVariant,
      InventoryMovement,
      UserAddress,
    ]),
    RealtimeModule,
    PushModule,
    PaymentsModule,
    PrimeModule,
    SettingsModule,
  ],
  controllers: [OrdersController, SellerOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
