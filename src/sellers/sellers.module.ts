import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PaymentsModule } from '../payments/payments.module';
import { Shop } from '../shops/entities/shop.entity';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { SellerApplication } from './entities/seller-application.entity';
import { SellerProfile } from './entities/seller-profile.entity';
import { SellersController } from './sellers.controller';
import { SellersService } from './sellers.service';

@Module({
  imports: [TypeOrmModule.forFeature([SellerApplication, User, Shop, SellerProfile]), UsersModule, PaymentsModule],
  controllers: [SellersController],
  providers: [SellersService],
  exports: [SellersService],
})
export class SellersModule {}
