import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PushService } from '../push/push.service';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { assertShopPermission } from '../shops/shop-access.util';
import { User } from '../users/entities/user.entity';
import { Promotion } from './entities/promotion.entity';
import { toLocalizedText } from '../common/types/localized-text.type';

@Injectable()
export class PromotionsService {
  constructor(
    @InjectRepository(Promotion)
    private readonly repo: Repository<Promotion>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(ShopStaff)
    private readonly staff: Repository<ShopStaff>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly push: PushService,
  ) {}

  private ensureAccess(userId: string, shopId: string) {
    return assertShopPermission(this.shops, this.staff, userId, shopId, 'promotions.view');
  }

  private ensureManage(userId: string, shopId: string) {
    return assertShopPermission(this.shops, this.staff, userId, shopId, 'promotions.manage');
  }

  async list(userId: string, shopId: string, status?: 'active' | 'scheduled' | 'ended') {
    await this.ensureAccess(userId, shopId);
    const now = new Date();
    const qb = this.repo
      .createQueryBuilder('p')
      .where('p.shopId = :shopId', { shopId })
      .orderBy('p.createdAt', 'DESC');

    if (status === 'active') {
      qb.andWhere('p.isActive = true AND p.startAt <= :now AND (p.endAt IS NULL OR p.endAt >= :now)', { now });
    } else if (status === 'scheduled') {
      qb.andWhere('p.isActive = true AND p.startAt > :now', { now });
    } else if (status === 'ended') {
      qb.andWhere('p.isActive = false OR (p.endAt IS NOT NULL AND p.endAt < :now)', { now });
    }
    return qb.getMany();
  }

  async create(
    userId: string,
    shopId: string,
    dto: {
      name: string;
      type: Promotion['type'];
      discountType?: Promotion['discountType'];
      discountValue?: number;
      targetProductId?: string;
      targetCategoryId?: string;
      freeDeliveryMinAmount?: number;
      startAt: string;
      endAt?: string;
    },
  ): Promise<Promotion> {
    await this.ensureManage(userId, shopId);
    this.validate(dto);
    const promo = this.repo.create({
      shopId,
      name: toLocalizedText(dto.name),
      type: dto.type,
      discountType: dto.discountType ?? null,
      discountValue: dto.discountValue ?? null,
      targetProductId: dto.targetProductId ?? null,
      targetCategoryId: dto.targetCategoryId ?? null,
      freeDeliveryMinAmount: dto.freeDeliveryMinAmount ?? null,
      startAt: new Date(dto.startAt),
      endAt: dto.endAt ? new Date(dto.endAt) : null,
      isActive: true,
      createdByUserId: userId,
    });
    const saved = await this.repo.save(promo);

    // Sevimli do'kon foydalanuvchilariga notification yuboramiz
    void this.notifyFavoriteUsers(shopId, typeof saved.name === 'object' ? saved.name?.uz || '' : saved.name);
    return saved;
  }

  async stop(userId: string, id: string): Promise<Promotion> {
    const promo = await this.repo.findOne({ where: { id } });
    if (!promo) throw new NotFoundException('Aksiya topilmadi');
    await this.ensureManage(userId, promo.shopId);
    promo.isActive = false;
    return this.repo.save(promo);
  }

  async stats(userId: string, id: string) {
    const promo = await this.repo.findOne({ where: { id } });
    if (!promo) throw new NotFoundException('Aksiya topilmadi');
    await this.ensureAccess(userId, promo.shopId);
    return promo;
  }

  /**
   * Savat uchun: shopId + mahsulot/kategoriya bo'yicha eng foydali (eng katta
   * chegirma summasidagi) aktiv aksiyani topadi. `unitPrice` — chegirma
   * qo'llanadigan asl narx (masalan variant.discountPrice ?? variant.price).
   * Returns the discount amount in so'm for ONE unit (caller multiplies by
   * quantity), clamped so it never exceeds unitPrice.
   */
  /**
   * Active product/category discount promos for a shop. Fetch ONCE per
   * order (not per cart line) and pass the result to {@link bestDiscountFor}
   * — the query itself doesn't depend on which product/item is being priced.
   */
  async findActivePromosForShop(shopId: string): Promise<Promotion[]> {
    const now = new Date();
    return this.repo
      .createQueryBuilder('p')
      .where('p.shopId = :shopId', { shopId })
      .andWhere('p.isActive = true')
      .andWhere("p.type IN ('product_discount', 'category_discount')")
      .andWhere('p.startAt <= :now', { now })
      .andWhere('(p.endAt IS NULL OR p.endAt >= :now)', { now })
      .getMany();
  }

