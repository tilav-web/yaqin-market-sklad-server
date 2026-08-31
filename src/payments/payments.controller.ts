import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { Role } from '../auth/role.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { sendXlsx } from '../common/xlsx.util';
import {
  AdjustBalanceDto,
  AdminListWithdrawalsQuery,
  ExtendDebtDto,
  ForgiveDebtDto,
  ProcessWithdrawalDto,
  RequestWithdrawalDto,
} from './dto/payment.dto';
import { PaymentsService } from './payments.service';

/* ─── Seller endpoints ─── */

@Controller('seller/balance')
@Roles(Role.Seller)
export class SellerBalanceController {
  constructor(private readonly svc: PaymentsService) {}

  @Get()
  myBalance(@CurrentUser() user: JwtPayload) {
    return this.svc.getBalance(user.sub);
  }

  @Get('transactions')
  myTransactions(@CurrentUser() user: JwtPayload, @Query('page') page = 0) {
    return this.svc.getTransactions(user.sub, Number(page));
  }

  @Get('withdrawals')
  myWithdrawals(@CurrentUser() user: JwtPayload) {
    return this.svc.getMyWithdrawals(user.sub);
  }

  @Post('withdraw')
  requestWithdrawal(
    @CurrentUser() user: JwtPayload,
    @Body() body: RequestWithdrawalDto,
  ) {
    return this.svc.requestWithdrawal(user.sub, body);
  }
}

/* ─── Admin endpoints ─── */

@Controller('admin/balance')
@Roles(Role.Admin)
export class AdminBalanceController {
  constructor(private readonly svc: PaymentsService) {}

  @Get('withdrawals')
  listWithdrawals(@Query() query: AdminListWithdrawalsQuery) {
    return this.svc.adminListWithdrawals(query);
  }

  @Get('withdrawals/export')
  async exportWithdrawals(
    @Query() query: AdminListWithdrawalsQuery,
    @Res() res: Response,
  ) {
    const buf = await this.svc.adminExportWithdrawals(query.status);
    sendXlsx(res, buf, 'yechish-sorovlar.xlsx');
  }

  @Put('withdrawals/:id/process')
  processWithdrawal(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: ProcessWithdrawalDto,
  ) {
    return this.svc.adminProcessWithdrawal(
      id,
      user.sub,
      body.approve,
      body.note,
    );
  }

  @Get('sellers/:sellerId')
  sellerBalance(@Param('sellerId') sellerId: string) {
    return this.svc.adminGetBalance(sellerId);
  }

  @Get('sellers/:sellerId/transactions')
  sellerTransactions(
    @Param('sellerId') sellerId: string,
    @Query('page') page = 0,
  ) {
    return this.svc.adminGetTransactions(sellerId, Number(page));
  }

  @Post('sellers/:sellerId/adjust')
  adjust(
    @Param('sellerId') sellerId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: AdjustBalanceDto,
  ) {
    return this.svc.adminAdjust(
      sellerId,
      body.amount,
      body.description,
      user.sub,
    );
  }

  @Post('transactions/:txId/force-settle')
  forceSettle(@Param('txId') txId: string, @CurrentUser() user: JwtPayload) {
    return this.svc.adminForceSettle(txId, user.sub);
  }

  @Post('transactions/:txId/force-refund')
  forceRefund(@Param('txId') txId: string, @CurrentUser() user: JwtPayload) {
    return this.svc.adminForceRefund(txId, user.sub);
  }

  @Get('overdue-debts')
  listOverdueDebts() {
    return this.svc.adminListOverdueDebts();
  }

  @Post('sellers/:sellerId/forgive-debt')
  forgiveDebt(
    @Param('sellerId') sellerId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: ForgiveDebtDto,
  ) {
    return this.svc.adminForgiveDebt(sellerId, user.sub, body.reason);
  }

  @Post('sellers/:sellerId/extend-debt')
  extendDebt(
    @Param('sellerId') sellerId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: ExtendDebtDto,
  ) {
    return this.svc.adminExtendDebtDue(sellerId, body.days, user.sub);
  }
}
