import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { Role } from '../auth/role.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CreatePrimePlanDto,
  ExtendPrimeSubDto,
  UpdatePrimePlanDto,
} from './dto/prime-plan.dto';
import { SubscribeDto } from './dto/subscribe.dto';
import { PrimeService } from './prime.service';

/* ─── Seller endpoints ─── */

@Controller('seller/prime')
@Roles(Role.Seller)
export class SellerPrimeController {
  constructor(private readonly svc: PrimeService) {}

  @Get('plans')
  plans() {
    return this.svc.listPlans(false);
  }

  @Get('subscription')
  activeSub(@CurrentUser() user: JwtPayload) {
    return this.svc.getActiveSub(user.sub);
  }

  @Get('subscriptions')
  history(@CurrentUser() user: JwtPayload) {
    return this.svc.listMySubscriptions(user.sub);
  }

  @Post('subscribe')
  subscribe(@CurrentUser() user: JwtPayload, @Body() body: SubscribeDto) {
    return this.svc.subscribe(user.sub, body.planId, body.yearly ?? false);
  }
}

/* ─── Admin endpoints ─── */

@Controller('admin/prime')
@Roles(Role.Admin)
export class AdminPrimeController {
  constructor(private readonly svc: PrimeService) {}

  @Get('plans')
  plans(@Query('all') all?: string) {
    return this.svc.listPlans(all === 'true');
  }

  @Post('plans')
  createPlan(@Body() dto: CreatePrimePlanDto) {
    return this.svc.createPlan(dto);
  }

  @Put('plans/:id')
  updatePlan(@Param('id') id: string, @Body() dto: UpdatePrimePlanDto) {
    return this.svc.updatePlan(id, dto);
  }

  @Delete('plans/:id')
  deletePlan(@Param('id') id: string) {
    return this.svc.deletePlan(id);
  }

  @Get('subscriptions')
  allSubs() {
    return this.svc.listAllSubscriptions();
  }

  @Get('revenue-stats')
  revenueStats() {
    return this.svc.adminRevenueStats();
  }

  @Put('subscriptions/:id/extend')
  extend(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ExtendPrimeSubDto,
  ) {
    return this.svc.adminExtend(id, dto.days, user.sub);
  }
}
