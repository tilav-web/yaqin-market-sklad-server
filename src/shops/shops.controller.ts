import {
  Body,
  Controller,
  Get,
  Param,
  ParseFloatPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { UpdateShopDto } from './dto/shop.dto';
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
    @Body() body: { isOpen: boolean },
  ) {
    return this.shops.toggleOpen(user.sub, id, body.isOpen);
  }

  @Post(':id/block-user')
  blockUser(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { userId: string },
  ) {
    return this.shops.blockUser(user.sub, id, body.userId);
  }

  @Post(':id/unblock-user')
  unblockUser(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { userId: string },
  ) {
    return this.shops.unblockUser(user.sub, id, body.userId);
  }
}
