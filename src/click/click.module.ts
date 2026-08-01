import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FiscalModule } from '../fiscal/fiscal.module';
import { Order } from '../orders/entities/order.entity';
import { RealtimeModule } from '../realtime/realtime.module';
import { SettingsModule } from '../settings/settings.module';
import { ClickCardController } from './click-card.controller';
import { ClickCardService } from './click-card.service';
import { ClickController } from './click.controller';
import { ClickMerchantService } from './click-merchant.service';
import { ClickPaymentTransaction } from './click-payment-transaction.entity';
import { ClickService } from './click.service';
import { SavedCard } from './saved-card.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ClickPaymentTransaction, Order, SavedCard]),
    RealtimeModule,
    SettingsModule,
    FiscalModule,
  ],
  controllers: [ClickController, ClickCardController],
  providers: [ClickService, ClickMerchantService, ClickCardService],
  exports: [ClickService, ClickCardService],
})
export class ClickModule {}
