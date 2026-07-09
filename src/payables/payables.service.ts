import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import {
  AddChargeDto,
  AddPaymentDto,
  CreateAccountDto,
  UpdateAccountDto,
} from './dto/payable.dto';
import { PayableCharge } from './entities/payable-charge.entity';
import { PayablePayment } from './entities/payable-payment.entity';
import { SupplierAccount } from './entities/supplier-account.entity';

export interface PayableAccountSummary {
  id: string;
  name: string;
  category: string;
  phone: string | null;
  totalCharged: number;
  totalPaid: number;
  balance: number;
  lastActivityAt: string | null;
  nearestDueDate: string | null;
}

export interface PayableShopSummary {
  shopId: string;
  shopName: string;
  outstanding: number;
  creditors: number;
  overdue: number;
}

/**
 * Tracks what a shop owes to its own external creditors — suppliers,
 * landlord, utility company, lenders, staff — as opposed to `debts/`, which
 * tracks what customers owe the shop. Same account-ledger shape, opposite
 * direction: charges raise the balance owed, payments lower it.
 */
@Injectable()
export class PayablesService {
  constructor(
    @InjectRepository(SupplierAccount)
    private readonly accounts: Repository<SupplierAccount>,
    @InjectRepository(PayableCharge)
    private readonly charges: Repository<PayableCharge>,
    @InjectRepository(PayablePayment)
    private readonly payments: Repository<PayablePayment>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(ShopStaff)
    private readonly staff: Repository<ShopStaff>,
    private readonly dataSource: DataSource,
  ) {}

  /** Owner, or active staff with the `payables.manage` permission. */
  private async assertCanManage(userId: string, shopId: string): Promise<void> {
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException("Do'kon topilmadi");
    if (shop.ownerId === userId) return;
    const staff = await this.staff.findOne({
      where: { shopId, userId, isActive: true },
    });
    if (!staff || !staff.permissions?.includes('payables.manage')) {
      throw new ForbiddenException("Majburiyatlar bo'limiga ruxsatingiz yo'q");
    }
  }

  private async getOwnAccount(
    shopId: string,
    accountId: string,
  ): Promise<SupplierAccount> {
    const account = await this.accounts.findOne({
      where: { id: accountId, shopId },
    });
    if (!account) throw new NotFoundException('Kreditor topilmadi');
    return account;
  }

  async createAccount(
    userId: string,
    shopId: string,
    dto: CreateAccountDto,
  ): Promise<SupplierAccount> {
    await this.assertCanManage(userId, shopId);
    return this.accounts.save(
      this.accounts.create({
        shopId,
        name: dto.name.trim(),
        category: dto.category,
        phone: dto.phone?.trim() || null,
        note: dto.note?.trim() || null,
      }),
    );
  }

  async updateAccount(
    userId: string,
    shopId: string,
    accountId: string,
    dto: UpdateAccountDto,
  ): Promise<SupplierAccount> {
    await this.assertCanManage(userId, shopId);
    const account = await this.getOwnAccount(shopId, accountId);
    if (dto.name !== undefined) account.name = dto.name.trim();
    if (dto.category !== undefined) account.category = dto.category;
    if (dto.phone !== undefined) account.phone = dto.phone.trim() || null;
    if (dto.note !== undefined) account.note = dto.note.trim() || null;
    if (dto.isArchived !== undefined) account.isArchived = dto.isArchived;
    return this.accounts.save(account);
  }

  async addCharge(
    userId: string,
    shopId: string,
    dto: AddChargeDto,
  ): Promise<PayableCharge> {
    await this.assertCanManage(userId, shopId);
    await this.getOwnAccount(shopId, dto.accountId); // ensures account belongs to this shop
    return this.charges.save(
      this.charges.create({
        shopId,
        accountId: dto.accountId,
        amount: dto.amount,
        description: dto.description?.trim() || null,
        dueDate: dto.dueDate ?? null,
        note: dto.note?.trim() || null,
        createdByUserId: userId,
      }),
    );
  }

