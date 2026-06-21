import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { GlobalProduct } from '../products/entities/global-product.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { PushService } from '../push/push.service';
import { SETTING_KEYS } from '../settings/entities/global-setting.entity';
import { SettingsService } from '../settings/settings.service';
import { Shop } from '../shops/entities/shop.entity';

@Injectable()
export class LowStockAlertService {
  private readonly logger = new Logger(LowStockAlertService.name);

  constructor(
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(GlobalProduct)
    private readonly globalProducts: Repository<GlobalProduct>,
    private readonly push: PushService,
    private readonly settings: SettingsService,
  ) {}

  private async loadNameMap(rows: ProductVariant[]): Promise<Map<string, string>> {
    if (!rows.length) return new Map();
    const gpIds = [...new Set(rows.map((v) => v.globalProductId))];
    const gps = await this.globalProducts.findBy({ id: In(gpIds) });
    const gpMap = new Map(gps.map((gp) => [gp.id, gp.name]));
    return new Map(rows.map((v) => [v.id, gpMap.get(v.globalProductId) ?? '']));
  }

  /** Darhol push: stock kritik darajadan past tushganda (har 10 daqiqada tekshiriladi). */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sendCriticalAlerts(): Promise<void> {
    const defaultCritical = this.settings.getNumber(SETTING_KEYS.LOW_STOCK_CRITICAL_DEFAULT, 3);

    const rows = await this.variants
      .createQueryBuilder('v')
      .where('v.isActive = true')
      .andWhere(
        '(v.criticalThreshold IS NOT NULL AND v.stock <= v.criticalThreshold) OR (v.criticalThreshold IS NULL AND v.stock <= :def)',
        { def: defaultCritical },
      )
      .andWhere('v.stock > 0')
      .select(['v.shopId', 'v.id', 'v.globalProductId', 'v.stock', 'v.criticalThreshold'])
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

    for (const [shopId, items] of grouped) {
      const ownerId = ownerMap.get(shopId);
      if (!ownerId) continue;
      const names = items.slice(0, 3).map((v) => `${nameMap.get(v.id) ?? ''} (${v.stock} ta)`).join(', ');
      const more = items.length > 3 ? ` va yana ${items.length - 3} ta` : '';
      await this.push.sendToUser(ownerId, {
        title: '⚠️ Kritik: tovar tugayapti',
        body: `${names}${more}`,
        data: { kind: 'stock:critical', shopId },
      });
    }
    this.logger.log(`Critical low-stock alerts sent for ${grouped.size} shop(s)`);
  }

  /** Kunlik xulasa: ogohlantirish darajasidagilar (soat 20:00). */
  @Cron('0 20 * * *')
  async sendDailyWarningDigest(): Promise<void> {
    const defaultWarning = this.settings.getNumber(SETTING_KEYS.LOW_STOCK_WARNING_DEFAULT, 10);

    const rows = await this.variants
      .createQueryBuilder('v')
      .where('v.isActive = true')
      .andWhere(
        '(v.stock <= v.lowStockThreshold) OR (v.stock <= :def)',
        { def: defaultWarning },
      )
      .andWhere('v.stock > 0')
      .select(['v.shopId', 'v.id', 'v.globalProductId', 'v.stock'])
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

    for (const [shopId, items] of grouped) {
      const ownerId = ownerMap.get(shopId);
      if (!ownerId) continue;
      const top = items.slice(0, 5).map((v) => `${nameMap.get(v.id) ?? ''}: ${v.stock} ta`).join(', ');
      const more = items.length > 5 ? ` va yana ${items.length - 5} ta` : '';
      await this.push.sendToUser(ownerId, {
        title: 'Kam qoldiqlar — kunlik hisobot',
        body: `${items.length} ta mahsulot kam: ${top}${more}`,
        data: { kind: 'stock:warning_digest', shopId },
      });
    }
    this.logger.log(`Daily low-stock digest sent for ${grouped.size} shop(s)`);
  }
}
