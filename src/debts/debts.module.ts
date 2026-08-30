import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GlobalProduct } from '../products/entities/global-product.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { DebtsController } from './debts.controller';
import { DebtsService } from './debts.service';
import { Debt } from './entities/debt.entity';
import { DebtPayment } from './entities/debt-payment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Debt,
      DebtPayment,
      Shop,
      ShopStaff,
      ProductVariant,
      GlobalProduct,
    ]),
  ],
  controllers: [DebtsController],
  providers: [DebtsService],
})
export class DebtsModule {}