  async addPayment(
    userId: string,
    shopId: string,
    dto: AddPaymentDto,
  ): Promise<PayablePayment> {
    await this.assertCanManage(userId, shopId);
    await this.getOwnAccount(shopId, dto.accountId);
    // Serialize concurrent payments for the same account with a transaction
    // advisory lock, then check the balance and insert atomically — so two
    // simultaneous payments can't both slip past the overpay guard.
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `payable:${shopId}:${dto.accountId}`,
      ]);
      const [charges, payments] = await Promise.all([
        manager.find(PayableCharge, {
          where: { shopId, accountId: dto.accountId },
          select: { amount: true },
        }),
        manager.find(PayablePayment, {
          where: { shopId, accountId: dto.accountId },
          select: { amount: true },
        }),
      ]);
      const balance =
        charges.reduce((s, c) => s + c.amount, 0) -
        payments.reduce((s, p) => s + p.amount, 0);
      if (balance <= 0)
        throw new BadRequestException("Bu kreditorga qarzingiz yo'q");
      if (dto.amount > balance) {
        throw new BadRequestException(
          `To'lov qarzdan oshib ketdi (qolgan: ${balance} so'm)`,
        );
      }
      return manager.save(
        manager.create(PayablePayment, {
          shopId,
          accountId: dto.accountId,
          amount: dto.amount,
          note: dto.note?.trim() || null,
          createdByUserId: userId,
        }),
      );
    });
  }

  /** All creditors with a charge history, grouped by account, balance first. */
  async listAccounts(
    userId: string,
    shopId: string,
  ): Promise<PayableAccountSummary[]> {
    await this.assertCanManage(userId, shopId);
    return this.aggregateAccounts(shopId);
  }

  /** Balance per account for one shop, no access check (reused by admin methods). */
  private async aggregateAccounts(
    shopId: string,
  ): Promise<PayableAccountSummary[]> {
    const accounts = await this.accounts.find({ where: { shopId } });
    if (accounts.length === 0) return [];

    const chargeRows = await this.charges
      .createQueryBuilder('c')
      .select('c.accountId', 'accountId')
      .addSelect('SUM(c.amount)', 'totalCharged')
      .addSelect('MAX(c.createdAt)', 'lastAt')
      .addSelect('MIN(c.dueDate)', 'nearestDueDate')
      .where('c.shopId = :shopId', { shopId })
      .groupBy('c.accountId')
      .getRawMany<{
        accountId: string;
        totalCharged: string;
        lastAt: string;
        nearestDueDate: string | null;
      }>();

    const paymentRows = await this.payments
      .createQueryBuilder('p')
      .select('p.accountId', 'accountId')
      .addSelect('SUM(p.amount)', 'totalPaid')
      .addSelect('MAX(p.createdAt)', 'lastAt')
      .where('p.shopId = :shopId', { shopId })
      .groupBy('p.accountId')
      .getRawMany<{ accountId: string; totalPaid: string; lastAt: string }>();

    const chargeMap = new Map(chargeRows.map((r) => [r.accountId, r]));
    const paymentMap = new Map(paymentRows.map((r) => [r.accountId, r]));

    const summaries: PayableAccountSummary[] = accounts.map((account) => {
      const c = chargeMap.get(account.id);
      const p = paymentMap.get(account.id);
      const totalCharged = Number(c?.totalCharged ?? 0);
      const totalPaid = Number(p?.totalPaid ?? 0);
      const lastActivityAt =
        c && p
          ? p.lastAt > c.lastAt
            ? p.lastAt
            : c.lastAt
          : (c?.lastAt ?? p?.lastAt ?? null);
      return {
        id: account.id,
        name: account.name,
        category: account.category,
        phone: account.phone,
        totalCharged,
        totalPaid,
        balance: totalCharged - totalPaid,
        lastActivityAt,
        nearestDueDate: c?.nearestDueDate ?? null,
      };
    });

    // Outstanding (balance > 0) first, then by most recent activity.
    summaries.sort((a, b) => {
      if ((b.balance > 0 ? 1 : 0) !== (a.balance > 0 ? 1 : 0)) {
        return (b.balance > 0 ? 1 : 0) - (a.balance > 0 ? 1 : 0);
      }
      return (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '');
    });
    return summaries;
  }

  /** Full history for one creditor: charges + payments + running balance. */
  async getAccount(userId: string, shopId: string, accountId: string) {
    await this.assertCanManage(userId, shopId);
    const account = await this.getOwnAccount(shopId, accountId);
    const [charges, payments] = await Promise.all([
      this.charges.find({
        where: { shopId, accountId },
        order: { createdAt: 'DESC' },
      }),
      this.payments.find({
        where: { shopId, accountId },
        order: { createdAt: 'DESC' },
      }),
    ]);
    const totalCharged = charges.reduce((s, c) => s + c.amount, 0);
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    return {
      account,
      totalCharged,
      totalPaid,
      balance: totalCharged - totalPaid,
      charges,
      payments,
    };
  }

  /** Shop-wide outstanding total — shown on the ledger header. */
  async summary(
    userId: string,
    shopId: string,
  ): Promise<{ outstanding: number; creditors: number; overdue: number }> {
    const accounts = await this.listAccounts(userId, shopId);
    return this.summarizeAccounts(accounts);
  }

  private summarizeAccounts(accounts: PayableAccountSummary[]) {
    const today = new Date().toISOString().slice(0, 10);
    const outstanding = accounts.reduce(
      (s, a) => s + Math.max(0, a.balance),
      0,
    );
    const creditors = accounts.filter((a) => a.balance > 0).length;
    const overdue = accounts.filter(
      (a) => a.balance > 0 && !!a.nearestDueDate && a.nearestDueDate < today,
    ).length;
    return { outstanding, creditors, overdue };
  }

  /* ─── Admin (read-only, cross-shop) ─── */

  async adminListShopSummaries(): Promise<PayableShopSummary[]> {
    const rows = await this.accounts
      .createQueryBuilder('a')
      .select('DISTINCT a.shopId', 'shopId')
      .getRawMany<{ shopId: string }>();
    if (rows.length === 0) return [];

    const shops = await this.shops.findBy({
      id: In(rows.map((r) => r.shopId)),
    });
    const shopNameMap = new Map(shops.map((s) => [s.id, s.name]));

    const results = await Promise.all(
      rows.map(async ({ shopId }) => {
        const accounts = await this.aggregateAccounts(shopId);
        const { outstanding, creditors, overdue } =
          this.summarizeAccounts(accounts);
        return {
          shopId,
          shopName: shopNameMap.get(shopId) ?? '',
          outstanding,
          creditors,
          overdue,
        };
      }),
    );
    return results
      .filter((r) => r.creditors > 0)
      .sort((a, b) => b.outstanding - a.outstanding);
  }

  async adminGetShopAccounts(shopId: string): Promise<PayableAccountSummary[]> {
    return this.aggregateAccounts(shopId);
  }
}
