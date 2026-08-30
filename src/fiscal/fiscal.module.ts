import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Order } from '../orders/entities/order.entity';
import { GlobalProduct } from '../products/entities/global-product.entity';
import { SellerProfile } from '../sellers/entities/seller-profile.entity';
import { SettingsModule } from '../settings/settings.module';
import { FiscalReceipt } from './entities/fiscal-receipt.entity';
import { TaxCategory } from './entities/tax-category.entity';
import {
  FISCAL_PROVIDER,
  NoopFiscalProvider,
} from './fiscal-provider.interface';
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
  providers: [
    FiscalService,
    TasnifService,
    // Real OFD/vendor provayder ulanganda FAQAT shu qatorni o'zgartiring
    // (masalan `useClass: RegosFiscalProvider`) — FiscalService o'zi tegilmaydi.
    { provide: FISCAL_PROVIDER, useClass: NoopFiscalProvider },
  ],
  exports: [FiscalService],
})
export class FiscalModule {}
