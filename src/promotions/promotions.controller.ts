import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { CreatePromotionDto } from './dto/promotion.dto';
import { PromotionsService } from './promotions.service';

@ApiBearerAuth()
@ApiTags('promotions')
@Controller('seller/shops/:shopId/promotions')
export class PromotionsController {
  constructor(private readonly svc: PromotionsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Query('status') status?: 'active' | 'scheduled' | 'ended',
  ) {
    return this.svc.list(user.sub, shopId, status);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: CreatePromotionDto,
  ) {
    return this.svc.create(user.sub, shopId, dto);
  }

  @Patch(':id/stop')
  stop(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.stop(user.sub, id);
  }

  @Get(':id/stats')
  stats(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.stats(user.sub, id);
  }
}
