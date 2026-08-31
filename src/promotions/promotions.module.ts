import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PushModule } from '../push/push.module';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { UserFavoriteShop } from '../users/entities/user-favorite-shop.entity';
import { User } from '../users/entities/user.entity';
import { PromotionsController } from './promotions.controller';
import { Promotion } from './entities/promotion.entity';
import { PromotionsService } from './promotions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Promotion,
      Shop,
      ShopStaff,
      User,
      UserFavoriteShop,
    ]),
    PushModule,
  ],
  controllers: [PromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
