import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/role.enum';
import {
  AddChargeDto,
  AddPaymentDto,
  CreateAccountDto,
  UpdateAccountDto,
} from './dto/payable.dto';
import { PayablesService } from './payables.service';

@ApiBearerAuth()
@ApiTags('seller-payables')
@Controller('seller/shops/:shopId/payables')
export class PayablesController {
  constructor(private readonly payables: PayablesService) {}

  @Get()
  listAccounts(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
  ) {
    return this.payables.listAccounts(user.sub, shopId);
  }

  @Get('summary')
  summary(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
  ) {
    return this.payables.summary(user.sub, shopId);
  }

  @Get('account/:accountId')
  account(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    return this.payables.getAccount(user.sub, shopId, accountId);
  }

  @Post('accounts')
  createAccount(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: CreateAccountDto,
  ) {
    return this.payables.createAccount(user.sub, shopId, dto);
  }

  @Patch('accounts/:accountId')
  updateAccount(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.payables.updateAccount(user.sub, shopId, accountId, dto);
  }

  @Post('charges')
  addCharge(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: AddChargeDto,
  ) {
    return this.payables.addCharge(user.sub, shopId, dto);
  }

  @Post('payments')
  addPayment(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: AddPaymentDto,
  ) {
    return this.payables.addPayment(user.sub, shopId, dto);
  }
}

/** Read-only cross-shop view for platform admins. */
@ApiBearerAuth()
@ApiTags('admin-payables')
@Controller('admin/payables')
@Roles(Role.Admin)
export class PayablesAdminController {
  constructor(private readonly payables: PayablesService) {}

  @Get()
  listShops() {
    return this.payables.adminListShopSummaries();
  }

  @Get('shops/:shopId')
  shopAccounts(@Param('shopId', ParseUUIDPipe) shopId: string) {
    return this.payables.adminGetShopAccounts(shopId);
  }
}
