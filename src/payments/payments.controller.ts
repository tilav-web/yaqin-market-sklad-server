import { Body, Controller, Get, Param, Post, Put, Query, Request } from '@nestjs/common';

import { Role } from '../auth/role.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { WithdrawalStatus } from './entities/withdrawal-request.entity';
import { PaymentsService } from './payments.service';

/* ─── Seller endpoints ─── */

@Controller('seller/balance')
@Roles(Role.Seller)
export class SellerBalanceController {
  constructor(private readonly svc: PaymentsService) {}

  @Get()
  myBalance(@Request() req: any) {
    return this.svc.getBalance(req.user.sub);
  }

  @Get('transactions')
  myTransactions(@Request() req: any, @Query('page') page = 0) {
    return this.svc.getTransactions(req.user.sub, Number(page));
  }

  @Get('withdrawals')
  myWithdrawals(@Request() req: any) {
    return this.svc.getMyWithdrawals(req.user.sub);
  }

  @Post('withdraw')
  requestWithdrawal(
    @Request() req: any,
    @Body() body: { amount: number; bankCardNumber: string; bankCardHolderName: string },
  ) {
    return this.svc.requestWithdrawal(req.user.sub, body);
  }
}

/* ─── Admin endpoints ─── */

@Controller('admin/balance')
@Roles(Role.Admin)
export class AdminBalanceController {
  constructor(private readonly svc: PaymentsService) {}

  @Get('withdrawals')
  listWithdrawals(@Query('status') status?: WithdrawalStatus) {
    return this.svc.adminListWithdrawals(status);
  }

  @Put('withdrawals/:id/process')
  processWithdrawal(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { approve: boolean; note?: string },
  ) {
    return this.svc.adminProcessWithdrawal(id, req.user.sub, body.approve, body.note);
  }

  @Get('sellers/:sellerId')
  sellerBalance(@Param('sellerId') sellerId: string) {
    return this.svc.adminGetBalance(sellerId);
  }

  @Get('sellers/:sellerId/transactions')
  sellerTransactions(@Param('sellerId') sellerId: string, @Query('page') page = 0) {
    return this.svc.adminGetTransactions(sellerId, Number(page));
  }

  @Post('sellers/:sellerId/adjust')
  adjust(
    @Param('sellerId') sellerId: string,
    @Body() body: { amount: number; description: string },
  ) {
    return this.svc.adminAdjust(sellerId, body.amount, body.description);
  }
}
