import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { ComplaintsModule } from '../complaints/complaints.module';
import { PushModule } from '../push/push.module';
import { Shop } from '../shops/entities/shop.entity';
import { SettingsModule } from '../settings/settings.module';
import { User } from '../users/entities/user.entity';
import { SellerBalance } from './entities/seller-balance.entity';
import { SellerTransaction } from './entities/seller-transaction.entity';
import { WithdrawalRequest } from './entities/withdrawal-request.entity';
import {
  AdminBalanceController,
  SellerBalanceController,
} from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SellerBalance,
      SellerTransaction,
      WithdrawalRequest,
      Shop,
      User,
    ]),
    SettingsModule,
    PushModule,
    ComplaintsModule,
    AuditLogModule,
  ],
  controllers: [AdminBalanceController, SellerBalanceController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
