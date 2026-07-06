import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';

import { ComplaintsService } from '../complaints/complaints.service';
import { PushService } from '../push/push.service';
import { Shop } from '../shops/entities/shop.entity';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../settings/entities/global-setting.entity';
import { SellerBalance } from './entities/seller-balance.entity';
import { SellerTransaction, SellerTxType } from './entities/seller-transaction.entity';
import { WithdrawalRequest, WithdrawalStatus } from './entities/withdrawal-request.entity';

@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(SellerBalance)   private readonly balances: Repository<SellerBalance>,
    @InjectRepository(SellerTransaction) private readonly txs: Repository<SellerTransaction>,
    @InjectRepository(WithdrawalRequest) private readonly withdrawals: Repository<WithdrawalRequest>,
    @InjectRepository(Shop)            private readonly shops: Repository<Shop>,
    private readonly settings: SettingsService,
    private readonly dataSource: DataSource,
    private readonly push: PushService,
    private readonly complaints: ComplaintsService,
  ) {}

  /** Ensure a SellerBalance record exists for this seller (idempotent). */
  async ensureBalance(sellerId: string): Promise<SellerBalance> {
    let bal = await this.balances.findOne({ where: { sellerId } });
    if (!bal) {
      bal = this.balances.create({ sellerId });
      bal = await this.balances.save(bal);
    }
    return bal;
  }

  async getBalance(sellerId: string): Promise<SellerBalance> {
    return this.ensureBalance(sellerId);
  }

  async getTransactions(sellerId: string, page = 0, limit = 30): Promise<SellerTransaction[]> {
    return this.txs.find({
      where: { sellerId },
      order: { createdAt: 'DESC' },
      skip: page * limit,
      take: limit,
    });
  }

  /**
   * Called when a CASH order is delivered.
   * Seller collects cash; platform commission becomes debt.
   */
  async recordCashOrderDelivery(opts: {
    sellerId: string;
    orderId: string;
    orderTotal: number;
    commissionRate: number; // percentage, e.g. 12
  }): Promise<void> {
    const { sellerId, orderId, orderTotal, commissionRate } = opts;
    const commissionAmount = Math.round(orderTotal * commissionRate) / 100;
    const netAmount = orderTotal - commissionAmount;

    await this.dataSource.transaction(async (em) => {
      const bal = (await em.findOne(SellerBalance, {
        where: { sellerId },
        lock: { mode: 'pessimistic_write' },
      })) ?? em.create(SellerBalance, { sellerId });

      // Add net to available
      bal.availableBalance = String(parseFloat(bal.availableBalance ?? '0') + netAmount);

      // Add commission to debt
      const newDebt = parseFloat(bal.debtBalance ?? '0') + commissionAmount;
      bal.debtBalance = String(newDebt);

      // Set due date if this is new debt
      if (!bal.debtDueDate && commissionAmount > 0) {
        const days = this.settings.getNumber(SETTING_KEYS.DEBT_DUE_DAYS, 30);
        const due = new Date();
        due.setDate(due.getDate() + days);
        bal.debtDueDate = due.toISOString().split('T')[0];
      }

      await em.save(SellerBalance, bal);

      // Record transaction
      await em.save(SellerTransaction, em.create(SellerTransaction, {
        sellerId,
        orderId,
        type: SellerTxType.CashOrderCommission,
        amount: String(netAmount),
        commissionRate: String(commissionRate),
        commissionAmount: String(commissionAmount),
        status: 'settled',
        description: `Naqd buyurtma yetkazildi. Komissiya (${commissionRate}%) qarzga yozildi`,
      }));
    });

    // Try to auto-repay debt from available balance
    await this.autoRepayDebt(sellerId);
  }

  /**
   * Called when an ONLINE order is delivered.
   * Creates a pending transaction that settles after N hours.
   */
  async recordOnlineOrderDelivery(opts: {
    sellerId: string;
    orderId: string;
    orderTotal: number;
    commissionRate: number;
  }): Promise<void> {
    const { sellerId, orderId, orderTotal, commissionRate } = opts;
    const commissionAmount = Math.round(orderTotal * commissionRate) / 100;
    const netAmount = orderTotal - commissionAmount;
    const hours = this.settings.getNumber(SETTING_KEYS.SETTLEMENT_HOURS, 24);

    const settlesAt = new Date();
    settlesAt.setHours(settlesAt.getHours() + hours);

    await this.dataSource.transaction(async (em) => {
      const bal = (await em.findOne(SellerBalance, {
        where: { sellerId },
        lock: { mode: 'pessimistic_write' },
      })) ?? em.create(SellerBalance, { sellerId });

      bal.pendingBalance = String(parseFloat(bal.pendingBalance ?? '0') + netAmount);
      await em.save(SellerBalance, bal);

      await em.save(SellerTransaction, em.create(SellerTransaction, {
        sellerId,
        orderId,
        type: SellerTxType.OnlineOrderPending,
        amount: String(netAmount),
        commissionRate: String(commissionRate),
        commissionAmount: String(commissionAmount),
        status: 'pending',
        settlesAt,
        description: `Online buyurtma yetkazildi. ${hours} soatdan keyin chiqariladi`,
      }));
    });
  }

  /** Deduct available balance to repay debt (called automatically after credits). */
  async autoRepayDebt(sellerId: string): Promise<void> {
    // Cheap unlocked pre-check to skip starting a transaction when there's
    // obviously nothing to do; the real numbers are re-read under lock below.
    const precheck = await this.balances.findOne({ where: { sellerId } });
    if (!precheck) return;
    if (parseFloat(precheck.debtBalance) <= 0 || parseFloat(precheck.availableBalance) <= 0) return;

    await this.dataSource.transaction(async (em) => {
      const b = await em.findOne(SellerBalance, {
        where: { sellerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!b) return;

      const available = parseFloat(b.availableBalance);
      const debt = parseFloat(b.debtBalance);
      if (!Number.isFinite(available) || !Number.isFinite(debt) || debt <= 0 || available <= 0) return;
      const repayAmount = Math.min(available, debt);

      b.availableBalance = String(available - repayAmount);
      b.debtBalance = String(debt - repayAmount);

      if (parseFloat(b.debtBalance) <= 0) {
        b.debtBalance = '0';
        b.debtDueDate = null;
        // Re-activate shops if they were deactivated due to debt
        await em.update(Shop, { ownerId: sellerId, deactivatedByDebt: true }, {
          isActive: true,
          deactivatedByDebt: false,
        });
      }

      await em.save(SellerBalance, b);
      await em.save(SellerTransaction, em.create(SellerTransaction, {
        sellerId,
        type: SellerTxType.DebtRepaid,
        amount: String(-repayAmount),
        status: 'settled',
        description: `Qarz avtomatik so'ndirildi: ${repayAmount.toLocaleString()} so'm`,
      }));
    });
  }

  /**
   * Seller requests a withdrawal.
   *
   * Debt-first repayment: if the seller has outstanding debt, it is repaid
   * out of the requested amount before any payout is created — either
   * partially (debt < amount: debt cleared, remainder paid out) or fully
   * (debt >= amount: the whole amount repays debt, no payout is created).
   */
  async requestWithdrawal(sellerId: string, dto: {
    amount: number;
    bankCardNumber: string;
    bankCardHolderName: string;
  }): Promise<WithdrawalRequest> {
    // Belt-and-suspenders: the DTO already validates this, but never let a
    // NaN/negative/non-finite amount reach the arithmetic below.
    if (!Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException('Yechib olish miqdori noto\'g\'ri');
    }

    // Debt repayment must be committed even when it consumes the whole
    // requested amount (no payout left) — so we resolve the transaction
    // normally and only throw the "went to debt" message afterwards,
    // rather than rolling back a debt repayment that already happened.
    const result = await this.dataSource.transaction(async (em) => {
      const b = await em.findOne(SellerBalance, {
        where: { sellerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!b) throw new BadRequestException('Balans topilmadi');

      const available = parseFloat(b.availableBalance);
      const debt = parseFloat(b.debtBalance);

      if (!Number.isFinite(available) || available <= 0) {
        throw new BadRequestException('Yechib olish uchun mablag\' yo\'q');
      }

      // Total drawn from the available balance this request (bounded by what's there).
      const totalDrawn = Math.min(dto.amount, available);
      if (totalDrawn <= 0) {
        throw new BadRequestException('Yechib olish miqdori noto\'g\'ri');
      }
      // Debt-first: repay as much of the drawn amount into debt as possible.
      const debtRepaid = debt > 0 ? Math.min(debt, totalDrawn) : 0;
      const payout = totalDrawn - debtRepaid;

      b.availableBalance = String(available - totalDrawn);
      if (debtRepaid > 0) {
        const newDebt = debt - debtRepaid;
        b.debtBalance = String(Math.max(0, newDebt));
        if (parseFloat(b.debtBalance) <= 0) {
          b.debtDueDate = null;
          await em.update(Shop, { ownerId: sellerId, deactivatedByDebt: true }, {
            isActive: true,
            deactivatedByDebt: false,
          });
        }
      }
      await em.save(SellerBalance, b);

      if (debtRepaid > 0) {
        await em.save(SellerTransaction, em.create(SellerTransaction, {
          sellerId,
          type: SellerTxType.DebtRepaid,
          amount: String(-debtRepaid),
          status: 'settled',
          description: `Yechib olishdan qarz so\'ndirildi: ${debtRepaid.toLocaleString()} so'm`,
        }));
      }

      if (payout <= 0) {
        // Entire drawn amount went to debt — no payout request to create.
        return null;
      }

      const req = em.create(WithdrawalRequest, {
        sellerId,
        amount: String(payout),
        bankCardNumber: dto.bankCardNumber,
        bankCardHolderName: dto.bankCardHolderName,
        status: WithdrawalStatus.Pending,
      });
      await em.save(WithdrawalRequest, req);

      await em.save(SellerTransaction, em.create(SellerTransaction, {
        sellerId,
        type: SellerTxType.WithdrawalRequested,
        amount: String(-payout),
        status: 'settled',
        description: `Yechib olish so\'rovi: ${payout.toLocaleString()} so'm`,
      }));

      return req;
    });

    if (!result) {
      throw new BadRequestException('Mablag\'ingiz qarzni to\'lash uchun sarflandi');
    }
    return result;
  }

  async getMyWithdrawals(sellerId: string): Promise<WithdrawalRequest[]> {
    return this.withdrawals.find({ where: { sellerId }, order: { requestedAt: 'DESC' } });
  }

  /** Admin: list all pending withdrawals */
  async adminListWithdrawals(status?: WithdrawalStatus): Promise<WithdrawalRequest[]> {
    return this.withdrawals.find({
      where: status ? { status } : {},
      order: { requestedAt: 'DESC' },
    });
  }

  /** Admin: approve/reject withdrawal */
  async adminProcessWithdrawal(id: string, adminId: string, approve: boolean, note?: string): Promise<WithdrawalRequest> {
    const req = await this.withdrawals.findOne({ where: { id } });
    if (!req) throw new NotFoundException('So\'rov topilmadi');
    if (req.status !== WithdrawalStatus.Pending && req.status !== WithdrawalStatus.Processing) {
      throw new BadRequestException('So\'rov allaqachon yakunlangan');
    }

    req.status = approve ? WithdrawalStatus.Completed : WithdrawalStatus.Rejected;
    req.processedAt = new Date();
    req.processedByAdminId = adminId;
    req.adminNote = note ?? null;

    if (!approve) {
      // Return money to seller balance
      await this.dataSource.transaction(async (em) => {
        const b = await em.findOne(SellerBalance, {
          where: { sellerId: req.sellerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (b) {
          b.availableBalance = String(parseFloat(b.availableBalance) + parseFloat(req.amount));
          await em.save(SellerBalance, b);
        }
        await em.save(WithdrawalRequest, req);
        await em.save(SellerTransaction, em.create(SellerTransaction, {
          sellerId: req.sellerId,
          type: SellerTxType.AdminAdjustment,
          amount: req.amount,
          status: 'settled',
          description: `Yechib olish rad etildi, balansga qaytarildi. Sabab: ${note ?? ''}`,
        }));
      });
      void this.push.sendToUser(req.sellerId, {
        title: 'Yechib olish rad etildi',
        body: note ? `Sabab: ${note}` : `${parseFloat(req.amount).toLocaleString()} so'm balansga qaytarildi`,
        data: { kind: 'withdrawal:rejected' },
      });
      return req;
    }

    // Mark completed
    await this.dataSource.transaction(async (em) => {
      await em.save(WithdrawalRequest, req);
      await em.save(SellerTransaction, em.create(SellerTransaction, {
        sellerId: req.sellerId,
        type: SellerTxType.WithdrawalCompleted,
        amount: String(-parseFloat(req.amount)),
        status: 'settled',
        description: `Yechib olish bajarildi: ${parseFloat(req.amount).toLocaleString()} so'm`,
      }));
    });
    void this.push.sendToUser(req.sellerId, {
      title: 'Mablag\' yechildi',
      body: `${parseFloat(req.amount).toLocaleString()} so'm kartangizga o'tkazildi`,
      data: { kind: 'withdrawal:completed' },
    });
    return req;
  }

  /** Admin: get balance for any seller */
  async adminGetBalance(sellerId: string): Promise<SellerBalance> {
    return this.ensureBalance(sellerId);
  }

  /** Admin: get transactions for any seller */
  async adminGetTransactions(sellerId: string, page = 0): Promise<SellerTransaction[]> {
    return this.getTransactions(sellerId, page);
  }

  /** Admin: manual balance adjustment */
  async adminAdjust(sellerId: string, amount: number, description: string): Promise<SellerBalance> {
    if (!Number.isFinite(amount)) {
      throw new BadRequestException('Noto\'g\'ri miqdor');
    }
    await this.dataSource.transaction(async (em) => {
      const b = (await em.findOne(SellerBalance, {
        where: { sellerId },
        lock: { mode: 'pessimistic_write' },
      })) ?? em.create(SellerBalance, { sellerId });

      if (amount > 0) {
        b.availableBalance = String(parseFloat(b.availableBalance ?? '0') + amount);
      } else {
        const debit = Math.abs(amount);
        const avail = parseFloat(b.availableBalance ?? '0');
        b.availableBalance = String(Math.max(0, avail - debit));
      }
      await em.save(SellerBalance, b);

      await em.save(SellerTransaction, em.create(SellerTransaction, {
        sellerId,
        type: SellerTxType.AdminAdjustment,
        amount: String(amount),
        status: 'settled',
        description,
      }));
    });
    return this.ensureBalance(sellerId);
  }

  /** Cron: settle pending online orders that have passed their settlesAt time */
  @Cron(CronExpression.EVERY_HOUR)
  async settlePendingTransactions() {
    const now = new Date();
    const pending = await this.txs.find({
      where: { status: 'pending', type: SellerTxType.OnlineOrderPending, settlesAt: LessThan(now) },
    });
    if (!pending.length) return;

    // An order under an OPEN customer complaint must not auto-settle — it
    // stays pending until an admin resolves it via force-settle/force-refund
    // (SPEC.md §8.5, §21).
    const orderIds = pending.map((t) => t.orderId).filter((id): id is string => !!id);
    const disputedOrderIds = await this.complaints.openComplaintOrderIds(orderIds);
    const toSettle = pending.filter((t) => !t.orderId || !disputedOrderIds.has(t.orderId));
    const skipped = pending.length - toSettle.length;
    if (skipped > 0) {
      this.log.log(`Skipping settlement for ${skipped} pending transaction(s) under open complaint`);
    }
    if (!toSettle.length) return;

    this.log.log(`Settling ${toSettle.length} pending transactions`);

    for (const tx of toSettle) {
      await this.dataSource.transaction(async (em) => {
        const b = await em.findOne(SellerBalance, {
          where: { sellerId: tx.sellerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!b) return;

        const amount = parseFloat(tx.amount);
        b.pendingBalance = String(Math.max(0, parseFloat(b.pendingBalance) - amount));
        b.availableBalance = String(parseFloat(b.availableBalance) + amount);
        await em.save(SellerBalance, b);

        tx.status = 'settled';
        await em.save(SellerTransaction, tx);

        // Also record the settlement as a new tx for clarity
        await em.save(SellerTransaction, em.create(SellerTransaction, {
          sellerId: tx.sellerId,
          orderId: tx.orderId,
          type: SellerTxType.PendingSettled,
          amount: tx.amount,
          status: 'settled',
          description: `Online buyurtma mablag'i chiqarildi`,
        }));
      });

      // Try auto-repay debt after each settlement
      await this.autoRepayDebt(tx.sellerId);
    }
  }

  /** Cron: deactivate shops whose debt is overdue */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async deactivateOverdueDebtShops() {
    const today = new Date().toISOString().split('T')[0];

    const overdueBalances = await this.balances
      .createQueryBuilder('b')
      .where('b.debtBalance > 0')
      .andWhere('b.debtDueDate IS NOT NULL')
      .andWhere('b.debtDueDate < :today', { today })
      .getMany();

    if (!overdueBalances.length) return;

    this.log.warn(`Deactivating shops for ${overdueBalances.length} sellers with overdue debt`);

    for (const bal of overdueBalances) {
      await this.shops.update(
        { ownerId: bal.sellerId, isActive: true },
        { isActive: false, deactivatedByDebt: true },
      );
    }
  }

  /** Cron: send debt reminder 3 days before due date (at 10 AM daily). */
  @Cron('0 10 * * *')
  async sendDebtReminders() {
    const now = new Date();
    const in3d = new Date(now);
    in3d.setDate(in3d.getDate() + 3);
    const dueSoon = in3d.toISOString().split('T')[0];
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const debtors = await this.balances
      .createQueryBuilder('b')
      .where('b.debtBalance > 0')
      .andWhere('b.debtDueDate IS NOT NULL')
      .andWhere('b.debtDueDate = :due', { due: dueSoon })
      .andWhere('(b.lastDebtReminderAt IS NULL OR b.lastDebtReminderAt < :yesterday)', { yesterday })
      .getMany();

    for (const bal of debtors) {
      const debtAmt = parseFloat(bal.debtBalance).toLocaleString('ru');
      void this.push.sendToUser(bal.sellerId, {
        title: `Qarz eslatmasi — 3 kun qoldi`,
        body: `${debtAmt} so'm qarzingizni vaqtida to'lang, aks holda do'koningiz to'xtatiladi.`,
        data: { kind: 'debt_reminder', dueDate: bal.debtDueDate },
      });
      bal.lastDebtReminderAt = new Date();
      await this.balances.save(bal);
    }
    if (debtors.length > 0) this.log.log(`Sent debt reminders to ${debtors.length} seller(s)`);
  }

  /** Admin: immediately settle a pending online-order transaction (skip 24h wait). */
  async adminForceSettle(txId: string, adminId: string): Promise<SellerTransaction> {
    const tx = await this.txs.findOne({ where: { id: txId } });
    if (!tx) throw new NotFoundException('Tranzaksiya topilmadi');
    if (tx.type !== SellerTxType.OnlineOrderPending || tx.status !== 'pending') {
      throw new BadRequestException('Faqat pending online tranzaksiyani force settle qilish mumkin');
    }

    await this.dataSource.transaction(async (em) => {
      const b = await em.findOne(SellerBalance, {
        where: { sellerId: tx.sellerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!b) throw new NotFoundException('Balans topilmadi');

      const amount = parseFloat(tx.amount);
      b.pendingBalance = String(Math.max(0, parseFloat(b.pendingBalance) - amount));
      b.availableBalance = String(parseFloat(b.availableBalance) + amount);
      await em.save(SellerBalance, b);

      tx.status = 'settled';
      await em.save(SellerTransaction, tx);

      await em.save(SellerTransaction, em.create(SellerTransaction, {
        sellerId: tx.sellerId,
        orderId: tx.orderId,
        type: SellerTxType.PendingSettled,
        amount: tx.amount,
        status: 'settled',
        description: `Admin force settle (admin: ${adminId})`,
      }));
    });

    await this.autoRepayDebt(tx.sellerId);
    return this.txs.findOneOrFail({ where: { id: txId } });
  }

  /** Admin: refund a pending online-order transaction (returns money to platform). */
  async adminForceRefund(txId: string, adminId: string): Promise<SellerTransaction> {
    const tx = await this.txs.findOne({ where: { id: txId } });
    if (!tx) throw new NotFoundException('Tranzaksiya topilmadi');
    if (tx.type !== SellerTxType.OnlineOrderPending || tx.status !== 'pending') {
      throw new BadRequestException('Faqat pending online tranzaksiyani force refund qilish mumkin');
    }

    await this.dataSource.transaction(async (em) => {
      const b = await em.findOne(SellerBalance, {
        where: { sellerId: tx.sellerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!b) throw new NotFoundException('Balans topilmadi');

      const amount = parseFloat(tx.amount);
      b.pendingBalance = String(Math.max(0, parseFloat(b.pendingBalance) - amount));
      await em.save(SellerBalance, b);

      tx.status = 'cancelled';
      await em.save(SellerTransaction, tx);

      await em.save(SellerTransaction, em.create(SellerTransaction, {
        sellerId: tx.sellerId,
        orderId: tx.orderId,
        type: SellerTxType.RefundDebit,
        amount: tx.amount,
        status: 'settled',
        description: `Admin force refund (admin: ${adminId})`,
      }));
    });

    return this.txs.findOneOrFail({ where: { id: txId } });
  }

  /** Admin: list sellers with overdue debt (debtDueDate passed and debtBalance > 0). */
  async adminListOverdueDebts(): Promise<SellerBalance[]> {
    const today = new Date().toISOString().split('T')[0];
    return this.balances
      .createQueryBuilder('b')
      .where('b.debtBalance > 0')
      .andWhere('b.debtDueDate IS NOT NULL')
      .andWhere('b.debtDueDate < :today', { today })
      .orderBy('b.debtDueDate', 'ASC')
      .getMany();
  }

  /** Admin: forgive a seller's entire debt (write it off). */
  async adminForgiveDebt(sellerId: string, adminId: string, reason: string): Promise<SellerBalance> {
    return this.dataSource.transaction(async (em) => {
      const b = await em.findOne(SellerBalance, {
        where: { sellerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!b) throw new NotFoundException('Balans topilmadi');
      const forgiven = b.debtBalance;
      b.debtBalance = '0';
      b.debtDueDate = null;
      await em.save(SellerBalance, b);
      await em.save(SellerTransaction, em.create(SellerTransaction, {
        sellerId,
        type: SellerTxType.AdminAdjustment,
        amount: `-${forgiven}`,
        status: 'settled',
        description: `Admin qarz kechirdi: ${reason} (admin: ${adminId})`,
      }));
      // Re-activate shops if they were deactivated by debt
      await this.shops.update(
        { ownerId: sellerId, deactivatedByDebt: true },
        { isActive: true, deactivatedByDebt: false },
      );
      return b;
    });
  }

  /** Admin: extend the debt due date by N days. */
  async adminExtendDebtDue(sellerId: string, days: number): Promise<SellerBalance> {
    return this.dataSource.transaction(async (em) => {
      const b = await em.findOne(SellerBalance, {
        where: { sellerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!b) throw new NotFoundException('Balans topilmadi');
      const current = b.debtDueDate ? new Date(b.debtDueDate) : new Date();
      current.setDate(current.getDate() + days);
      b.debtDueDate = current.toISOString().split('T')[0];
      // Re-activate shops if they were deactivated by expired debt
      await em.update(Shop, { ownerId: sellerId, deactivatedByDebt: true }, {
        isActive: true,
        deactivatedByDebt: false,
      });
      return em.save(SellerBalance, b);
    });
  }
}
