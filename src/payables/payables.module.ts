import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import {
  PayablesController,
  PayablesAdminController,
} from './payables.controller';
import { PayablesService } from './payables.service';
import { PayableCharge } from './entities/payable-charge.entity';
import { PayablePayment } from './entities/payable-payment.entity';
import { SupplierAccount } from './entities/supplier-account.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SupplierAccount,
      PayableCharge,
      PayablePayment,
      Shop,
      ShopStaff,
    ]),
  ],
  controllers: [PayablesController, PayablesAdminController],
  providers: [PayablesService],
})
export class PayablesModule {}
