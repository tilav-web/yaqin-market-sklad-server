import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { SettingsService } from '../../settings/settings.service';
import { SETTING_KEYS } from '../../settings/entities/global-setting.entity';
import { Shop } from '../../shops/entities/shop.entity';
import {
  ShopStaff,
  StaffPermission,
} from '../../shops/entities/shop-staff.entity';
import { assertShopPermission } from '../../shops/shop-access.util';
import { GlobalProduct } from '../entities/global-product.entity';
import {
  BrakReasonCode,
  InventoryMovement,
  MovementType,
} from '../entities/inventory-movement.entity';
import { ProductVariant } from '../entities/product-variant.entity';
import { StockBatch } from '../entities/stock-batch.entity';
import { consumeFifo, receiveBatch } from '../inventory.util';
import type {
  VariantCost,
  VariantWithCost,
  VariantWithGlobal,
} from '../products.service';

@Injectable()
export class ProductInventoryService {
  private static readonly BRAK_REASON_LABEL: Record<BrakReasonCode, string> = {
    [BrakReasonCode.Expired]: "Muddati o'tdi",
    [BrakReasonCode.Damaged]: 'Shikastlangan / singan',
    [BrakReasonCode.Stolen]: "Yo'qolgan / o'g'irlangan",
    [BrakReasonCode.Other]: 'Boshqa',
  };

  constructor(
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
    @InjectRepository(InventoryMovement)
    private readonly movements: Repository<InventoryMovement>,
    @InjectRepository(StockBatch)
    private readonly batches: Repository<StockBatch>,
    @InjectRepository(GlobalProduct)
    private readonly globalProducts: Repository<GlobalProduct>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(ShopStaff)
    private readonly staff: Repository<ShopStaff>,
    private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
  ) {}

  private ensureShopAccess(
    userId: string,
    shopId: string,
    permission: StaffPermission,
  ): Promise<Shop> {
    return assertShopPermission(
      this.shops,
      this.staff,
      userId,
      shopId,
      permission,
    );
  }

  private async getVariant(id: string): Promise<ProductVariant> {
    const v = await this.variants.findOne({ where: { id } });
    if (!v) throw new NotFoundException('Mahsulot topilmadi');
    return v;
  }

  private async attachGlobal(
    items: ProductVariant[],
  ): Promise<VariantWithGlobal[]> {
    if (!items.length) return [];
    const ids = [...new Set(items.map((v) => v.globalProductId))];
    const gps = await this.globalProducts.findBy({ id: In(ids) });
    const map = new Map(gps.map((g) => [g.id, g]));
    return items.map((v) => {
      const gp = map.get(v.globalProductId) ?? ({} as GlobalProduct);
      const nameStr =
        (typeof gp.name === 'object'
          ? gp.name?.uz || gp.name?.ru || gp.name?.kr
          : gp.name) || '';
      return {
        ...v,
        name: nameStr,
        nameI18n:
          typeof gp.name === 'object'
            ? gp.name
            : { uz: nameStr, kr: '', ru: '' },
        nameUzLatn: typeof gp.name === 'object' ? gp.name?.uz || '' : nameStr,
        nameUzCyrl: typeof gp.name === 'object' ? gp.name?.kr || '' : '',
        nameRu: typeof gp.name === 'object' ? gp.name?.ru || '' : '',
        brand: gp.brand ?? null,
        photos: gp.photos ?? [],
        unitType: gp.unitType ?? 'piece',
        unitSize: gp.unitSize ?? 1,
        barcode: gp.barcode ?? null,
        isVerified: gp.isVerified ?? false,
        categoryId: gp.categoryId ?? null,
        globalProduct: gp,
      };
    });
  }

