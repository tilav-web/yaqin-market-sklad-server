import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Order } from '../orders/entities/order.entity';
import { SettingsModule } from '../settings/settings.module';
import { AdminComplaintsController, OrderComplaintController } from './complaints.controller';
import { ComplaintsService } from './complaints.service';
import { OrderComplaint } from './entities/order-complaint.entity';

/**
 * Order dispute/complaint tracking (SPEC.md §8.5, §21). Kept as its own
 * module — rather than folding into OrdersModule — so PaymentsModule (which
 * must check for open complaints in its settlement cron) and ShopsModule
 * (admin shop-detail complaints list) can both depend on it without a
 * circular import back through OrdersModule/PaymentsModule. Reads the Order
 * entity directly, mirroring how ShopsModule/OrdersModule already reach into
 * each other's entities without importing the whole module.
 */
@Module({
  imports: [TypeOrmModule.forFeature([OrderComplaint, Order]), SettingsModule],
  controllers: [OrderComplaintController, AdminComplaintsController],
  providers: [ComplaintsService],
  exports: [ComplaintsService],
})
export class ComplaintsModule {}
