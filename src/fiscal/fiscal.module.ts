import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Order } from '../orders/entities/order.entity';
import { GlobalProduct } from '../products/entities/global-product.entity';
import { SellerProfile } from '../sellers/entities/seller-profile.entity';
import { SettingsModule } from '../settings/settings.module';
import { FiscalReceipt } from './entities/fiscal-receipt.entity';
import { TaxCategory } from './entities/tax-category.entity';
import { FiscalController } from './fiscal.controller';
import { FiscalService } from './fiscal.service';
import { TasnifService } from './tasnif.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FiscalReceipt,
      TaxCategory,
      Order,
      SellerProfile,
      GlobalProduct,
    ]),
    SettingsModule,
  ],
  controllers: [FiscalController],
  providers: [FiscalService, TasnifService],
  exports: [FiscalService],
})
export class FiscalModule {}
