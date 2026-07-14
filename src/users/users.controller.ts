import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/role.enum';
import {
  AdminListUsersQuery,
  AdminSetAdminDto,
  AdminSetStatusDto,
} from './dto/admin-user.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@ApiBearerAuth()
@ApiTags('users')
@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async me(@CurrentUser() user: JwtPayload) {
    const u = await this.users.findById(user.sub);
    if (!u) return null;
    return {
      id: u.id,
      phone: u.phone,
      name: u.name,
      avatarUrl: u.avatarUrl,
      isSellerApproved: u.isSellerApproved,
      isAdmin: u.isAdmin,
      status: u.status,
    };
  }

  @Patch()
  async updateMe(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.sub, dto);
  }

  @Get('addresses')
  listAddresses(@CurrentUser() user: JwtPayload) {
    return this.users.listAddresses(user.sub);
  }

  @Post('addresses')
  createAddress(@CurrentUser() user: JwtPayload, @Body() dto: CreateAddressDto) {
    return this.users.createAddress(user.sub, dto);
  }

  @Patch('addresses/:id')
  updateAddress(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.users.updateAddress(user.sub, id, dto);
  }

  @Delete('addresses/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAddress(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.deleteAddress(user.sub, id);
  }

  /* ─── Favorites ─── */

  @Get('favorites')
  getFavorites(@CurrentUser() user: JwtPayload) {
    return this.users.getFavorites(user.sub);
  }

  @Post('favorites/shops/:shopId')
  addFavoriteShop(@CurrentUser() user: JwtPayload, @Param('shopId', ParseUUIDPipe) shopId: string) {
    return this.users.toggleFavoriteShop(user.sub, shopId, true);
  }

  @Delete('favorites/shops/:shopId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeFavoriteShop(@CurrentUser() user: JwtPayload, @Param('shopId', ParseUUIDPipe) shopId: string) {
    return this.users.toggleFavoriteShop(user.sub, shopId, false);
  }

  @Post('favorites/products/:productId')
  addFavoriteProduct(@CurrentUser() user: JwtPayload, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.users.toggleFavoriteProduct(user.sub, productId, true);
  }

  @Delete('favorites/products/:productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeFavoriteProduct(@CurrentUser() user: JwtPayload, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.users.toggleFavoriteProduct(user.sub, productId, false);
  }
}

@ApiBearerAuth()
@ApiTags('admin-users')
@Roles(Role.Admin)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query() query: AdminListUsersQuery) {
    return this.users.adminListUsers(query);
  }

  @Patch(':id/status')
  setStatus(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminSetStatusDto,
  ) {
    return this.users.adminSetStatus(id, dto.blocked, admin.sub, dto.reason);
  }

  @Patch(':id/admin')
  setAdmin(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminSetAdminDto,
  ) {
    return this.users.adminSetAdmin(id, dto.isAdmin, admin.sub, dto.reason);
  }

  /** User-detail order history (SPEC.md §5.3 "Buyurtma tarixini ko'rish"). */
  @Get(':id/orders')
  listOrders(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.users.adminListUserOrders(id, {
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
    });
  }
}
