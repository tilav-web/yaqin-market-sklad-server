import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SellerShopsController, ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';
import { Shop } from './entities/shop.entity';
import { ShopStaff } from './entities/shop-staff.entity';
import { StaffInvitation } from './entities/staff-invitation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Shop, ShopStaff, StaffInvitation])],
  controllers: [ShopsController, SellerShopsController],
  providers: [ShopsService],
  exports: [ShopsService],
})
export class ShopsModule {}
