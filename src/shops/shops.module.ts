import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Order } from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import { SellerShopsController, ShopsController, StaffController } from './shops.controller';
import { ShopsService } from './shops.service';
import { Shop } from './entities/shop.entity';
import { ShopStaff } from './entities/shop-staff.entity';
import { StaffInvitation } from './entities/staff-invitation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Shop, ShopStaff, StaffInvitation, User, Order])],
  controllers: [ShopsController, SellerShopsController, StaffController],
  providers: [ShopsService],
  exports: [ShopsService],
})
export class ShopsModule {}
