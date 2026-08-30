import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Order } from '../orders/entities/order.entity';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Provides the shared Socket.IO gateway. Domain modules import this and inject
 * {@link RealtimeGateway} to push real-time events.
 */
@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([Shop, ShopStaff, Order]),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
