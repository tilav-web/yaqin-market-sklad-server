import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ProductVariant } from '../products/entities/product-variant.entity';
import { StockBatch } from '../products/entities/stock-batch.entity';
import { PushService } from '../push/push.service';
import { Shop } from '../shops/entities/shop.entity';

/**
 * Daily digest: notify each shop owner about stock that is expiring within a
 * week (or already expired). Runs once a day; small shops don't need anything
 * more frequent.
 */
@Injectable()
export class ExpiryAlertService {
  private readonly logger = new Logger(ExpiryAlertService.name);

  constructor(
    @InjectRepository(StockBatch)
    private readonly batches: Repository<StockBatch>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    private readonly push: PushService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sendDailyExpiryDigest(): Promise<void> {
    const cutoff = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const rows = await this.batches
      .createQueryBuilder('b')
      .innerJoin(ProductVariant, 'v', 'v.id = b.productVariantId')
      .select('b.shopId', 'shopId')
      .addSelect('COUNT(*)', 'cnt')
      .where('b.quantityRemaining > 0')
      .andWhere('b.expiryDate IS NOT NULL')
      .andWhere('b.expiryDate <= :cutoff', { cutoff })
      .andWhere('v.isActive = true')
      .groupBy('b.shopId')
      .getRawMany<{ shopId: string; cnt: string }>();
    if (rows.length === 0) return;

    const shops = await this.shops.find({ where: { id: In(rows.map((r) => r.shopId)) } });
    const ownerMap = new Map(shops.map((s) => [s.id, s.ownerId]));

    for (const row of rows) {
      const ownerId = ownerMap.get(row.shopId);
      if (!ownerId) continue;
      await this.push.sendToUser(ownerId, {
        title: 'Muddati tugayotgan tovarlar',
        body: `${Number(row.cnt)} ta partiyaning muddati yaqinlashdi — Hisobot bo'limini tekshiring`,
        data: { kind: 'stock:expiring', shopId: row.shopId },
      });
    }
    this.logger.log(`Expiry digest sent to ${rows.length} shop(s)`);
  }
}
