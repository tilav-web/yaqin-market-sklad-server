import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';

import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/entities/admin-audit-log.entity';
import { SellerBalance } from '../payments/entities/seller-balance.entity';
import { SellerTransaction, SellerTxType } from '../payments/entities/seller-transaction.entity';
import { PushService } from '../push/push.service';
import { User } from '../users/entities/user.entity';
import { toLocalizedText, LocalizedText } from '../common/types/localized-text.type';
import { PrimePlan } from './entities/prime-plan.entity';
import { SellerSubscription } from './entities/seller-subscription.entity';

@Injectable()
export class PrimeService {
  constructor(
    @InjectRepository(PrimePlan)          private readonly plans: Repository<PrimePlan>,
    @InjectRepository(SellerSubscription) private readonly subs: Repository<SellerSubscription>,
    @InjectRepository(SellerBalance)      private readonly balances: Repository<SellerBalance>,
    @InjectRepository(SellerTransaction)  private readonly txs: Repository<SellerTransaction>,
    @InjectRepository(User)               private readonly users: Repository<User>,
    private readonly push: PushService,
    private readonly auditLog: AuditLogService,
  ) {}

  /* ─── Plans (admin) ─── */

  listPlans(includeInactive = false): Promise<PrimePlan[]> {
    if (includeInactive) return this.plans.find({ order: { sortOrder: 'ASC' } });
    return this.plans.find({ where: { isActive: true }, order: { sortOrder: 'ASC' } });
  }

  getPlan(id: string): Promise<PrimePlan | null> {
    return this.plans.findOne({ where: { id } });
  }

  createPlan(dto: any): Promise<PrimePlan> {
    const name = toLocalizedText(dto.nameI18n || { uz: dto.nameUzLatn, kr: dto.nameUzCyrl, ru: dto.nameRu } || dto.name);
    const hasDesc = dto.descriptionI18n || dto.descriptionUzLatn || dto.description || dto.descriptionRu;
    const description = hasDesc
      ? toLocalizedText(dto.descriptionI18n || { uz: dto.descriptionUzLatn, kr: dto.descriptionUzCyrl, ru: dto.descriptionRu } || dto.description)
      : null;

    const plan = this.plans.create({
      monthlyPrice: dto.monthlyPrice,
      yearlyPrice: dto.yearlyPrice || null,
      commissionRate: dto.commissionRate,
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0,
      name,
      description,
    });
    return this.plans.save(plan);
  }

  async updatePlan(id: string, dto: any): Promise<PrimePlan> {
    const plan = await this.plans.findOne({ where: { id } });
    if (!plan) throw new NotFoundException();

    if (dto.nameUzLatn !== undefined || dto.name !== undefined || dto.nameRu !== undefined || dto.nameUzCyrl !== undefined || dto.nameI18n !== undefined) {
      plan.name = toLocalizedText(
        dto.nameI18n || {
          uz: dto.nameUzLatn ?? dto.name ?? (typeof plan.name === 'object' ? plan.name?.uz : plan.name),
          kr: dto.nameUzCyrl ?? (typeof plan.name === 'object' ? plan.name?.kr : undefined),
          ru: dto.nameRu ?? (typeof plan.name === 'object' ? plan.name?.ru : undefined),
        },
      );
    }

    if (
      dto.descriptionUzLatn !== undefined ||
      dto.description !== undefined ||
      dto.descriptionRu !== undefined ||
      dto.descriptionUzCyrl !== undefined ||
      dto.descriptionI18n !== undefined
    ) {
      const cur = typeof plan.description === 'object' ? plan.description : { uz: plan.description || '', kr: '', ru: '' };
      const uz = dto.descriptionUzLatn ?? dto.description ?? cur?.uz;
      if (uz || dto.descriptionRu || dto.descriptionUzCyrl || dto.descriptionI18n) {
        plan.description = toLocalizedText(
          dto.descriptionI18n || {
            uz,
            kr: dto.descriptionUzCyrl ?? cur?.kr,
            ru: dto.descriptionRu ?? cur?.ru,
          },
        );
      } else {
        plan.description = null;
      }
    }

    if (dto.monthlyPrice !== undefined) plan.monthlyPrice = dto.monthlyPrice;
    if (dto.yearlyPrice !== undefined) plan.yearlyPrice = dto.yearlyPrice;
    if (dto.commissionRate !== undefined) plan.commissionRate = dto.commissionRate;
    if (dto.isActive !== undefined) plan.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) plan.sortOrder = dto.sortOrder;

