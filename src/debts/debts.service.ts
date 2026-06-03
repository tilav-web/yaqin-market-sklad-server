import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { MovementType } from '../products/entities/inventory-movement.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { consumeFifo } from '../products/inventory.util';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { AddPaymentDto, CreateDebtDto } from './dto/debt.dto';
import { DebtLine, Debt } from './entities/debt.entity';
import { DebtPayment } from './entities/debt-payment.entity';

export interface DebtAccount {
  customerName: string;
  customerPhone: string;
  totalDebt: number;
  totalPaid: number;
  balance: number;
  lastActivityAt: string;
}

@Injectable()
export class DebtsService {
  constructor(
    @InjectRepository(Debt)
    private readonly debts: Repository<Debt>,
    @InjectRepository(DebtPayment)
    private readonly payments: Repository<DebtPayment>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(ShopStaff)
    private readonly staff: Repository<ShopStaff>,
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
    private readonly dataSource: DataSource,
  ) {}

  /** Owner, or active staff with the `debt.manage` permission. */
  private async assertCanManage(userId: string, shopId: string): Promise<void> {
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Do\'kon topilmadi');
    if (shop.ownerId === userId) return;
    const staff = await this.staff.findOne({ where: { shopId, userId, isActive: true } });
    if (!staff || !staff.permissions?.includes('debt.manage')) {
      throw new ForbiddenException('Qarz daftariga ruxsatingiz yo\'q');
    }
  }

  async createDebt(userId: string, shopId: string, dto: CreateDebtDto): Promise<Debt> {
    await this.assertCanManage(userId, shopId);

    const inputs = dto.lines ?? [];
    const lines: DebtLine[] = [];
    let itemsTotal = 0;

    let variantMap = new Map<string, ProductVariant>();
    if (inputs.length > 0) {
      const ids = inputs.map((l) => l.variantId);
      const found = await this.variants.find({ where: { id: In(ids), shopId } });
      variantMap = new Map(found.map((v) => [v.id, v]));
      for (const input of inputs) {
        const v = variantMap.get(input.variantId);
        if (!v) throw new NotFoundException('Mahsulot topilmadi');
        if (dto.decrementStock && v.stock < input.quantity) {
          throw new BadRequestException(`"${v.name}" qoldig'i yetarli emas (${v.stock} ta)`);
        }
        const unitPrice = v.discountPrice ?? v.price;
        const lineTotal = unitPrice * input.quantity;
        itemsTotal += lineTotal;
        lines.push({ variantId: v.id, name: v.name, quantity: input.quantity, unitPrice, lineTotal });
      }
    }

    const extraCharge = dto.extraCharge ?? 0;
    const total = itemsTotal + extraCharge;
    if (total <= 0) throw new BadRequestException('Qarz summasi 0 dan katta bo\'lishi kerak');

    return this.dataSource.transaction(async (manager) => {
      if (dto.decrementStock && lines.length > 0) {
        for (const line of lines) {
          if (!line.variantId) continue;
          // Lock + re-check the row inside the transaction to avoid overselling.
          const locked = await manager.findOne(ProductVariant, {
            where: { id: line.variantId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!locked || locked.stock < line.quantity) {
            throw new BadRequestException(`"${line.name}" qoldig'i yetarli emas`);
          }
          await consumeFifo(manager, {
            variant: locked,
            quantity: line.quantity,
            type: MovementType.Sold,
            userId,
            reason: `Qarzga berildi — ${dto.customerName}`,
          });
        }
      }
      return manager.save(
        manager.create(Debt, {
          shopId,
          customerName: dto.customerName.trim(),
          customerPhone: dto.customerPhone.trim(),
          lines,
          itemsTotal,
          extraCharge,
          total,
          note: dto.note?.trim() || null,
          stockDecremented: dto.decrementStock,
          createdByUserId: userId,
        }),
      );
    });
  }

  async addPayment(userId: string, shopId: string, dto: AddPaymentDto): Promise<DebtPayment> {
    await this.assertCanManage(userId, shopId);
    // Don't accept more than the customer actually owes.
    const account = await this.getAccount(userId, shopId, dto.customerPhone.trim());
    if (account.balance <= 0) {
      throw new BadRequestException('Bu mijozda qarz yo\'q');
    }
    if (dto.amount > account.balance) {
      throw new BadRequestException(`To'lov qarzdan oshib ketdi (qolgan: ${account.balance} so'm)`);
    }
    return this.payments.save(
      this.payments.create({
        shopId,
        customerPhone: dto.customerPhone.trim(),
        amount: dto.amount,
        note: dto.note?.trim() || null,
        createdByUserId: userId,
      }),
    );
  }

  /** All customers with a debt history, grouped by phone, balance first. */
  async listAccounts(userId: string, shopId: string): Promise<DebtAccount[]> {
    await this.assertCanManage(userId, shopId);

    const debtRows = await this.debts
      .createQueryBuilder('d')
      .select('d.customerPhone', 'phone')
      .addSelect('SUM(d.total)', 'totalDebt')
      .addSelect('MAX(d.createdAt)', 'lastAt')
      .where('d.shopId = :shopId', { shopId })
      .groupBy('d.customerPhone')
      .getRawMany<{ phone: string; totalDebt: string; lastAt: string }>();

    const payRows = await this.payments
      .createQueryBuilder('p')
      .select('p.customerPhone', 'phone')
      .addSelect('SUM(p.amount)', 'totalPaid')
      .addSelect('MAX(p.createdAt)', 'lastAt')
      .where('p.shopId = :shopId', { shopId })
      .groupBy('p.customerPhone')
      .getRawMany<{ phone: string; totalPaid: string; lastAt: string }>();

    const paidMap = new Map(payRows.map((r) => [r.phone, r]));

    // Latest name per phone (most recent debt wins).
    const nameRows = await this.debts.find({
      where: { shopId },
      select: { customerPhone: true, customerName: true },
      order: { createdAt: 'DESC' },
    });
    const nameMap = new Map<string, string>();
    for (const r of nameRows) if (!nameMap.has(r.customerPhone)) nameMap.set(r.customerPhone, r.customerName);

    const accounts: DebtAccount[] = debtRows.map((d) => {
      const pay = paidMap.get(d.phone);
      const totalDebt = Number(d.totalDebt);
      const totalPaid = Number(pay?.totalPaid ?? 0);
      const lastAt = pay && pay.lastAt > d.lastAt ? pay.lastAt : d.lastAt;
      return {
        customerName: nameMap.get(d.phone) ?? '',
        customerPhone: d.phone,
        totalDebt,
        totalPaid,
        balance: totalDebt - totalPaid,
        lastActivityAt: lastAt,
      };
    });

    // Outstanding (balance > 0) first, then by most recent activity.
    accounts.sort((a, b) => {
      if ((b.balance > 0 ? 1 : 0) !== (a.balance > 0 ? 1 : 0)) {
        return (b.balance > 0 ? 1 : 0) - (a.balance > 0 ? 1 : 0);
      }
      return b.lastActivityAt.localeCompare(a.lastActivityAt);
    });
    return accounts;
  }

  /** Full history for one customer: debts + payments + running balance. */
  async getAccount(userId: string, shopId: string, phone: string) {
    await this.assertCanManage(userId, shopId);
    const [debts, payments] = await Promise.all([
      this.debts.find({ where: { shopId, customerPhone: phone }, order: { createdAt: 'DESC' } }),
      this.payments.find({ where: { shopId, customerPhone: phone }, order: { createdAt: 'DESC' } }),
    ]);
    const totalDebt = debts.reduce((s, d) => s + d.total, 0);
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    const name = debts[0]?.customerName ?? '';
    return {
      customerName: name,
      customerPhone: phone,
      totalDebt,
      totalPaid,
      balance: totalDebt - totalPaid,
      debts,
      payments,
    };
  }

  /** Shop-wide outstanding total — shown on the ledger header. */
  async summary(userId: string, shopId: string): Promise<{ outstanding: number; customers: number }> {
    const accounts = await this.listAccounts(userId, shopId);
    const outstanding = accounts.reduce((s, a) => s + Math.max(0, a.balance), 0);
    const customers = accounts.filter((a) => a.balance > 0).length;
    return { outstanding, customers };
  }
}
