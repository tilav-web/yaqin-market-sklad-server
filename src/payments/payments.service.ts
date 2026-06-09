import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';

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
      const bal = await em.findOne(SellerBalance, { where: { sellerId } }) ??
        em.create(SellerBalance, { sellerId });

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
      const bal = await em.findOne(SellerBalance, { where: { sellerId } }) ??
        em.create(SellerBalance, { sellerId });

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
    const bal = await this.balances.findOne({ where: { sellerId } });
    if (!bal) return;

    const available = parseFloat(bal.availableBalance);
    const debt = parseFloat(bal.debtBalance);
    if (debt <= 0 || available <= 0) return;

    const repayAmount = Math.min(available, debt);

    await this.dataSource.transaction(async (em) => {
      const b = await em.findOne(SellerBalance, { where: { sellerId } });
      if (!b) return;

      b.availableBalance = String(parseFloat(b.availableBalance) - repayAmount);
      b.debtBalance = String(parseFloat(b.debtBalance) - repayAmount);

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

  /** Seller requests a withdrawal */
  async requestWithdrawal(sellerId: string, dto: {
    amount: number;
    bankCardNumber: string;
    bankCardHolderName: string;
  }): Promise<WithdrawalRequest> {
    const bal = await this.ensureBalance(sellerId);
    const available = parseFloat(bal.availableBalance);
    const debt = parseFloat(bal.debtBalance);

    if (available <= 0) {
      throw new BadRequestException('Yechib olish uchun mablag\' yo\'q');
    }

    // If debt exists, deduct it first
    const actualWithdraw = Math.min(dto.amount, available);
    if (debt > 0) {
      const repayFirst = Math.min(debt, actualWithdraw);
      if (repayFirst >= actualWithdraw) {
        // All goes to debt, nothing left to withdraw
        await this.autoRepayDebt(sellerId);
        throw new BadRequestException('Mablag\'ingiz qarzni to\'lash uchun sarflandi');
      }
    }

    if (actualWithdraw <= 0) {
      throw new BadRequestException('Yechib olish miqdori noto\'g\'ri');
    }

    await this.dataSource.transaction(async (em) => {
      const b = await em.findOne(SellerBalance, { where: { sellerId } });
      if (!b) throw new BadRequestException('Balans topilmadi');

      b.availableBalance = String(parseFloat(b.availableBalance) - actualWithdraw);
      await em.save(SellerBalance, b);

      const req = em.create(WithdrawalRequest, {
        sellerId,
        amount: String(actualWithdraw),
        bankCardNumber: dto.bankCardNumber,
        bankCardHolderName: dto.bankCardHolderName,
        status: WithdrawalStatus.Pending,
      });
      await em.save(WithdrawalRequest, req);

      await em.save(SellerTransaction, em.create(SellerTransaction, {
        sellerId,
        type: SellerTxType.WithdrawalRequested,
        amount: String(-actualWithdraw),
        status: 'settled',
        description: `Yechib olish so\'rovi: ${actualWithdraw.toLocaleString()} so'm`,
      }));
    });

    return this.withdrawals.findOne({ where: { sellerId }, order: { requestedAt: 'DESC' } }) as Promise<WithdrawalRequest>;
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
        const b = await em.findOne(SellerBalance, { where: { sellerId: req.sellerId } });
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
    await this.dataSource.transaction(async (em) => {
      const b = await em.findOne(SellerBalance, { where: { sellerId } }) ??
        em.create(SellerBalance, { sellerId });

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

    this.log.log(`Settling ${pending.length} pending transactions`);

    for (const tx of pending) {
      await this.dataSource.transaction(async (em) => {
        const b = await em.findOne(SellerBalance, { where: { sellerId: tx.sellerId } });
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
      const b = await em.findOne(SellerBalance, { where: { sellerId: tx.sellerId } });
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
      const b = await em.findOne(SellerBalance, { where: { sellerId: tx.sellerId } });
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
      const b = await em.findOne(SellerBalance, { where: { sellerId } });
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
      await em.getRepository(require('../shops/entities/shop.entity').Shop).update(
        { ownerId: sellerId, deactivatedByDebt: true },
        { isActive: true, deactivatedByDebt: false },
      );
      return b;
    });
  }

  /** Admin: extend the debt due date by N days. */
  async adminExtendDebtDue(sellerId: string, days: number): Promise<SellerBalance> {
    const b = await this.balances.findOne({ where: { sellerId } });
    if (!b) throw new NotFoundException('Balans topilmadi');
    const current = b.debtDueDate ? new Date(b.debtDueDate) : new Date();
    current.setDate(current.getDate() + days);
    b.debtDueDate = current.toISOString().split('T')[0];
    // Re-activate shops if they were deactivated by expired debt
    await this.shops.update(
      { ownerId: sellerId, deactivatedByDebt: true },
      { isActive: true, deactivatedByDebt: false },
    );
    return this.balances.save(b);
  }
}