  async adjustStock(
    userId: string,
    variantId: string,
    delta: number,
    reason?: string,
  ): Promise<VariantWithGlobal> {
    const variant = await this.getVariant(variantId);
    await this.ensureShopAccess(
      userId,
      variant.shopId,
      'inventory.product.edit_stock',
    );
    if (delta === 0) return (await this.attachGlobal([variant]))[0];

    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(ProductVariant, {
        where: { id: variantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Mahsulot topilmadi');
      if (locked.stock + delta < 0)
        throw new BadRequestException("Qoldiq manfiy bo'la olmaydi");

      if (delta > 0) {
        const lastCost = await this.lastCost(variantId);
        await receiveBatch(manager, {
          variant: locked,
          quantity: delta,
          costPrice: lastCost,
          userId,
          reason: reason ?? "Qo'lda tuzatish",
        });
      } else {
        const gp = await this.globalProducts.findOne({
          where: { id: locked.globalProductId },
          select: { name: true },
        });
        const nameStr = gp?.name
          ? typeof gp.name === 'object'
            ? gp.name.uz
            : gp.name
          : undefined;
        await consumeFifo(manager, {
          variant: locked,
          quantity: -delta,
          type: MovementType.Adjusted,
          userId,
          displayName: nameStr,
          reason: reason ?? "Qo'lda tuzatish",
        });
      }
      const updated = await manager.findOneOrFail(ProductVariant, {
        where: { id: variantId },
      });
      return (await this.attachGlobal([updated]))[0];
    });
  }

  async brakStock(
    userId: string,
    variantId: string,
    reasonCode: BrakReasonCode,
    note?: string,
  ): Promise<VariantWithGlobal> {
    const variant = await this.getVariant(variantId);
    await this.ensureShopAccess(
      userId,
      variant.shopId,
      'inventory.product.edit_stock',
    );

    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(ProductVariant, {
        where: { id: variantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Mahsulot topilmadi');
      if (locked.stock <= 0)
        throw new BadRequestException('Qoldiq allaqachon 0');

      const gp = await this.globalProducts.findOne({
        where: { id: locked.globalProductId },
        select: { name: true },
      });
      const nameStr = gp?.name
        ? typeof gp.name === 'object'
          ? gp.name.uz
          : gp.name
        : undefined;

      const movementType =
        reasonCode === BrakReasonCode.Expired
          ? MovementType.Expired
          : MovementType.Damaged;
      await consumeFifo(manager, {
        variant: locked,
        quantity: locked.stock,
        type: movementType,
        userId,
        displayName: nameStr,
        reason: `Brak: ${ProductInventoryService.BRAK_REASON_LABEL[reasonCode]}`,
        brakReasonCode: reasonCode,
        brakReasonNote: note ?? null,
      });
      const updated = await manager.findOneOrFail(ProductVariant, {
        where: { id: variantId },
      });
      return (await this.attachGlobal([updated]))[0];
    });
  }

  async receiveStock(
    userId: string,
    variantId: string,
    dto: {
      quantity: number;
      costPrice: number;
      expiryDate?: string;
      supplierName?: string;
      note?: string;
    },
  ): Promise<VariantWithGlobal> {
    const variant = await this.getVariant(variantId);
    await this.ensureShopAccess(
      userId,
      variant.shopId,
      'inventory.product.edit_stock',
    );
    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(ProductVariant, {
        where: { id: variantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Mahsulot topilmadi');
      await receiveBatch(manager, {
        variant: locked,
        quantity: dto.quantity,
        costPrice: dto.costPrice,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        supplierName: dto.supplierName ?? null,
        note: dto.note ?? null,
        userId,
        reason: dto.supplierName ? `Kirim — ${dto.supplierName}` : 'Kirim',
      });
      const updated = await manager.findOneOrFail(ProductVariant, {
        where: { id: variantId },
      });
      return (await this.attachGlobal([updated]))[0];
    });
  }

  async countStock(
    userId: string,
    variantId: string,
    actualQty: number,
  ): Promise<VariantWithGlobal> {
    const variant = await this.getVariant(variantId);
    await this.ensureShopAccess(userId, variant.shopId, 'inventory.count');
    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(ProductVariant, {
        where: { id: variantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Mahsulot topilmadi');
      const delta = actualQty - locked.stock;
      if (delta === 0) return (await this.attachGlobal([locked]))[0];
      if (delta > 0) {
        await receiveBatch(manager, {
          variant: locked,
          quantity: delta,
          costPrice: await this.lastCost(variantId),
          userId,
          reason: 'Inventarizatsiya (ortiqcha)',
        });
      } else {
        const gp = await this.globalProducts.findOne({
          where: { id: locked.globalProductId },
          select: { name: true },
        });
        const nameStr = gp?.name
          ? typeof gp.name === 'object'
            ? gp.name.uz
            : gp.name
          : undefined;
        await consumeFifo(manager, {
          variant: locked,
          quantity: -delta,
          type: MovementType.Adjusted,
          displayName: nameStr,
          userId,
          reason: 'Inventarizatsiya (kamomad)',
        });
      }
      const updated = await manager.findOneOrFail(ProductVariant, {
        where: { id: variantId },
      });
      return (await this.attachGlobal([updated]))[0];
    });
  }

  async lastCost(variantId: string): Promise<number> {
    const last = await this.batches.findOne({
      where: { productVariantId: variantId },
      order: { receivedAt: 'DESC' },
    });
    return last?.costPrice ?? 0;
  }

  async listBatches(userId: string, variantId: string): Promise<StockBatch[]> {
    const v = await this.getVariant(variantId);
    await this.ensureShopAccess(userId, v.shopId, 'inventory.view');
    return this.batches.find({
      where: { productVariantId: variantId },
      order: { receivedAt: 'DESC' },
      take: 100,
    });
  }

  async costSummaries(variantIds: string[]): Promise<Map<string, VariantCost>> {
    const out = new Map<string, VariantCost>();
    if (variantIds.length === 0) return out;
    const rows = await this.batches
      .createQueryBuilder('b')
      .select('b.productVariantId', 'vid')
      .addSelect('SUM(b.quantityRemaining)', 'qty')
      .addSelect('SUM(b.quantityRemaining * b.costPrice)', 'value')
      .where('b.productVariantId IN (:...ids)', { ids: variantIds })
      .andWhere('b.quantityRemaining > 0')
      .groupBy('b.productVariantId')
      .getRawMany<{ vid: string; qty: string; value: string }>();
    const valueMap = new Map(
      rows.map((r) => [r.vid, { qty: Number(r.qty), value: Number(r.value) }]),
    );

    const heads = await this.batches
      .createQueryBuilder('b')
      .where('b.productVariantId IN (:...ids)', { ids: variantIds })
      .andWhere('b.quantityRemaining > 0')
      .orderBy('b.productVariantId')
      .addOrderBy('b.receivedAt', 'ASC')
      .getMany();
    const nextCostMap = new Map<string, number>();
    for (const b of heads) {
      if (!nextCostMap.has(b.productVariantId))
        nextCostMap.set(b.productVariantId, b.costPrice);
    }

    for (const id of variantIds) {
      const agg = valueMap.get(id);
      const stockValue = agg?.value ?? 0;
      const qty = agg?.qty ?? 0;
      out.set(id, {
        avgCost: qty > 0 ? Math.round(stockValue / qty) : 0,
        nextCost: nextCostMap.get(id) ?? 0,
        stockValue,
      });
    }
    return out;
  }

  async listVariantsWithCost(
    userId: string,
    shopId: string,
    opts: {
      search?: string;
      limit?: number;
      offset?: number;
      lowOnly?: boolean;
    } = {},
  ): Promise<VariantWithCost[]> {
    await this.ensureShopAccess(userId, shopId, 'inventory.view');
    const qb = this.variants
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.globalProduct', 'gp')
      .where('v.shopId = :shopId', { shopId })
      .andWhere('v.isActive = true');

    const search = opts.search?.trim();
    if (search) {
      qb.andWhere(
        '(gp.name ILIKE :q OR gp.brand ILIKE :q OR gp.barcode = :raw)',
        { q: `%${search}%`, raw: search },
      );
    }
    if (opts.lowOnly) qb.andWhere('v.stock <= v.lowStockThreshold');

    qb.orderBy('v.createdAt', 'DESC');
    if (opts.limit !== undefined) {
      qb.skip(Math.max(opts.offset ?? 0, 0)).take(
        Math.min(Math.max(opts.limit, 1), 100),
      );
    }

    const variants = await qb.getMany();
    const globalMap = new Map(
      (
        variants as unknown as (ProductVariant & {
          globalProduct: GlobalProduct;
        })[]
      ).map((v) => [v.id, v.globalProduct]),
    );
    const costs = await this.costSummaries(variants.map((v) => v.id));
    return (variants as unknown as VariantWithGlobal[]).map((v) => ({
      ...v,
      name: globalMap.get(v.id)?.name ?? '',
      brand: globalMap.get(v.id)?.brand ?? null,
      photos: globalMap.get(v.id)?.photos ?? [],
      unitType: globalMap.get(v.id)?.unitType ?? 'piece',
      unitSize: globalMap.get(v.id)?.unitSize ?? 1,
      barcode: globalMap.get(v.id)?.barcode ?? null,
      isVerified: globalMap.get(v.id)?.isVerified ?? false,
      categoryId: globalMap.get(v.id)?.categoryId ?? null,
      cost: costs.get(v.id) ?? { avgCost: 0, nextCost: 0, stockValue: 0 },
    }));
  }

  listMovements(
    userId: string,
    variantId: string,
  ): Promise<InventoryMovement[]> {
    return this.getVariant(variantId).then(async (v) => {
      await this.ensureShopAccess(userId, v.shopId, 'inventory.movement.view');
      return this.movements.find({
        where: { productVariantId: variantId },
        order: { createdAt: 'DESC' },
        take: 100,
      });
    });
  }

  async listLowStock(
    userId: string,
    shopId: string,
  ): Promise<(VariantWithGlobal & { tier: 'critical' | 'warning' })[]> {
    await this.ensureShopAccess(userId, shopId, 'inventory.view');
    const defaultWarning = this.settings.getNumber(
      SETTING_KEYS.LOW_STOCK_WARNING_DEFAULT,
      10,
    );
    const defaultCritical = this.settings.getNumber(
      SETTING_KEYS.LOW_STOCK_CRITICAL_DEFAULT,
      3,
    );

    const vs = await this.variants
      .createQueryBuilder('v')
      .where('v.shopId = :shopId', { shopId })
      .andWhere('v.isActive = true')
      .andWhere('(v.stock <= v.lowStockThreshold) OR (v.stock <= :defWarn)', {
        defWarn: defaultWarning,
      })
      .orderBy('v.stock', 'ASC')
      .getMany();

    const withGlobal = await this.attachGlobal(vs);
    return withGlobal.map((v) => {
      const criticalLine = v.criticalThreshold ?? defaultCritical;
      const tier: 'critical' | 'warning' =
        v.stock <= criticalLine ? 'critical' : 'warning';
      return { ...v, tier };
    });
  }
}
