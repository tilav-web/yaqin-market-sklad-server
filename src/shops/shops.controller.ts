import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFloatPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../auth/role.enum';
import type { StaffPermission, StaffPreset } from './entities/shop-staff.entity';
import {
  AcceptInvitationDto,
  AdminListShopsQuery,
  AdminSetActiveDto,
  BlockUserDto,
  CreateShopDto,
  ToggleOpenDto,
  UpdateDeliveryZonesDto,
  UpdateShopDto,
} from './dto/shop.dto';
import { ShopsService } from './shops.service';

@ApiTags('shops')
@Controller('shops')
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  // Public: nearby shops by GPS
  @Public()
  @Get('nearby')
  nearby(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lng', ParseFloatPipe) lng: number,
  ) {
    return this.shops.findNearbyShops(lat, lng);
  }

  // Public: shop detail (with optional distance calc)
  @Public()
  @Get(':id')
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    const latitude = lat !== undefined ? Number(lat) : undefined;
    const longitude = lng !== undefined ? Number(lng) : undefined;
    return this.shops.getPublicShop(id, latitude, longitude);
  }
}

@ApiBearerAuth()
@ApiTags('seller-shops')
@Controller('seller/shops')
export class SellerShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Get('mine')
  listMine(@CurrentUser() user: JwtPayload) {
    return this.shops.listMyShops(user.sub);
  }

  // Any authenticated user can open a shop and instantly become a seller.
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateShopDto) {
    return this.shops.createShop(user.sub, dto);
  }

  @Get('working-for-me')
  workingForMe(@CurrentUser() user: JwtPayload) {
    return this.shops.listShopsWhereStaff(user.sub);
  }

  @Get(':id')
  getOne(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.shops.getOwned(user.sub, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShopDto,
  ) {
    return this.shops.update(user.sub, id, dto);
  }

  @Post(':id/toggle-open')
  toggleOpen(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ToggleOpenDto,
  ) {
    return this.shops.toggleOpen(user.sub, id, dto.isOpen);
  }

  // Owner opened this shop's orders → clear the profile "new orders" badge.
  @Post(':id/orders/seen')
  @HttpCode(HttpStatus.NO_CONTENT)
  markOrdersSeen(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.shops.markOrdersSeen(user.sub, id);
  }

  @Post(':id/block-user')
  blockUser(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BlockUserDto,
  ) {
    return this.shops.blockUser(user.sub, id, dto.userId);
  }

  @Post(':id/unblock-user')
  unblockUser(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BlockUserDto,
  ) {
    return this.shops.unblockUser(user.sub, id, dto.userId);
  }

  @Get(':id/blocked-users')
  listBlocked(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.shops.listBlockedUsers(user.sub, id);
  }

  @Get(':id/completeness')
  completeness(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.shops.getCompleteness(user.sub, id);
  }

  @Patch(':shopId/delivery-zones')
  updateDeliveryZones(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: UpdateDeliveryZonesDto,
  ) {
    return this.shops.updateDeliveryZones(user.sub, shopId, dto);
  }

  // ---- Staff management (owner) ----
  @Post(':id/staff/invitations')
  createStaffInvite(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.shops.createStaffInvitation(user.sub, id);
  }

  @Get(':id/staff')
  listStaff(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.shops.listStaff(user.sub, id);
  }

  @Patch(':id/staff/:staffId')
  updateStaff(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body()
    body: {
      permissions?: StaffPermission[];
      preset?: StaffPreset;
      customRoleName?: string;
      isActive?: boolean;
    },
  ) {
    return this.shops.updateStaff(user.sub, id, staffId, body);
  }

  @Delete(':id/staff/:staffId')
  removeStaff(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('staffId', ParseUUIDPipe) staffId: string,
  ) {
    return this.shops.removeStaff(user.sub, id, staffId);
  }
}

/** Endpoints any authenticated user hits to join a shop as staff via QR. */
@ApiBearerAuth()
@ApiTags('staff')
@Controller('staff')
export class StaffController {
  constructor(private readonly shops: ShopsService) {}

  @Post('accept')
  accept(@CurrentUser() user: JwtPayload, @Body() dto: AcceptInvitationDto) {
    return this.shops.acceptStaffInvitation(user.sub, dto.token);
  }
}

@ApiBearerAuth()
@ApiTags('admin-shops')
@UseGuards(RolesGuard)
@Roles(Role.Admin)
@Controller('admin/shops')
export class AdminShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Get()
  list(@Query() query: AdminListShopsQuery) {
    return this.shops.adminListShops(query);
  }

  @Patch(':id/active')
  setActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminSetActiveDto) {
    return this.shops.adminSetActive(id, dto.isActive);
  }
}
