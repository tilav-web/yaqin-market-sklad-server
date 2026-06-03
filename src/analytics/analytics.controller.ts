import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { AnalyticsService, StatsPeriod } from './analytics.service';

@ApiBearerAuth()
@ApiTags('seller-analytics')
@Controller('seller/shops/:shopId/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('stats')
  stats(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Query('period') period?: string,
  ) {
    const p: StatsPeriod = period === 'today' || period === '7d' || period === '30d' ? period : '7d';
    return this.analytics.stats(user.sub, shopId, p);
  }

  @Get('reorder')
  reorder(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
  ) {
    return this.analytics.reorder(user.sub, shopId);
  }

  @Get('expiring')
  expiring(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Query('days') days?: string,
  ) {
    const d = Math.min(Math.max(Number(days) || 30, 1), 365);
    return this.analytics.expiring(user.sub, shopId, d);
  }
}
