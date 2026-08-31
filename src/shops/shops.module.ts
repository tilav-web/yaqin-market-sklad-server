import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { ComplaintsModule } from '../complaints/complaints.module';
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
import { RiskModule } from '../risk/risk.module';
import { SettingsModule } from '../settings/settings.module';
import { ShopsService } from './shops.service';
import { Shop } from './entities/shop.entity';
import { ShopStaff } from './entities/shop-staff.entity';
import { ShopStaffPreset } from './entities/shop-staff-preset.entity';
import { StaffInvitation } from './entities/staff-invitation.entity';

import { SellerBankAccount } from '../sellers/entities/seller-bank-account.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Shop,
      ShopStaff,
      ShopStaffPreset,
      StaffInvitation,
      User,
      Order,
      ProductVariant,
      GlobalProduct,
      SellerBankAccount,
    ]),
    ComplaintsModule,
    AuditLogModule,
    SettingsModule,
    RiskModule,
  ],
  controllers: [
    ShopsController,
    SellerShopsController,
    StaffController,
    AdminShopsController,
  ],
  providers: [ShopsService],
  exports: [ShopsService],
})
export class ShopsModule {}