    return this.plans.save(plan);
  }

  async deletePlan(id: string): Promise<void> {
    // SellerSubscription.planId has no cascade/set-null, so the DB would
    // reject this with a raw foreign-key-violation 500 anyway (any
    // subscription ever tied to this plan, active or not, references it) —
    // check first so the admin gets a clear reason instead.
    const subCount = await this.subs.count({ where: { planId: id } });
    if (subCount > 0) {
      throw new BadRequestException(
        'Bu tarifga bog\'liq obunalar mavjud — o\'chirib bo\'lmaydi. Kerak bo\'lsa uni faolsizlantiring.',
      );
    }
    await this.plans.delete(id);
  }

  /* ─── Subscriptions ─── */

  /**
   * Get the seller's active subscription (if any). Checks `endDate` directly
   * rather than trusting only the `isActive` flag — that flag is refreshed
   * by a once-daily cron (`expireSubscriptions`, 1 AM), so relying on it
   * alone lets an already-expired plan's commission rate keep applying for
   * up to ~24h after it lapsed.
   */
  getActiveSub(sellerId: string): Promise<SellerSubscription | null> {
    const today = new Date().toISOString().split('T')[0];
    return this.subs.findOne({
      where: { sellerId, isActive: true, endDate: MoreThanOrEqual(today) },
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

  async listAllSubscriptions(): Promise<
    (SellerSubscription & { seller: { id: string; name: string | null; phone: string } | null })[]
  > {
    const subs = await this.subs.find({
      where: { isActive: true },
      relations: { plan: true },
      order: { createdAt: 'DESC' },
    });
    const sellerIds = [...new Set(subs.map((s) => s.sellerId))];
    const sellers = sellerIds.length
      ? await this.users.find({ where: { id: In(sellerIds) }, select: { id: true, name: true, phone: true } })
      : [];
    const byId = new Map(sellers.map((s) => [s.id, s]));
    return subs.map((s) => ({ ...s, seller: byId.get(s.sellerId) ?? null }));
  }

  async adminExtend(subId: string, days: number, adminUserId: string): Promise<SellerSubscription> {
    const sub = await this.subs.findOne({ where: { id: subId } });
    if (!sub) throw new NotFoundException();
    const end = new Date(sub.endDate);
    end.setDate(end.getDate() + days);
    sub.endDate = end.toISOString().split('T')[0];
    const saved = await this.subs.save(sub);
    void this.auditLog.record({
      adminUserId,
      action: AuditAction.PrimeSubscriptionExtended,
      targetType: 'seller_subscription',
      targetId: subId,
      metadata: { days, sellerId: sub.sellerId },
    });
    return saved;
  }

  /** Admin: overall Prime revenue statistics (SPEC.md §11.5 "Umumiy prime daromad statistikasi"). */
  async adminRevenueStats(): Promise<{
    totalRevenue: number;
    revenue30d: number;
    activeSubscriptions: number;
    byPlan: { planId: string; planName: string; activeCount: number; monthlyRecurringValue: number }[];
  }> {
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [totalRow, row30d] = await Promise.all([
      this.txs
        .createQueryBuilder('t')
        .select('COALESCE(SUM(-t.amount), 0)', 'total')
        .where('t.type = :type', { type: SellerTxType.PrimePayment })
        .andWhere("t.status = 'settled'")
        .getRawOne<{ total: string }>(),
      this.txs
        .createQueryBuilder('t')
        .select('COALESCE(SUM(-t.amount), 0)', 'total')
        .where('t.type = :type', { type: SellerTxType.PrimePayment })
        .andWhere("t.status = 'settled'")
        .andWhere('t.createdAt >= :since', { since: since30d })
        .getRawOne<{ total: string }>(),
    ]);

    const activeSubs = await this.subs.find({ where: { isActive: true }, relations: { plan: true } });
    const byPlanMap = new Map<string, { planId: string; planName: string; activeCount: number; monthlyRecurringValue: number }>();
    for (const s of activeSubs) {
      const planNameStr = typeof s.plan?.name === 'object' ? s.plan.name?.uz || '' : (s.plan?.name ?? '');
      const entry = byPlanMap.get(s.planId) ?? {
        planId: s.planId,
        planName: planNameStr,
        activeCount: 0,
        monthlyRecurringValue: 0,
      };
      entry.activeCount += 1;
      entry.monthlyRecurringValue += parseFloat(s.priceSnapshot);
      byPlanMap.set(s.planId, entry);
    }

    return {
      totalRevenue: Number(totalRow?.total ?? 0),
      revenue30d: Number(row30d?.total ?? 0),
      activeSubscriptions: activeSubs.length,
      byPlan: [...byPlanMap.values()],
    };
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

  /** Send a reminder push 3 days before subscription expires. Runs daily at 9 AM. */
  @Cron('0 9 * * *')
  async sendExpiryReminders() {
    const now = new Date();
    const in3d = new Date(now);
    in3d.setDate(in3d.getDate() + 3);
    const from = in3d.toISOString().split('T')[0];
    const to = in3d.toISOString().split('T')[0];

    const expiring = await this.subs.find({
      where: { isActive: true, endDate: Between(from, to) as any },
    });
    if (!expiring.length) return;

    for (const sub of expiring) {
      void this.push.sendToUser(sub.sellerId, {
        title: 'Prime obunangiz tugayapti',
        body: `Sizning Prime obunangiz 3 kun ichida tugaydi. Yangilashni unutmang!`,
        data: { kind: 'prime_expiry_reminder', subscriptionId: sub.id },
      });
    }
  }
}
