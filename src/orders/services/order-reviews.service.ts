import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, In, IsNull, Repository } from 'typeorm';

import { PushService } from '../../push/push.service';
import { RiskService } from '../../risk/risk.service';
import { ProductVariant } from '../../products/entities/product-variant.entity';
import { Shop } from '../../shops/entities/shop.entity';
import { Order, OrderStatus } from '../entities/order.entity';
import { Review, ReviewTarget } from '../entities/review.entity';

@Injectable()
export class OrderReviewsService {
  private readonly logger = new Logger(OrderReviewsService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(Review)
    private readonly reviews: Repository<Review>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
    private readonly dataSource: DataSource,
    private readonly push: PushService,
    private readonly risk: RiskService,
  ) {}

  /**
   * Customer rates products in a delivered order.
   * Derived automatically from the average of all its product reviews.
   * Re-submitting for an already-reviewed variant overwrites the prior review.
   */
  async createReviews(
    userId: string,
    orderId: string,
    items: { productVariantId: string; stars: number; text?: string }[],
  ): Promise<{ reviewedVariantIds: string[] }> {
    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: { items: true, shop: true },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.userId !== userId) throw new ForbiddenException();
    if (order.status !== OrderStatus.Delivered) {
      throw new BadRequestException(
        'Faqat yetkazilgan buyurtmani baholash mumkin',
      );
    }

    const orderedVariantIds = new Set(
      order.items.map((i) => i.productVariantId),
    );
    for (const r of items) {
      if (!orderedVariantIds.has(r.productVariantId)) {
        throw new BadRequestException("Mahsulot ushbu buyurtmada yo'q");
      }
    }

    await this.dataSource.transaction(async (manager) => {
      for (const r of items) {
        const existing = await manager.findOne(Review, {
          where: {
            userId,
            orderId,
            target: ReviewTarget.Product,
            productVariantId: r.productVariantId,
          },
        });
        if (existing) {
          existing.stars = r.stars;
          existing.text = r.text ?? null;
          await manager.save(existing);
        } else {
          await manager.save(
            manager.create(Review, {
              userId,
              orderId,
              target: ReviewTarget.Product,
              productVariantId: r.productVariantId,
              stars: r.stars,
              text: r.text ?? null,
            }),
          );
        }
      }
    });

    // Roll up ratings for every affected variant + the shop.
    const affectedVariantIds = [
      ...new Set(items.map((i) => i.productVariantId)),
    ];
    for (const variantId of affectedVariantIds) {
      await this.recomputeVariantRating(variantId);
    }
    await this.recomputeShopRating(order.shopId);

