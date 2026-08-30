import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { GlobalProduct } from '../products/entities/global-product.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { StockBatch } from '../products/entities/stock-batch.entity';
import { PushService } from '../push/push.service';
import { SETTING_KEYS } from '../settings/entities/global-setting.entity';
import { SettingsService } from '../settings/settings.service';
import { Shop } from '../shops/entities/shop.entity';

@Injectable()
export class ExpiryAlertService {
  private readonly logger = new Logger(ExpiryAlertService.name);

  /** Once a shop is alerted for a batch, wait this long before repeating (avoids spam). */
  private static readonly CRITICAL_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

  constructor(
    @InjectRepository(StockBatch)
    private readonly batches: Repository<StockBatch>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
    @InjectRepository(GlobalProduct)
    private readonly globalProducts: Repository<GlobalProduct>,
    private readonly push: PushService,
    private readonly settings: SettingsService,
  ) {}

  private async loadNameMap(
    rows: ProductVariant[],
  ): Promise<Map<string, string>> {
    if (!rows.length) return new Map();
    const gpIds = [...new Set(rows.map((v) => v.globalProductId))];
    const gps = await this.globalProducts.findBy({ id: In(gpIds) });
    const gpMap = new Map(
      gps.map((gp) => [
        gp.id,
        typeof gp.name === 'object' ? gp.name?.uz || '' : (gp.name ?? ''),
      ]),
    );
    return new Map(rows.map((v) => [v.id, gpMap.get(v.globalProductId) ?? '']));
  }

  /** Kritik: muddati 2 kun ichida tugayotgan mahsulotlar — har soatda tekshiriladi. */
  @Cron(CronExpression.EVERY_HOUR)
  async sendCriticalExpiryAlerts(): Promise<void> {
    const criticalDays = this.settings.getNumber(
      SETTING_KEYS.EXPIRY_CRITICAL_DAYS,
      2,
    );
    const cutoff = new Date(Date.now() + criticalDays * 24 * 60 * 60 * 1000);
    const cooldownCutoff = new Date(
      Date.now() - ExpiryAlertService.CRITICAL_ALERT_COOLDOWN_MS,
    );

    const rows = await this.variants
      .createQueryBuilder('v')
      .where('v.isActive = true')
      .andWhere('v.expiryDate IS NOT NULL')
      .andWhere('v.expiryDate <= :cutoff', { cutoff })
      .andWhere('v.stock > 0')
      .andWhere(
        '(v.lastExpiryAlertAt IS NULL OR v.lastExpiryAlertAt <= :cooldownCutoff)',
        { cooldownCutoff },
      )
      .select([
        'v.shopId',
        'v.id',
        'v.globalProductId',
        'v.expiryDate',
        'v.stock',
      ])
      .getMany();

    if (!rows.length) return;

    const nameMap = await this.loadNameMap(rows);
    const shopIds = [...new Set(rows.map((r) => r.shopId))];
    const shops = await this.shops.find({ where: { id: In(shopIds) } });
    const ownerMap = new Map(shops.map((s) => [s.id, s.ownerId]));

    const grouped = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = grouped.get(r.shopId) ?? [];
      list.push(r);
      grouped.set(r.shopId, list);
    }

    const alertedVariantIds: string[] = [];
    for (const [shopId, items] of grouped) {
      const ownerId = ownerMap.get(shopId);
      if (!ownerId) continue;
      const names = items
        .slice(0, 3)
        .map((v) => nameMap.get(v.id) ?? '')
        .join(', ');
      await this.push.sendToUser(ownerId, {
        title: '🔴 Muddati tugayapti (kritik)',
        body: `${items.length} ta mahsulot ${criticalDays} kun ichida yaroqsiz: ${names}`,
        data: { kind: 'stock:expiry_critical', shopId },
      });
      alertedVariantIds.push(...items.map((v) => v.id));
    }
    if (alertedVariantIds.length > 0) {
      await this.variants.update(
        { id: In(alertedVariantIds) },
        { lastExpiryAlertAt: new Date() },
      );
    }
    this.logger.log(`Critical expiry alerts sent for ${grouped.size} shop(s)`);
  }

  /** Kunlik xulosa soat 20:00: ogohlantirish darajasidagi muddatlar. */
  @Cron('0 20 * * *')
  async sendDailyExpiryDigest(): Promise<void> {
    const warningDays = this.settings.getNumber(
      SETTING_KEYS.EXPIRY_WARNING_DAYS,
      7,
    );
    const cutoff = new Date(Date.now() + warningDays * 24 * 60 * 60 * 1000);

    const rows = await this.variants
      .createQueryBuilder('v')
      .where('v.isActive = true')
      .andWhere('v.expiryDate IS NOT NULL')
      .andWhere('v.expiryDate <= :cutoff', { cutoff })
      .andWhere('v.stock > 0')
      .select(['v.shopId', 'v.id', 'v.globalProductId', 'v.expiryDate'])
      .getMany();

    if (!rows.length) return;

    const shopIds = [...new Set(rows.map((r) => r.shopId))];
    const shops = await this.shops.find({ where: { id: In(shopIds) } });
    const ownerMap = new Map(shops.map((s) => [s.id, s.ownerId]));

    const grouped = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = grouped.get(r.shopId) ?? [];
      list.push(r);
      grouped.set(r.shopId, list);
    }

    for (const [shopId, items] of grouped) {
      const ownerId = ownerMap.get(shopId);
      if (!ownerId) continue;
      await this.push.sendToUser(ownerId, {
        title: 'Muddati tugayotgan tovarlar',
        body: `${items.length} ta mahsulotning muddati ${warningDays} kun ichida — Sklad → Muddatlar`,
        data: { kind: 'stock:expiring', shopId },
      });
    }
    this.logger.log(`Expiry digest sent to ${grouped.size} shop(s)`);
  }
}
