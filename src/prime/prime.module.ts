import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SellerBalance } from '../payments/entities/seller-balance.entity';
import { SellerTransaction } from '../payments/entities/seller-transaction.entity';
import { PrimePlan } from './entities/prime-plan.entity';
import { SellerSubscription } from './entities/seller-subscription.entity';
import { AdminPrimeController, SellerPrimeController } from './prime.controller';
import { PrimeService } from './prime.service';

@Module({
  imports: [TypeOrmModule.forFeature([PrimePlan, SellerSubscription, SellerBalance, SellerTransaction])],
  controllers: [AdminPrimeController, SellerPrimeController],
  providers: [PrimeService],
  exports: [PrimeService],
})
export class PrimeModule {}
