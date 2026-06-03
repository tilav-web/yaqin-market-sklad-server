import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { UserAddress } from './entities/user-address.entity';
import { User } from './entities/user.entity';
import { AdminUsersController, UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserAddress, ShopStaff])],
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
