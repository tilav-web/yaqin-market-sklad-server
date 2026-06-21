import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Order } from '../orders/entities/order.entity';
import { GlobalProduct } from '../products/entities/global-product.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { User } from '../users/entities/user.entity';
import {
  AdminShopsController,
  SellerShopsController,
  ShopsController,
  StaffController,
} from './shops.controller';
import { ShopsService } from './shops.service';
import { Shop } from './entities/shop.entity';
import { ShopStaff } from './entities/shop-staff.entity';
import { StaffInvitation } from './entities/staff-invitation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Shop, ShopStaff, StaffInvitation, User, Order, ProductVariant, GlobalProduct])],
  controllers: [ShopsController, SellerShopsController, StaffController, AdminShopsController],
  providers: [ShopsService],
  exports: [ShopsService],
})
export class ShopsModule {}