  /** Pick the best-discount promo (largest actual so'm off) applicable to one line item. */
  bestDiscountFor(
    promos: Promotion[],
    productVariantId: string,
    categoryId: string | null,
    unitPrice: number,
  ): { discountAmount: number; promotionId: string | null } {
    let bestDiscount = 0;
    let bestId: string | null = null;

    for (const p of promos) {
      if (p.type === 'product_discount' && p.targetProductId !== productVariantId) continue;
      if (p.type === 'category_discount' && (!categoryId || p.targetCategoryId !== categoryId)) continue;
      if (!p.discountType || !p.discountValue) continue;

      const rawDiscount = p.discountType === 'percent'
        ? Math.round((unitPrice * p.discountValue) / 100)
        : p.discountValue;
      const discount = Math.max(0, Math.min(rawDiscount, unitPrice));

      // "Best discount wins" — keep the largest actual so'm discount, not
      // just the last matching row in iteration order.
      if (discount > bestDiscount) {
        bestDiscount = discount;
        bestId = p.id;
      }
    }
    return { discountAmount: bestDiscount, promotionId: bestId };
  }

  /** Savat jami summasiga qarab bepul yetkazib berish aksiyasini tekshiradi. */
  async findFreeDeliveryPromotion(
    shopId: string,
    orderSubtotal: number,
  ): Promise<{ free: boolean; promotionId: string | null }> {
    const now = new Date();
    const promos = await this.repo
      .createQueryBuilder('p')
      .where('p.shopId = :shopId', { shopId })
      .andWhere('p.isActive = true')
      .andWhere("p.type = 'free_delivery'")
      .andWhere('p.startAt <= :now', { now })
      .andWhere('(p.endAt IS NULL OR p.endAt >= :now)', { now })
      .getMany();

    for (const p of promos) {
      if (p.freeDeliveryMinAmount && orderSubtotal >= p.freeDeliveryMinAmount) {
        return { free: true, promotionId: p.id };
      }
    }
    return { free: false, promotionId: null };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async expirePromotions(): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(Promotion)
      .set({ isActive: false })
      .where('isActive = true AND endAt IS NOT NULL AND endAt < :now', { now: new Date() })
      .execute();
  }

  private validate(dto: Partial<{
    type: string;
    discountType: string | null;
    discountValue: number | null;
    freeDeliveryMinAmount: number | null;
  }>) {
    if (dto.type !== 'free_delivery') {
      if (!dto.discountType) throw new BadRequestException('discountType majburiy');
      if (!dto.discountValue || dto.discountValue <= 0) throw new BadRequestException('discountValue > 0 bo\'lishi kerak');
    } else {
      if (!dto.freeDeliveryMinAmount || dto.freeDeliveryMinAmount <= 0) {
        throw new BadRequestException('freeDeliveryMinAmount majburiy');
      }
    }
  }

  private async notifyFavoriteUsers(shopId: string, promoName: string): Promise<void> {
    const shop = await this.shops.findOne({ where: { id: shopId }, select: { name: true } });
    const favUsers = await this.users
      .createQueryBuilder('u')
      .where(':shopId = ANY(u.favoriteShopIds)', { shopId })
      .select(['u.id'])
      .getMany();
    if (!favUsers.length) return;
    void this.push.sendToUsers(favUsers.map((u) => u.id), {
      title: `${shop?.name ?? 'Do\'koningiz'} — yangi aksiya!`,
      body: promoName,
      data: { kind: 'shop_promo', shopId },
    });
  }
}
