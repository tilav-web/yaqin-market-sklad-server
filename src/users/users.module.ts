import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { Order } from '../orders/entities/order.entity';
import { DeviceToken } from '../push/entities/device-token.entity';
import { SellerBalance } from '../payments/entities/seller-balance.entity';
import { SellerBankAccount } from '../sellers/entities/seller-bank-account.entity';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { RiskModule } from '../risk/risk.module';
import { UserAddress } from './entities/user-address.entity';
import { User } from './entities/user.entity';
import { AdminUsersController, UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserAddress,
      ShopStaff,
      Order,
      Shop,
      SellerBalance,
      SellerBankAccount,
      DeviceToken,
    ]),
    AuditLogModule,
    RiskModule,
  ],
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