    const myReviews = await this.reviews.find({
      where: { orderId, userId, target: ReviewTarget.Product },
      select: { productVariantId: true },
    });
    return {
      reviewedVariantIds: myReviews.map((rv) => rv.productVariantId as string),
    };
  }

  /**
   * Customer rates the courier who confirmed delivery (target='courier') —
   * separate from product reviews. Courier is resolved from
   * Order.deliveredByUserId (set when the shop side taps "Yetkazildi"); if
   * the customer self-confirmed, there's no courier to attribute this to.
   */
  async rateCourier(
    userId: string,
    orderId: string,
    stars: number,
    text?: string,
  ): Promise<void> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.userId !== userId) throw new ForbiddenException();
    if (order.status !== OrderStatus.Delivered) {
      throw new BadRequestException(
        'Faqat yetkazilgan buyurtmani baholash mumkin',
      );
    }
    if (!order.deliveredByUserId) {
      throw new BadRequestException(
        'Bu buyurtmada baholash uchun kuryer aniqlanmagan',
      );
    }
    const courierUserId = order.deliveredByUserId;

    await this.upsertPartyReview(
      userId,
      orderId,
      ReviewTarget.Courier,
      stars,
      text,
      { courierUserId },
    );
    await this.recomputeCourierRating(courierUserId);
    void this.risk.onCourierRated({ orderId, courierUserId, stars });
  }

  /** Customer rates the shop/delivery experience (target='shop') — separate from per-product reviews. */
  async rateShop(
    userId: string,
    orderId: string,
    stars: number,
    text?: string,
  ): Promise<void> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.userId !== userId) throw new ForbiddenException();
    if (order.status !== OrderStatus.Delivered) {
      throw new BadRequestException(
        'Faqat yetkazilgan buyurtmani baholash mumkin',
      );
    }

    await this.upsertPartyReview(
      userId,
      orderId,
      ReviewTarget.Shop,
      stars,
      text,
      { shopId: order.shopId },
    );
    await this.recomputeShopServiceRating(order.shopId);
  }

  @Cron('0 */4 * * *')
  async sendReviewReminders(): Promise<void> {
    const now = Date.now();
    const from = new Date(now - 24 * 60 * 60 * 1000);
    const to = new Date(now - 2 * 60 * 60 * 1000);

    const delivered = await this.orders.find({
      where: {
        status: OrderStatus.Delivered,
        updatedAt: Between(from, to),
        reviewReminderSentAt: IsNull(),
      },
      relations: { items: true },
      take: 200,
    });
    if (delivered.length === 0) return;

    // For each order check if all items have been reviewed.
    const orderIds = delivered.map((o) => o.id);
    const existingReviews = await this.reviews.find({
      where: { orderId: In(orderIds), target: ReviewTarget.Product },
    });
    const reviewedPairs = new Set(
      existingReviews.map((r) => `${r.orderId}:${r.productVariantId}`),
    );

    const reminded = new Set<string>();
    const remindedOrderIds: string[] = [];
    for (const order of delivered) {
      if (!order.userId) continue;
      const hasUnreviewed = order.items.some(
        (it) => !reviewedPairs.has(`${order.id}:${it.productVariantId}`),
      );
      if (!hasUnreviewed) continue;
      if (reminded.has(order.userId)) continue;
      reminded.add(order.userId);
      remindedOrderIds.push(order.id);

      void this.push.sendToUser(order.userId, {
        title: 'Buyurtmangizni baholang',
        body: `#${order.orderNumber} buyurtmangiz haqida fikr qoldiring — bu do'konni rivojlantiradi!`,
        data: {
          kind: 'review_reminder',
          orderId: order.id,
          deepLink: `/orders/${order.id}`,
        },
      });
    }
    if (remindedOrderIds.length > 0) {
      await this.orders.update(
        { id: In(remindedOrderIds) },
        { reviewReminderSentAt: new Date() },
      );
      this.logger.log(`Sent review reminders to ${reminded.size} user(s)`);
    }
  }

  async adminListReviews(opts: {
    target?: ReviewTarget;
    maxStars?: number;
    limit?: number;
    offset?: number;
  }): Promise<{
    items: (Review & {
      customerName: string | null;
      targetName: string | null;
    })[];
    total: number;
  }> {
    const qb = this.reviews
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.user', 'user')
      .leftJoinAndSelect('r.courier', 'courier')
      .leftJoinAndSelect('r.shop', 'shop')
      .orderBy('r.createdAt', 'DESC')
      .take(Math.min(opts.limit ?? 30, 100))
      .skip(Math.max(opts.offset ?? 0, 0));
    if (opts.target) qb.andWhere('r.target = :target', { target: opts.target });
    if (opts.maxStars != null)
      qb.andWhere('r.stars <= :maxStars', { maxStars: opts.maxStars });
    const [items, total] = await qb.getManyAndCount();

    const variantIds = [
      ...new Set(
        items
          .filter(
            (r) => r.target === ReviewTarget.Product && r.productVariantId,
          )
          .map((r) => r.productVariantId as string),
      ),
    ];
    const variants = variantIds.length
      ? await this.variants
          .createQueryBuilder('v')
          .innerJoinAndSelect('v.globalProduct', 'gp')
          .where('v.id IN (:...ids)', { ids: variantIds })
          .select(['v.id', 'gp.name'])
          .getMany()
      : [];
    const variantNameMap = new Map(
      variants.map((v) => [
        v.id,
        v.globalProduct?.name
          ? typeof v.globalProduct.name === 'object'
            ? v.globalProduct.name?.uz || ''
            : v.globalProduct.name
          : null,
      ]),
    );

    return {
      items: items.map((r) => ({
        ...r,
        customerName: r.user?.name || r.user?.phone || null,
        targetName:
          r.target === ReviewTarget.Product
            ? r.productVariantId
              ? (variantNameMap.get(r.productVariantId) ?? null)
              : null
            : r.target === ReviewTarget.Courier
              ? r.courier?.name || r.courier?.phone || null
              : (r.shop?.name ?? null),
      })),
      total,
    };
  }

  private async upsertPartyReview(
    userId: string,
    orderId: string,
    target: ReviewTarget.Courier | ReviewTarget.Shop,
    stars: number,
    text: string | undefined,
    extra: { courierUserId?: string; shopId?: string },
  ): Promise<void> {
    const existing = await this.reviews.findOne({
      where: { userId, orderId, target },
    });
    if (existing) {
      existing.stars = stars;
      existing.text = text ?? null;
      await this.reviews.save(existing);
    } else {
      await this.reviews.save(
        this.reviews.create({
          userId,
          orderId,
          target,
          stars,
          text: text ?? null,
          ...extra,
        }),
      );
    }
  }

  private async recomputeCourierRating(_courierUserId: string): Promise<void> {
    // Dynamic review queries calculate this on demand without mutating User table
  }

  private async recomputeShopServiceRating(shopId: string): Promise<void> {
    const agg = await this.reviews
      .createQueryBuilder('r')
      .select('COALESCE(AVG(r.stars), 0)', 'avg')
      .addSelect('COUNT(*)', 'cnt')
      .where('r.target = :target', { target: ReviewTarget.Shop })
      .andWhere('r.shopId = :shopId', { shopId })
      .getRawOne<{ avg: string; cnt: string }>();
    await this.shops.update(shopId, {
      serviceRatingAverage: Math.round(Number(agg?.avg ?? 0) * 100) / 100,
      serviceRatingCount: Number(agg?.cnt ?? 0),
    });
  }

  private async recomputeVariantRating(variantId: string): Promise<void> {
    const agg = await this.reviews
      .createQueryBuilder('r')
      .select('COALESCE(AVG(r.stars), 0)', 'avg')
      .addSelect('COUNT(*)', 'cnt')
      .where('r.productVariantId = :variantId', { variantId })
      .getRawOne<{ avg: string; cnt: string }>();
    await this.variants.update(variantId, {
      ratingAverage: Math.round(Number(agg?.avg ?? 0) * 100) / 100,
      ratingCount: Number(agg?.cnt ?? 0),
    });
  }

  private async recomputeShopRating(shopId: string): Promise<void> {
    const agg = await this.reviews
      .createQueryBuilder('r')
      .innerJoin('product_variants', 'v', 'v.id = r.productVariantId')
      .select('COALESCE(AVG(r.stars), 0)', 'avg')
      .addSelect('COUNT(*)', 'cnt')
      .where('v.shopId = :shopId', { shopId })
      .getRawOne<{ avg: string; cnt: string }>();
    await this.shops.update(shopId, {
      ratingAverage: Math.round(Number(agg?.avg ?? 0) * 100) / 100,
      ratingCount: Number(agg?.cnt ?? 0),
    });
  }
}
