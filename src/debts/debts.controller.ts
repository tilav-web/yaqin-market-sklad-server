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

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { DebtsService } from './debts.service';
import { AddPaymentDto, CreateDebtDto } from './dto/debt.dto';

@ApiBearerAuth()
@ApiTags('seller-debts')
@Controller('seller/shops/:shopId/debts')
export class DebtsController {
  constructor(private readonly debts: DebtsService) {}

  @Get()
  listAccounts(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
  ) {
    return this.debts.listAccounts(user.sub, shopId);
  }

  @Get('summary')
  summary(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
  ) {
    return this.debts.summary(user.sub, shopId);
  }

  @Get('account/:phone')
  account(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('phone') phone: string,
  ) {
    return this.debts.getAccount(user.sub, shopId, phone);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: CreateDebtDto,
  ) {
    return this.debts.createDebt(user.sub, shopId, dto);
  }

  @Post('payment')
  pay(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: AddPaymentDto,
  ) {
    return this.debts.addPayment(user.sub, shopId, dto);
  }
}
