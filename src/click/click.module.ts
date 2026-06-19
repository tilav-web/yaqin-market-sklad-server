import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Order } from '../orders/entities/order.entity';
import { RealtimeModule } from '../realtime/realtime.module';
import { ClickController } from './click.controller';
import { ClickPaymentTransaction } from './click-payment-transaction.entity';
import { ClickService } from './click.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ClickPaymentTransaction, Order]),
    RealtimeModule,
  ],
  controllers: [ClickController],
  providers: [ClickService],
  exports: [ClickService],
})
export class ClickModule {}
