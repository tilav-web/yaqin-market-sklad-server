import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { SellerBalance } from '../payments/entities/seller-balance.entity';
import { SellerTransaction } from '../payments/entities/seller-transaction.entity';
import { PushModule } from '../push/push.module';
import { User } from '../users/entities/user.entity';
import { PrimePlan } from './entities/prime-plan.entity';
import { SellerSubscription } from './entities/seller-subscription.entity';
import {
  AdminPrimeController,
  SellerPrimeController,
} from './prime.controller';
import { PrimeService } from './prime.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PrimePlan,
      SellerSubscription,
      SellerBalance,
      SellerTransaction,
      User,
    ]),
    PushModule,
    AuditLogModule,
  ],
  controllers: [AdminPrimeController, SellerPrimeController],
  providers: [PrimeService],
  exports: [PrimeService],
})
export class PrimeModule {}
