import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import { SellerBalance } from '../payments/entities/seller-balance.entity';
import { SellerTransaction, SellerTxType } from '../payments/entities/seller-transaction.entity';
import { PrimePlan } from './entities/prime-plan.entity';
import { SellerSubscription } from './entities/seller-subscription.entity';

@Injectable()
export class PrimeService {
  constructor(
    @InjectRepository(PrimePlan)          private readonly plans: Repository<PrimePlan>,
    @InjectRepository(SellerSubscription) private readonly subs: Repository<SellerSubscription>,
    @InjectRepository(SellerBalance)      private readonly balances: Repository<SellerBalance>,
    @InjectRepository(SellerTransaction)  private readonly txs: Repository<SellerTransaction>,
  ) {}

  /* ─── Plans (admin) ─── */

  listPlans(includeInactive = false): Promise<PrimePlan[]> {
    if (includeInactive) return this.plans.find({ order: { sortOrder: 'ASC' } });
    return this.plans.find({ where: { isActive: true }, order: { sortOrder: 'ASC' } });
  }

  getPlan(id: string): Promise<PrimePlan | null> {
    return this.plans.findOne({ where: { id } });
  }

  createPlan(dto: Partial<PrimePlan>): Promise<PrimePlan> {
    return this.plans.save(this.plans.create(dto));
  }

  async updatePlan(id: string, dto: Partial<PrimePlan>): Promise<PrimePlan> {
    await this.plans.update(id, dto);
    const plan = await this.plans.findOne({ where: { id } });
    if (!plan) throw new NotFoundException();
    return plan;
  }

  async deletePlan(id: string): Promise<void> {
    await this.plans.delete(id);
  }

  /* ─── Subscriptions ─── */

  /** Get the seller's active subscription (if any) */
  getActiveSub(sellerId: string): Promise<SellerSubscription | null> {
    const today = new Date().toISOString().split('T')[0];
    return this.subs.findOne({
      where: { sellerId, isActive: true },
      relations: { plan: true },
    });
  }

  /** Get the commission rate for a seller (active sub or default) */
  async getCommissionRate(sellerId: string, defaultRate: number): Promise<number> {
    const sub = await this.getActiveSub(sellerId);
    if (!sub) return defaultRate;
    return parseFloat(sub.commissionRateSnapshot);
  }

  /** Subscribe seller to a plan (pay from balance) */
  async subscribe(sellerId: string, planId: string, yearly = false): Promise<SellerSubscription> {
    const plan = await this.plans.findOne({ where: { id: planId, isActive: true } });
    if (!plan) throw new NotFoundException('Tarif topilmadi');

    const price = yearly && plan.yearlyPrice
      ? parseFloat(plan.yearlyPrice)
      : parseFloat(plan.monthlyPrice);

    const bal = await this.balances.findOne({ where: { sellerId } });
    const available = parseFloat(bal?.availableBalance ?? '0');
    if (available < price) {
      throw new BadRequestException(`Yetarli mablag' yo'q. Kerak: ${price.toLocaleString()} so'm`);
    }

    // Cancel existing sub
    await this.subs.update({ sellerId, isActive: true }, { isActive: false, cancelledAt: new Date() });

    const today = new Date();
    const end = new Date(today);
    if (yearly) {
      end.setFullYear(end.getFullYear() + 1);
    } else {
      end.setMonth(end.getMonth() + 1);
    }

    const sub = await this.subs.save(this.subs.create({
      sellerId,
      planId,
      commissionRateSnapshot: plan.commissionRate,
      priceSnapshot: String(price),
      startDate: today.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
      isActive: true,
    }));

    // Deduct from balance
    if (bal) {
      bal.availableBalance = String(available - price);
      await this.balances.save(bal);
    }

    await this.txs.save(this.txs.create({
      sellerId,
      type: SellerTxType.PrimePayment,
      amount: String(-price),
      status: 'settled',
      description: `Prime obuna: ${plan.name} (${yearly ? 'yillik' : 'oylik'})`,
    }));

    return sub;
  }

  listMySubscriptions(sellerId: string): Promise<SellerSubscription[]> {
    return this.subs.find({
      where: { sellerId },
      relations: { plan: true },
      order: { createdAt: 'DESC' },
    });
  }

  /* ─── Admin ─── */

  listAllSubscriptions(): Promise<SellerSubscription[]> {
    return this.subs.find({ where: { isActive: true }, relations: { plan: true }, order: { createdAt: 'DESC' } });
  }

  async adminExtend(subId: string, days: number): Promise<SellerSubscription> {
    const sub = await this.subs.findOne({ where: { id: subId } });
    if (!sub) throw new NotFoundException();
    const end = new Date(sub.endDate);
    end.setDate(end.getDate() + days);
    sub.endDate = end.toISOString().split('T')[0];
    return this.subs.save(sub);
  }

  /* ─── Cron: expire subscriptions ─── */

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async expireSubscriptions() {
    const today = new Date().toISOString().split('T')[0];
    await this.subs.update(
      { isActive: true, endDate: LessThan(today) as any },
      { isActive: false },
    );
  }
}
