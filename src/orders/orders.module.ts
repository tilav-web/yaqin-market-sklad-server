import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InventoryMovement } from '../products/entities/inventory-movement.entity';
import { RealtimeModule } from '../realtime/realtime.module';
import { Shop } from '../shops/entities/shop.entity';
import { UserAddress } from '../users/entities/user-address.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
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
      Shop,
      ProductVariant,
      InventoryMovement,
      UserAddress,
    ]),
    RealtimeModule,
  ],
  controllers: [OrdersController, SellerOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
