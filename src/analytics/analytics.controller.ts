import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Role } from '../auth/role.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { AnalyticsService, StatsPeriod } from './analytics.service';
import { LogAnalyticsEventsDto } from './dto/analytics-event.dto';

@ApiBearerAuth()
@ApiTags('admin-analytics')
@Controller('admin/analytics')
@Roles(Role.Admin)
export class AdminAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  dashboard() {
    return this.analytics.adminDashboard();
  }

  @Get('top-shops')
  topShops(@Query('limit') limit?: string) {
    return this.analytics.topShops(Math.min(Number(limit) || 10, 50));
  }

  @Get('top-products')
  topProducts(@Query('limit') limit?: string) {
    return this.analytics.topProducts(Math.min(Number(limit) || 10, 50));
  }

  @Get('timeline')
  timeline(@Query('days') days?: string) {
    const d = Math.min(Math.max(Number(days) || 30, 7), 90);
    return this.analytics.ordersTimeline(d);
  }

  /** View → cart → order conversion funnel (SPEC.md §5.3). */
  @Get('funnel')
  funnel(@Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.funnel(from, to);
  }
}

/** Customer-facing: batched product-view / add-to-cart event logging. */
@ApiBearerAuth()
@ApiTags('analytics-events')
@Controller('analytics')
export class AnalyticsEventsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Post('events')
  logEvents(
    @CurrentUser() user: JwtPayload,
    @Body() dto: LogAnalyticsEventsDto,
  ) {
    return this.analytics.logEvents(user.sub, dto.events);
  }
}

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
    const p: StatsPeriod =
      period === 'today' || period === '7d' || period === '30d' ? period : '7d';
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
