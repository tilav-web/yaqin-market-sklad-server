import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, EntityManager, In, Repository } from 'typeorm';

import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../settings/entities/global-setting.entity';
import { buildXlsxBuffer } from '../common/xlsx.util';

import { boundingBox, calcDeliveryFee, haversineKm, pointInPolygon } from '../geo/geo.util';
import { Review } from '../orders/entities/review.entity';
import { PushService } from '../push/push.service';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff, StaffPermission } from '../shops/entities/shop-staff.entity';
import { assertShopPermission } from '../shops/shop-access.util';
import { isShopOpenNow } from '../shops/shop-hours.util';
import { User } from '../users/entities/user.entity';
import { latinToCyrillic } from '../common/utils/transliteration.util';
import { GlobalProduct, UnitType } from './entities/global-product.entity';
import { BrakReasonCode, InventoryMovement, MovementType } from './entities/inventory-movement.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { StockBatch } from './entities/stock-batch.entity';
import { consumeFifo, receiveBatch } from './inventory.util';

/** Per-variant FIFO cost summary attached to seller inventory rows. */
export interface VariantCost {
  avgCost: number;
  nextCost: number;
  stockValue: number;
}

/** Display fields from GlobalProduct, flattened onto a variant for API responses. */
export interface VariantDisplay {
  name: string;
  brand: string | null;
  photos: string[];
  unitType: UnitType;
  unitSize: number;
  barcode: string | null;
  isVerified: boolean;
  categoryId: string | null;
  globalProduct: GlobalProduct;
}

export type VariantWithGlobal = ProductVariant & VariantDisplay;
export type VariantWithCost = VariantWithGlobal & { cost: VariantCost };

export type FeedProduct = VariantWithGlobal & {
  shop: {
    id: string;
    name: string;
    distanceKm: number;
    deliveryFeeAtUser: number;
    isOpen: boolean;
    photos: string[];
  };
};

@Injectable()
export class ProductsService {
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
    @InjectRepository(Review)
    private readonly reviews: Repository<Review>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly push: PushService,
    private readonly settings: SettingsService,
  ) {}

  // ─── Access helpers ────────────────────────────────────────────────────────

  private ensureShopAccess(
    userId: string,
    shopId: string,
    permission: StaffPermission,
  ): Promise<Shop> {
    return assertShopPermission(this.shops, this.staff, userId, shopId, permission);
  }

  private async ensureShopOwner(userId: string, shopId: string): Promise<Shop> {
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Do\'kon topilmadi');
    if (shop.ownerId !== userId) {
      throw new ForbiddenException('Bu amalni faqat do\'kon egasi bajara oladi');
    }
    return shop;
  }

  // ─── Display-field decorator ───────────────────────────────────────────────

  /**
   * Loads GlobalProducts for all variants in a single IN query and flattens
   * display fields (name/brand/photos/unitType/unitSize/barcode/isVerified)
   * onto each variant. Prevents N+1 queries in list endpoints.
   */
  private async attachGlobal(items: ProductVariant[]): Promise<VariantWithGlobal[]> {
    if (!items.length) return [];
    const ids = [...new Set(items.map((v) => v.globalProductId))];
    const gps = await this.globalProducts.findBy({ id: In(ids) });
    const map = new Map(gps.map((g) => [g.id, g]));
    return items.map((v) => {
      const gp = map.get(v.globalProductId) ?? ({} as GlobalProduct);
      return {
        ...v,
        name: gp.name ?? '',
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

  // ─── Variants (seller inventory) ──────────────────────────────────────────

  async listVariants(shopId: string): Promise<VariantWithGlobal[]> {
    const vs = await this.variants.find({
      where: { shopId },
      order: { createdAt: 'DESC' },
    });
    return this.attachGlobal(vs);
  }

  async getVariant(id: string): Promise<ProductVariant> {
    const v = await this.variants.findOne({ where: { id } });
    if (!v) throw new NotFoundException('Mahsulot topilmadi');
    return v;
  }

  async getVariantWithGlobal(id: string): Promise<VariantWithGlobal> {
    const v = await this.getVariant(id);
    return (await this.attachGlobal([v]))[0];
  }

  /**
   * Add a shared-catalogue product to a shop. The GlobalProduct already holds
   * all display data; the seller only supplies commercial + inventory fields.
   */
  async createFromGlobal(
    userId: string,
    shopId: string,
    dto: {
      globalProductId: string;
      price: number;
      stock: number;
      costPrice?: number;
      discountPrice?: number;
      expiryDate?: string;
      lowStockThreshold?: number;
      criticalThreshold?: number;
    },
  ): Promise<VariantWithGlobal> {
    await this.ensureShopAccess(userId, shopId, 'inventory.product.create');

    const global = await this.globalProducts.findOne({
      where: { id: dto.globalProductId, isActive: true },
    });
    if (!global) throw new NotFoundException('Global mahsulot topilmadi');

    return this.dataSource.transaction(async (manager) => {
      let saved: ProductVariant;
      try {
        const variant = manager.create(ProductVariant, {
          shopId,
          globalProductId: global.id,
          price: dto.price,
          discountPrice: dto.discountPrice ?? null,
          stock: 0,
          lowStockThreshold:
            dto.lowStockThreshold ??
            this.settings.getNumber(SETTING_KEYS.LOW_STOCK_WARNING_DEFAULT, 5),
          criticalThreshold: dto.criticalThreshold ?? null,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        });
        saved = await manager.save(variant);
      } catch (e: any) {
        // PostgreSQL unique violation: (shopId, globalProductId)
        if (e?.code === '23505') {
          throw new ConflictException('Bu mahsulot do\'koningizda allaqachon mavjud');
        }
        throw e;
      }

      await manager.increment(GlobalProduct, { id: global.id }, 'usageCount', 1);

      if (dto.stock > 0) {
        await receiveBatch(manager, {
          variant: saved,
          quantity: dto.stock,
          costPrice: dto.costPrice ?? 0,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
          userId,
          reason: 'Katalogdan qo\'shildi',
        });
      }
      return (await this.attachGlobal([saved]))[0];
    });
  }

  /**
   * Create a new shop product that is NOT yet in the shared catalogue.
   * If a barcode is given, upserts a shared GlobalProduct entry.
   * If no barcode, creates a private GlobalProduct (ownerShopId = shopId).
   */
  async createCustomProduct(
    userId: string,
    shopId: string,
    dto: {
      name: string;
      brand?: string;
      unitType?: UnitType;
      unitSize?: number;
      photos?: string[];
      description?: string;
      categoryId?: string;
      barcode?: string;
      price: number;
      discountPrice?: number;
      stock: number;
      costPrice?: number;
      lowStockThreshold?: number;
      criticalThreshold?: number;
      expiryDate?: string;
    },
  ): Promise<VariantWithGlobal> {
    await this.ensureShopAccess(userId, shopId, 'inventory.product.create');

    return this.dataSource.transaction(async (manager) => {
      let globalProductId: string;

      if (dto.barcode) {
        // Barcoded → add to shared catalogue (or link to existing).
        globalProductId = await this.upsertGlobalProduct(manager, userId, {
          barcode: dto.barcode,
          name: dto.name,
          brand: dto.brand ?? null,
          unitType: dto.unitType ?? 'piece',
          unitSize: dto.unitSize ?? 1,
          categoryId: dto.categoryId ?? null,
          photos: dto.photos ?? [],
          description: dto.description ?? null,
        });
      } else {
        // No barcode → private product for this shop only.
        const gp = await manager.save(
          manager.create(GlobalProduct, {
            name: dto.name,
            brand: dto.brand ?? null,
            unitType: dto.unitType ?? 'piece',
            unitSize: dto.unitSize ?? 1,
            categoryId: dto.categoryId ?? null,
            photos: dto.photos ?? [],
            description: dto.description ?? null,
            barcode: null,
            createdBySellerId: userId,
            ownerShopId: shopId,
            isVerified: false,
            isActive: true,
            usageCount: 0,
          }),
        );
        globalProductId = gp.id;
      }

      let saved: ProductVariant;
      try {
        const variant = manager.create(ProductVariant, {
          shopId,
          globalProductId,
          price: dto.price,
          discountPrice: dto.discountPrice ?? null,
          stock: 0,
          lowStockThreshold: dto.lowStockThreshold ?? 5,
          criticalThreshold: dto.criticalThreshold ?? null,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        });
        saved = await manager.save(variant);
      } catch (e: any) {
        if (e?.code === '23505') {
          throw new ConflictException('Bu mahsulot do\'koningizda allaqachon mavjud');
        }
        throw e;
      }

      if (dto.stock > 0) {
        await receiveBatch(manager, {
          variant: saved,
          quantity: dto.stock,
          costPrice: dto.costPrice ?? 0,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
          userId,
          reason: 'Boshlang\'ich qoldiq',
        });
      }
      return (await this.attachGlobal([saved]))[0];
    });
  }

  /**
   * Duplicate an existing ProductVariant into a fresh one (SPEC.md §24.1) —
   * e.g. "Pepsi 0.5L" → "Pepsi 1L" without retyping every field.
   *
   * Copies name (with " — nusxa" suffix)/photos/category/unit/description,
   * resets stock to 0 and does NOT copy discountPrice/expiryDate (fresh
   * values). Always creates a brand-new PRIVATE GlobalProduct — even if the
   * source was linked to the shared catalogue — since the name and other
   * display fields are changing and must not mutate the shared entry; the
   * duplicate can be re-linked to the catalogue later by the seller if
   * desired. Reuses createCustomProduct's private-product path rather than
   * duplicating its logic.
   */
  async duplicateVariant(userId: string, variantId: string): Promise<VariantWithGlobal> {
    const source = await this.getVariantWithGlobal(variantId);
    await this.ensureShopAccess(userId, source.shopId, 'inventory.product.create');

    return this.createCustomProduct(userId, source.shopId, {
      name: `${source.name} — nusxa`,
      brand: source.brand ?? undefined,
      unitType: source.unitType,
      unitSize: source.unitSize,
      photos: source.photos,
      description: source.globalProduct?.description ?? undefined,
      categoryId: source.categoryId ?? undefined,
      // barcode intentionally omitted: the duplicate is always private
      // (globalProductId = null), never auto-linked back to the shared entry.
      price: source.price,
      stock: 0,
      lowStockThreshold: source.lowStockThreshold,
      criticalThreshold: source.criticalThreshold ?? undefined,
      // discountPrice / expiryDate intentionally NOT copied — fresh values.
    });
  }

  /**
   * Find existing shared catalogue entry by barcode, or create one.
   * Back-fills blank fields (brand, photos, categoryId) from this seller.
   * Returns the GlobalProduct id.
   */
  private async upsertGlobalProduct(
    manager: EntityManager,
    userId: string,
    data: {
      barcode: string;
      name: string;
      brand: string | null;
      unitType: UnitType;
      unitSize: number;
      categoryId: string | null;
      photos: string[];
      description?: string | null;
    },
  ): Promise<string> {
    const existing = await manager.findOne(GlobalProduct, {
      where: { barcode: data.barcode },
    });
    if (existing) {
      existing.usageCount += 1;
      if (!existing.photos?.length && data.photos.length) existing.photos = data.photos;
      if (!existing.brand && data.brand) existing.brand = data.brand;
      if (!existing.categoryId && data.categoryId) existing.categoryId = data.categoryId;
      if (!existing.description && data.description) existing.description = data.description;
      await manager.save(existing);
      return existing.id;
    }
    // INSERT ... ON CONFLICT (barcode) DO NOTHING — if a concurrent scan of
    // the same new barcode wins the race and creates it first, this is a
    // silent no-op, NOT a thrown error. That matters: a caught unique-
    // violation here would otherwise poison the whole transaction (Postgres
    // marks it "aborted" after any failed statement, so even the fallback
    // SELECT that used to run in the catch block would itself fail with
    // "current transaction is aborted" — the previous try/catch version of
    // this fallback never actually worked).
    await manager
      .createQueryBuilder()
      .insert()
      .into(GlobalProduct)
      .values({
        barcode: data.barcode,
        name: data.name,
        brand: data.brand,
        unitType: data.unitType,
        unitSize: data.unitSize,
        categoryId: data.categoryId,
        photos: data.photos,
        description: data.description ?? null,
        createdBySellerId: userId,
        usageCount: 1,
        isActive: true,
        isVerified: false,
        ownerShopId: null,
      })
      .orIgnore()
      .execute();

    // Whether we just inserted it or a concurrent request won the race, a
    // row for this barcode is now guaranteed to exist.
    const row = await manager.findOneOrFail(GlobalProduct, { where: { barcode: data.barcode } });
    return row.id;
  }

  /** Public lookup: scan a barcode → shared catalogue entry (or null). */
  async lookupGlobalByBarcode(barcode: string): Promise<GlobalProduct | null> {
    return this.globalProducts.findOne({
      where: { barcode: barcode.trim(), isActive: true },
    });
  }

  async updateVariant(
    userId: string,
    variantId: string,
    dto: {
      // Display fields — only editable when seller owns the GlobalProduct (private product)
      name?: string;
      photos?: string[];
      description?: string;
      // Commercial fields — always editable
      price?: number;
      discountPrice?: number | null;
      lowStockThreshold?: number;
      criticalThreshold?: number | null;
      isActive?: boolean;
    },
  ): Promise<VariantWithGlobal> {
    const variant = await this.getVariant(variantId);
    await this.ensureShopAccess(userId, variant.shopId, 'inventory.product.edit_info');
    if (dto.price !== undefined || dto.discountPrice !== undefined) {
      await this.ensureShopAccess(userId, variant.shopId, 'inventory.product.edit_price');
    }
    if (dto.isActive !== undefined && dto.isActive !== variant.isActive) {
      await this.ensureShopOwner(userId, variant.shopId);
    }

    // Display-field edits → update GlobalProduct only if this shop owns it
    const hasDisplayEdit = dto.name !== undefined || dto.photos !== undefined || dto.description !== undefined;
    if (hasDisplayEdit) {
      const gp = await this.globalProducts.findOne({ where: { id: variant.globalProductId } });
      if (!gp) throw new NotFoundException('Global mahsulot topilmadi');
      if (gp.ownerShopId !== variant.shopId) {
        throw new ForbiddenException(
          'Umumiy katalog mahsulotini tahrirlash mumkin emas. Nom/rasm admin orqali o\'zgartiriladi.',
        );
      }
      if (dto.name !== undefined) gp.name = dto.name;
      if (dto.photos !== undefined) gp.photos = dto.photos;
      if (dto.description !== undefined) gp.description = dto.description;
      await this.globalProducts.save(gp);
    }

    // Commercial fields update
    const hadDiscount = variant.discountPrice !== null && variant.discountPrice !== undefined;
    const prevDiscount = variant.discountPrice;
    const commercialFields: Partial<ProductVariant> = {};
    if (dto.price !== undefined) commercialFields.price = dto.price;
    if (dto.discountPrice !== undefined) commercialFields.discountPrice = dto.discountPrice;
    if (dto.lowStockThreshold !== undefined) commercialFields.lowStockThreshold = dto.lowStockThreshold;
    if (dto.criticalThreshold !== undefined) commercialFields.criticalThreshold = dto.criticalThreshold;
    if (dto.isActive !== undefined) commercialFields.isActive = dto.isActive;
    Object.assign(variant, commercialFields);
    const saved = await this.variants.save(variant);

    // Notify users who favorited this shop when a new discount is applied.
    const isNewDiscount =
      saved.discountPrice !== null &&
      saved.discountPrice !== undefined &&
      (!hadDiscount || saved.discountPrice !== prevDiscount);
    if (isNewDiscount) {
      const gp = await this.globalProducts.findOne({
        where: { id: saved.globalProductId },
        select: { name: true },
      });
      void this.notifyFavoriteShopDiscount(
        saved.shopId,
        gp?.name ?? 'Mahsulot',
        saved.price,
        saved.discountPrice!,
      );
    }
    return (await this.attachGlobal([saved]))[0];
  }

  private async notifyFavoriteShopDiscount(
    shopId: string,
    productName: string,
    price: number,
    discountPrice: number,
  ): Promise<void> {
    const shop = await this.shops.findOne({ where: { id: shopId }, select: { name: true } });
    const favUsers = await this.users
      .createQueryBuilder('u')
      .where(':shopId = ANY(u.favoriteShopIds)', { shopId })
      .select(['u.id'])
      .getMany();
    if (favUsers.length === 0) return;
    const pct = Math.round(((price - discountPrice) / price) * 100);
    void this.push.sendToUsers(favUsers.map((u) => u.id), {
      title: `${shop?.name ?? 'Do\'koningiz'} — yangi aksiya!`,
      body: `${productName}: ${discountPrice.toLocaleString('ru')} so'm (${pct}% chegirma)`,
      data: { kind: 'shop_discount', shopId },
    });
  }

  async deleteVariant(userId: string, variantId: string): Promise<void> {
    const variant = await this.getVariant(variantId);
    await this.ensureShopOwner(userId, variant.shopId);
    variant.isActive = false;
    await this.variants.save(variant);
    // Decrement shared usage count (guarded at >= 0).
    await this.globalProducts
      .createQueryBuilder()
      .update()
      .set({ usageCount: () => 'GREATEST("usageCount" - 1, 0)' })
      .where('id = :id', { id: variant.globalProductId })
      .execute();
  }

  async adjustStock(
    userId: string,
    variantId: string,
    delta: number,
    reason?: string,
  ): Promise<VariantWithGlobal> {
    const variant = await this.getVariant(variantId);
    await this.ensureShopAccess(userId, variant.shopId, 'inventory.product.edit_stock');
    if (delta === 0) return (await this.attachGlobal([variant]))[0];

    return this.dataSource.transaction(async (manager) => {
      // Re-fetch WITH a write lock inside the transaction — the `variant`
      // above was read before the transaction opened, so mutating it here
      // would silently overwrite a concurrent stock change (lost update).
      const locked = await manager.findOne(ProductVariant, {
        where: { id: variantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Mahsulot topilmadi');
      if (locked.stock + delta < 0) throw new BadRequestException('Qoldiq manfiy bo\'la olmaydi');

      if (delta > 0) {
        const lastCost = await this.lastCost(variantId);
        await receiveBatch(manager, {
          variant: locked,
          quantity: delta,
          costPrice: lastCost,
          userId,
          reason: reason ?? 'Qo\'lda tuzatish',
        });
      } else {
        const gp = await this.globalProducts.findOne({
          where: { id: locked.globalProductId },
          select: { name: true },
        });
        await consumeFifo(manager, {
          variant: locked,
          quantity: -delta,
          type: MovementType.Adjusted,
          userId,
          displayName: gp?.name,
          reason: reason ?? 'Qo\'lda tuzatish',
        });
      }
      const updated = await manager.findOneOrFail(ProductVariant, { where: { id: variantId } });
      return (await this.attachGlobal([updated]))[0];
    });
  }

  private static readonly BRAK_REASON_LABEL: Record<BrakReasonCode, string> = {
    [BrakReasonCode.Expired]: 'Muddati o\'tdi',
    [BrakReasonCode.Damaged]: 'Shikastlangan / singan',
    [BrakReasonCode.Stolen]: 'Yo\'qolgan / o\'g\'irlangan',
    [BrakReasonCode.Other]: 'Boshqa',
  };

  /**
   * Write off a variant's entire remaining stock as brak — expired, damaged,
   * stolen or other (SPEC.md §26.3). A reason is always required; 'other'
   * additionally requires a free-text note (enforced by BrakStockDto).
   * Reuses the same pessimistic-lock pattern as adjustStock to prevent lost
   * updates under concurrent stock changes.
   */
  async brakStock(
    userId: string,
    variantId: string,
    reasonCode: BrakReasonCode,
    note?: string,
  ): Promise<VariantWithGlobal> {
    const variant = await this.getVariant(variantId);
    await this.ensureShopAccess(userId, variant.shopId, 'inventory.product.edit_stock');

    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(ProductVariant, {
        where: { id: variantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Mahsulot topilmadi');
      if (locked.stock <= 0) throw new BadRequestException('Qoldiq allaqachon 0');

      const gp = await this.globalProducts.findOne({
        where: { id: locked.globalProductId },
        select: { name: true },
      });
      // InventoryMovement.type only distinguishes expired/damaged (the two
      // spec'd movement kinds) — stolen/other are booked as Damaged too, with
      // the precise cause preserved in brakReasonCode/brakReasonNote.
      const movementType = reasonCode === BrakReasonCode.Expired ? MovementType.Expired : MovementType.Damaged;
      await consumeFifo(manager, {
        variant: locked,
        quantity: locked.stock,
        type: movementType,
        userId,
        displayName: gp?.name,
        reason: `Brak: ${ProductsService.BRAK_REASON_LABEL[reasonCode]}`,
        brakReasonCode: reasonCode,
        brakReasonNote: note ?? null,
      });
      const updated = await manager.findOneOrFail(ProductVariant, { where: { id: variantId } });
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
    await this.ensureShopAccess(userId, variant.shopId, 'inventory.product.edit_stock');
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
      const updated = await manager.findOneOrFail(ProductVariant, { where: { id: variantId } });
      return (await this.attachGlobal([updated]))[0];
    });
  }

  async countStock(userId: string, variantId: string, actualQty: number): Promise<VariantWithGlobal> {
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
        await consumeFifo(manager, {
          variant: locked,
          quantity: -delta,
          type: MovementType.Adjusted,
          displayName: gp?.name,
          userId,
          reason: 'Inventarizatsiya (kamomad)',
        });
      }
      const updated = await manager.findOneOrFail(ProductVariant, { where: { id: variantId } });
      return (await this.attachGlobal([updated]))[0];
    });
  }

  private async lastCost(variantId: string): Promise<number> {
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

  private async costSummaries(variantIds: string[]): Promise<Map<string, VariantCost>> {
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
    const valueMap = new Map(rows.map((r) => [r.vid, { qty: Number(r.qty), value: Number(r.value) }]));

    const heads = await this.batches
      .createQueryBuilder('b')
      .where('b.productVariantId IN (:...ids)', { ids: variantIds })
      .andWhere('b.quantityRemaining > 0')
      .orderBy('b.productVariantId')
      .addOrderBy('b.receivedAt', 'ASC')
      .getMany();
    const nextCostMap = new Map<string, number>();
    for (const b of heads) {
      if (!nextCostMap.has(b.productVariantId)) nextCostMap.set(b.productVariantId, b.costPrice);
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
    opts: { search?: string; limit?: number; offset?: number; lowOnly?: boolean } = {},
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
      qb.skip(Math.max(opts.offset ?? 0, 0)).take(Math.min(Math.max(opts.limit, 1), 100));
    }

    const variants = await qb.getMany();
    const globalMap = new Map(
      (variants as unknown as (ProductVariant & { globalProduct: GlobalProduct })[])
        .map((v) => [v.id, v.globalProduct]),
    );
    const costs = await this.costSummaries(variants.map((v) => v.id));
    return (variants as unknown as VariantWithGlobal[]).map((v: any) => ({
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

  listMovements(userId: string, variantId: string): Promise<InventoryMovement[]> {
    return this.getVariant(variantId).then(async (v) => {
      await this.ensureShopAccess(userId, v.shopId, 'inventory.movement.view');
      return this.movements.find({
        where: { productVariantId: variantId },
        order: { createdAt: 'DESC' },
        take: 100,
      });
    });
  }

  /**
   * Tiered low-stock list for the "Kam qoldiqlar" screen — mirrors the
   * warning/critical thresholds low-stock-alert.service.ts's cron already
   * alerts on (SPEC.md §30), tagging each item so the UI can group/color them.
   */
  async listLowStock(
    userId: string,
    shopId: string,
  ): Promise<(VariantWithGlobal & { tier: 'critical' | 'warning' })[]> {
    await this.ensureShopAccess(userId, shopId, 'inventory.view');
    const defaultWarning = this.settings.getNumber(SETTING_KEYS.LOW_STOCK_WARNING_DEFAULT, 10);
    const defaultCritical = this.settings.getNumber(SETTING_KEYS.LOW_STOCK_CRITICAL_DEFAULT, 3);

    const vs = await this.variants
      .createQueryBuilder('v')
      .where('v.shopId = :shopId', { shopId })
      .andWhere('v.isActive = true')
      .andWhere('(v.stock <= v.lowStockThreshold) OR (v.stock <= :defWarn)', { defWarn: defaultWarning })
      .orderBy('v.stock', 'ASC')
      .getMany();

    const withGlobal = await this.attachGlobal(vs);
    return withGlobal.map((v) => {
      const criticalLine = v.criticalThreshold ?? defaultCritical;
      const tier: 'critical' | 'warning' = v.stock <= criticalLine ? 'critical' : 'warning';
      return { ...v, tier };
    });
  }

  // ─── Public catalog ────────────────────────────────────────────────────────

  async listShopCatalog(
    shopId: string,
    search?: string,
    categoryId?: string,
  ): Promise<VariantWithGlobal[]> {
    const qb = this.variants
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.globalProduct', 'gp')
      .where('v.shopId = :shopId', { shopId })
      .andWhere('v.isActive = true');

    if (search) {
      qb.andWhere('(gp.name ILIKE :q OR gp.brand ILIKE :q)', { q: `%${search}%` });
    }
    if (categoryId) {
      qb.andWhere('gp.categoryId = :categoryId', { categoryId });
    }
    qb.orderBy('v.createdAt', 'DESC').take(200);

    const variants = await qb.getMany();
    return this.buildVariantWithGlobal(variants);
  }

  async searchVariantsInShops(shopIds: string[], query: string): Promise<VariantWithGlobal[]> {
    if (shopIds.length === 0) return [];
    const variants = await this.variants
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.globalProduct', 'gp')
      .where('v.shopId IN (:...shopIds)', { shopIds })
      .andWhere('v.isActive = true')
      .andWhere('v.stock > 0')
      .andWhere('(gp.name ILIKE :q OR gp.brand ILIKE :q)', { q: `%${query}%` })
      .orderBy('v.ratingAverage', 'DESC')
      .take(100)
      .getMany();
    return this.buildVariantWithGlobal(variants);
  }

  /** Flatten already-joined GlobalProduct (from innerJoinAndSelect) onto variants. */
  private buildVariantWithGlobal(
    variants: (ProductVariant & { globalProduct?: GlobalProduct })[],
  ): VariantWithGlobal[] {
    return variants.map((v: any) => ({
      ...v,
      name: v.globalProduct?.name ?? '',
      brand: v.globalProduct?.brand ?? null,
      photos: v.globalProduct?.photos ?? [],
      unitType: v.globalProduct?.unitType ?? 'piece',
      unitSize: v.globalProduct?.unitSize ?? 1,
      barcode: v.globalProduct?.barcode ?? null,
      isVerified: v.globalProduct?.isVerified ?? false,
      categoryId: v.globalProduct?.categoryId ?? null,
    }));
  }

  async getVariantDetail(variantId: string) {
    const variant = await this.variants.findOne({
      where: { id: variantId, isActive: true },
      relations: { globalProduct: true },
    });
    if (!variant) throw new NotFoundException('Mahsulot topilmadi');
    const gp = (variant as any).globalProduct as GlobalProduct;

    // Siblings: other variants in this shop within the same size group
    let siblings: VariantWithGlobal[] = [];
    const parentId = gp?.parentGlobalProductId ?? gp?.id;
    if (parentId) {
      const groupGPs = await this.globalProducts.findBy([
        { id: parentId, isActive: true },
        { parentGlobalProductId: parentId, isActive: true },
      ]);
      const gpIds = groupGPs.map((g) => g.id).filter((id) => id !== variant.globalProductId);
      if (gpIds.length > 0) {
        const siblingVariants = await this.variants.find({
          where: { shopId: variant.shopId, globalProductId: In(gpIds), isActive: true },
          order: { price: 'ASC' },
        });
        siblings = await this.attachGlobal(siblingVariants);
      }
    }

    const shop = await this.shops.findOne({ where: { id: variant.shopId } });

    return {
      ...variant,
      name: gp?.name ?? '',
      brand: gp?.brand ?? null,
      photos: gp?.photos ?? [],
      unitType: gp?.unitType ?? 'piece',
      unitSize: gp?.unitSize ?? 1,
      barcode: gp?.barcode ?? null,
      isVerified: gp?.isVerified ?? false,
      categoryId: gp?.categoryId ?? null,
      globalProduct: gp,
      siblings,
      shop: shop
        ? {
            id: shop.id,
            name: shop.name,
            isOpenManual: isShopOpenNow(shop),
            minOrderPrice: shop.minOrderPrice,
            photos: shop.photos,
          }
        : null,
    };
  }

  /**
   * All shops offering this GlobalProduct OR any of its size-group siblings
   * (same product family — e.g. Coca-Cola 0.5L/1L/1.5L) — used to suggest
   * alternatives when a shop doesn't accept an order (SellerNoResponse /
   * SellerRejected). `excludeShopId` drops the shop that just rejected it,
   * since the point is finding somewhere ELSE to buy from.
   */
  async getFamilyOffers(
    globalProductId: string,
    userLat?: number,
    userLng?: number,
    excludeShopId?: string,
  ) {
    const gp = await this.globalProducts.findOne({ where: { id: globalProductId } });
    if (!gp) return [];
    const rootId = gp.parentGlobalProductId ?? gp.id;
    const family = await this.globalProducts.find({
      where: [{ id: rootId }, { parentGlobalProductId: rootId }],
    });
    const familyIds = family.map((f) => f.id);

    const qb = this.variants
      .createQueryBuilder('v')
      .innerJoin('v.shop', 's')
      .addSelect(['s.id', 's.name', 's.latitude', 's.longitude', 's.isActive', 's.photos'])
      .where('v.globalProductId IN (:...familyIds)', { familyIds })
      .andWhere('v.isActive = true')
      .andWhere('v.stock > 0')
      .andWhere('s.isActive = true');
    if (excludeShopId) qb.andWhere('v.shopId != :excludeShopId', { excludeShopId });
    const variants = await qb.orderBy('COALESCE(v."discountPrice", v.price)', 'ASC').take(50).getMany();

    return variants.map((v: any) => {
      const s = v.shop as Shop;
      const distanceKm =
        userLat && userLng && s?.latitude && s?.longitude
          ? haversineKm(userLat, userLng, s.latitude, s.longitude)
          : null;
      return {
        variantId: v.id,
        globalProductId: v.globalProductId,
        shopId: s?.id ?? v.shopId,
        shopName: s?.name ?? '',
        shopPhotos: s?.photos ?? [],
        distanceKm,
        price: v.price,
        discountPrice: v.discountPrice,
        stock: v.stock,
        isOpen: s ? isShopOpenNow(s) : false,
      };
    });
  }

  /** All shops offering the same GlobalProduct — for customer price comparison. */
  async getGlobalProductOffers(
    globalProductId: string,
    userLat?: number,
    userLng?: number,
  ) {
    const variants = await this.variants
      .createQueryBuilder('v')
      .innerJoin('v.shop', 's')
      .addSelect([
        's.id', 's.name', 's.latitude', 's.longitude', 's.isActive', 's.photos',
      ])
      .where('v.globalProductId = :globalProductId', { globalProductId })
      .andWhere('v.isActive = true')
      .andWhere('v.stock > 0')
      .andWhere('s.isActive = true')
      .orderBy('COALESCE(v."discountPrice", v.price)', 'ASC')
      .take(50)
      .getMany();

    return variants.map((v: any) => {
      const s = v.shop as Shop;
      const distanceKm =
        userLat && userLng && s?.latitude && s?.longitude
          ? haversineKm(userLat, userLng, s.latitude, s.longitude)
          : null;
      return {
        variantId: v.id,
        shopId: s?.id ?? v.shopId,
        shopName: s?.name ?? '',
        shopPhotos: s?.photos ?? [],
        distanceKm,
        price: v.price,
        discountPrice: v.discountPrice,
        stock: v.stock,
        isOpen: s ? isShopOpenNow(s) : false,
      };
    });
  }

  async listShopReviews(userId: string, shopId: string) {
    await this.ensureShopAccess(userId, shopId, 'reviews.view');
    // Load variants with globalProduct to get names
    const variants = await this.variants
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.globalProduct', 'gp')
      .where('v.shopId = :shopId', { shopId })
      .select(['v.id', 'gp.name'])
      .getMany();
    if (variants.length === 0) return [];
    const nameMap = new Map(variants.map((v: any) => [v.id, (v.globalProduct as GlobalProduct)?.name ?? '']));
    const reviews = await this.reviews.find({
      where: { productVariantId: In([...nameMap.keys()]) },
      relations: { user: true },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return reviews.map((r) => ({
      id: r.id,
      stars: r.stars,
      text: r.text,
      createdAt: r.createdAt,
      userName: r.user?.name ?? 'Foydalanuvchi',
      productName: nameMap.get(r.productVariantId) ?? '',
    }));
  }

  async listVariantReviews(variantId: string) {
    const reviews = await this.reviews.find({
      where: { productVariantId: variantId },
      relations: { user: true },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return reviews.map((r) => ({
      id: r.id,
      stars: r.stars,
      text: r.text,
      createdAt: r.createdAt,
      userName: r.user?.name ?? 'Foydalanuvchi',
    }));
  }

  // ─── Customer feed ─────────────────────────────────────────────────────────

  async feedNearby(opts: {
    latitude: number;
    longitude: number;
    page?: number;
    limit?: number;
    q?: string;
    categoryId?: string;
    categoryIds?: string[];
    sort?: string;
    onlyDiscounted?: boolean;
    minPrice?: number;
    maxPrice?: number;
  }): Promise<{ items: FeedProduct[]; nextPage: number | null }> {
    const limit = Math.min(opts.limit ?? 24, 60);
    const page = Math.max(opts.page ?? 1, 1);

    const box = boundingBox(opts.latitude, opts.longitude, 50);
    const allShops = await this.shops.find({
      where: {
        isActive: true,
        latitude: Between(box.latMin, box.latMax),
        longitude: Between(box.lngMin, box.lngMax),
      },
    });
    const reachableShops = allShops
      .filter((s) => isShopOpenNow(s))
      .map((s) => {
        const distanceKm = haversineKm(opts.latitude, opts.longitude, s.latitude, s.longitude);
        return { shop: s, distanceKm };
      })
      .filter(({ shop, distanceKm }) => {
        if (shop.deliveryPolygon) {
          return pointInPolygon(opts.latitude, opts.longitude, shop.deliveryPolygon);
        }
        return distanceKm <= shop.deliveryZone.maxKm;
      });

    if (reachableShops.length === 0) {
      return { items: [], nextPage: null };
    }

    const shopIds = reachableShops.map((s) => s.shop.id);
    const shopMap = new Map(reachableShops.map((s) => [s.shop.id, s]));

    const qb = this.variants
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.globalProduct', 'gp')
      .where('v.shopId IN (:...shopIds)', { shopIds })
      .andWhere('v.isActive = true')
      .andWhere('v.stock > 0');

    if (opts.q) {
      qb.andWhere('(gp.name ILIKE :q OR gp.brand ILIKE :q)', { q: `%${opts.q}%` });
    }
    let categoryIds: string[] = [];
    if (opts.categoryIds?.length) categoryIds = opts.categoryIds;
    else if (opts.categoryId) categoryIds = [opts.categoryId];
    if (categoryIds.length > 0) {
      qb.andWhere('gp.categoryId IN (:...categoryIds)', { categoryIds });
    }
    if (opts.onlyDiscounted) {
      qb.andWhere('v.discountPrice IS NOT NULL AND v.discountPrice < v.price');
    }
    if (opts.minPrice !== undefined) {
      qb.andWhere('COALESCE(v.discountPrice, v.price) >= :minPrice', { minPrice: opts.minPrice });
    }
    if (opts.maxPrice !== undefined) {
      qb.andWhere('COALESCE(v.discountPrice, v.price) <= :maxPrice', { maxPrice: opts.maxPrice });
    }

    const tokens = (opts.sort ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    let applied = false;
    const order = (col: string, dir: 'ASC' | 'DESC') => {
      if (applied) qb.addOrderBy(col, dir);
      else { qb.orderBy(col, dir); applied = true; }
    };
    for (const token of tokens) {
      if (token === 'price_asc') order('v.price', 'ASC');
      else if (token === 'price_desc') order('v.price', 'DESC');
      else if (token === 'rating') {
        order('v.ratingAverage', 'DESC');
        qb.addOrderBy('v.ratingCount', 'DESC');
      }
    }
    if (!applied) {
      qb.orderBy('v.ratingAverage', 'DESC').addOrderBy('v.createdAt', 'DESC');
    }

    const total = await qb.getCount();
    const variants = await qb.skip((page - 1) * limit).take(limit).getMany();

    const items: FeedProduct[] = (variants as (ProductVariant & { globalProduct: GlobalProduct })[]).map((v) => {
      const ref = shopMap.get(v.shopId);
      const distanceKm = ref?.distanceKm ?? 0;
      const shop = ref?.shop;
      const isFreeByPolygon =
        shop?.freeDeliveryPolygon != null &&
        pointInPolygon(opts.latitude, opts.longitude, shop.freeDeliveryPolygon);
      const deliveryFeeAtUser =
        isFreeByPolygon ? 0
        : shop
        ? calcDeliveryFee({
            distanceKm,
            freeKm: shop.deliveryZone.freeKm,
            pricingType: shop.deliveryZone.pricingType,
            pricePerStep: shop.deliveryZone.pricePerStep,
          })
        : 0;
      const gp = v.globalProduct;
      return {
        ...v,
        name: gp?.name ?? '',
        brand: gp?.brand ?? null,
        photos: gp?.photos ?? [],
        unitType: gp?.unitType ?? 'piece',
        unitSize: gp?.unitSize ?? 1,
        barcode: gp?.barcode ?? null,
        isVerified: gp?.isVerified ?? false,
        categoryId: gp?.categoryId ?? null,
        shop: {
          id: shop?.id ?? v.shopId,
          name: shop?.name ?? '',
          distanceKm,
          deliveryFeeAtUser,
          isOpen: shop ? isShopOpenNow(shop) : false,
          photos: shop?.photos ?? [],
        },
      } as FeedProduct;
    });

    const nextPage = page * limit < total ? page + 1 : null;
    return { items, nextPage };
  }

  // ─── Ommaviy narx yangilash ───────────────────────────────────────────────

  async bulkPriceUpdate(
    userId: string,
    shopId: string,
    dto: {
      scope: 'all' | 'category' | 'selected';
      categoryId?: string;
      variantIds?: string[];
      adjustType: 'percent' | 'fixed';
      adjustValue: number;
      direction: 'increase' | 'decrease';
    },
  ): Promise<{ updated: number }> {
    await this.ensureShopAccess(userId, shopId, 'inventory.product.edit_price');

    const qb = this.variants
      .createQueryBuilder('v')
      .innerJoin('v.globalProduct', 'gp')
      .where('v.shopId = :shopId', { shopId })
      .andWhere('v.isActive = true');

    if (dto.scope === 'category' && dto.categoryId) {
      qb.andWhere('gp.categoryId = :categoryId', { categoryId: dto.categoryId });
    } else if (dto.scope === 'selected' && dto.variantIds?.length) {
      qb.andWhere('v.id IN (:...ids)', { ids: dto.variantIds });
    }

    const targets = await qb.getMany();
    if (targets.length === 0) return { updated: 0 };

    const sign = dto.direction === 'increase' ? 1 : -1;
    // Fixed (id-ascending) lock order — avoids deadlocking against another
    // concurrent price/stock change locking the same variants (see the
    // matching comment in orders.service.ts's create()).
    const sortedIds = [...targets.map((v) => v.id)].sort((a, b) => a.localeCompare(b));

    const updatedCount = await this.dataSource.transaction(async (manager) => {
      let count = 0;
      for (const id of sortedIds) {
        // Re-read under lock — a concurrent edit (e.g. the seller manually
        // repricing one item mid-bulk-update) must not be silently
        // overwritten by a stale in-memory price read before the transaction.
        const v = await manager.findOne(ProductVariant, { where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!v) continue;
        const delta =
          dto.adjustType === 'percent'
            ? Math.round(v.price * (dto.adjustValue / 100))
            : dto.adjustValue;
        const beforePrice = v.price;
        const afterPrice = Math.max(1, v.price + sign * delta);
        if (afterPrice === beforePrice) continue;

        v.price = afterPrice;
        await manager.save(v);
        // Every price change is logged (SPEC §24.2) so it shows up in
        // /movements and the inventory-history Excel export.
        await manager.save(
          manager.create(InventoryMovement, {
            productVariantId: v.id,
            type: MovementType.PriceChanged,
            quantity: 0,
            beforeStock: v.stock,
            afterStock: v.stock,
            beforePrice,
            afterPrice,
            reason: 'Ommaviy narx yangilash',
            performedByUserId: userId,
          }),
        );
        count += 1;
      }
      return count;
    });

    return { updated: updatedCount };
  }

  // ─── Muddati o'tayotganlar ────────────────────────────────────────────────

  /**
   * "Muddati o'tayotganlar" list, tiered exactly like the cron in
   * expiry-alert.service.ts (SPEC.md §26.2): 🔴 expired (today or past),
   * 🟠 critical (within EXPIRY_CRITICAL_DAYS), 🟡 warning (within the window).
   * `days` optionally widens the overall window beyond the warning default.
   */
  async listExpiring(
    userId: string,
    shopId: string,
    days?: number,
  ): Promise<(VariantWithGlobal & { tier: 'expired' | 'critical' | 'warning'; daysToExpiry: number })[]> {
    await this.ensureShopAccess(userId, shopId, 'inventory.view');
    const warningDays = this.settings.getNumber(SETTING_KEYS.EXPIRY_WARNING_DAYS, 7);
    const criticalDays = this.settings.getNumber(SETTING_KEYS.EXPIRY_CRITICAL_DAYS, 2);
    const windowDays = days ?? warningDays;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + windowDays);

    const vs = await this.variants
      .createQueryBuilder('v')
      .where('v.shopId = :shopId', { shopId })
      .andWhere('v.isActive = true')
      .andWhere('v.expiryDate IS NOT NULL')
      .andWhere('v.expiryDate <= :cutoff', { cutoff })
      .orderBy('v.expiryDate', 'ASC')
      .getMany();

    const withGlobal = await this.attachGlobal(vs);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return withGlobal.map((v) => {
      const exp = new Date(v.expiryDate!);
      const daysToExpiry = Math.round((exp.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
      const tier: 'expired' | 'critical' | 'warning' =
        daysToExpiry <= 0 ? 'expired' : daysToExpiry <= criticalDays ? 'critical' : 'warning';
      return { ...v, daysToExpiry, tier };
    });
  }

  // ─── Global katalog (seller qidiruvi) ─────────────────────────────────────

  async searchGlobalCatalog(
    shopId: string,
    query: string,
    limit = 20,
  ): Promise<GlobalProduct[]> {
    const qb = this.globalProducts
      .createQueryBuilder('gp')
      .where('gp.isActive = true')
      .andWhere('(gp.ownerShopId IS NULL OR gp.ownerShopId = :shopId)', { shopId })
      // Verified products float to the top; then sorted by popularity
      .orderBy('gp.isVerified', 'DESC')
      .addOrderBy('gp.usageCount', 'DESC')
      .addOrderBy('gp.name', 'ASC')
      .take(Math.min(limit, 50));

    const q = query.trim();
    if (q) {
      qb.andWhere('(gp.name ILIKE :q OR gp.barcode = :exact OR gp.brand ILIKE :q)', {
        q: `%${q}%`,
        exact: q,
      });
    }
    return qb.getMany();
  }

  // ─── Admin: GlobalProduct CRUD ────────────────────────────────────────────

  private adminGlobalProductsFilterQuery(opts: { q?: string; activeOnly?: boolean; categoryId?: string }) {
    const qb = this.globalProducts
      .createQueryBuilder('gp')
      // Only shared products in admin view by default
      .where('gp.ownerShopId IS NULL')
      .orderBy('gp.usageCount', 'DESC')
      .addOrderBy('gp.createdAt', 'DESC');

    if (opts.q) {
      qb.andWhere(
        '(gp.name ILIKE :q OR gp.nameUzLatn ILIKE :q OR gp.nameUzCyrl ILIKE :q OR gp.nameRu ILIKE :q OR gp.barcode = :exact OR gp.brand ILIKE :q)',
        {
          q: `%${opts.q}%`,
          exact: opts.q.trim(),
        },
      );
    }
    if (opts.activeOnly) qb.andWhere('gp.isActive = true');
    if (opts.categoryId) qb.andWhere('gp.categoryId = :categoryId', { categoryId: opts.categoryId });
    return qb;
  }

  async adminListGlobalProducts(opts: {
    q?: string;
    limit?: number;
    offset?: number;
    activeOnly?: boolean;
    categoryId?: string;
  }): Promise<{ items: GlobalProduct[]; total: number }> {
    const qb = this.adminGlobalProductsFilterQuery(opts);
    const limit = Math.min(opts.limit ?? 50, 100);
    const offset = opts.offset ?? 0;
    const [items, total] = await qb.skip(offset).take(limit).getManyAndCount();
    return { items, total };
  }

  async adminExportGlobalProducts(opts: { q?: string; activeOnly?: boolean; categoryId?: string }): Promise<Buffer> {
    const rows = await this.adminGlobalProductsFilterQuery(opts).take(5000).getMany();
    return buildXlsxBuffer(
      'Katalog',
      [
        { header: 'Nomi (UZ Lotin)', key: 'nameUzLatn', width: 32 },
        { header: 'Nomi (UZ Kirill)', key: 'nameUzCyrl', width: 32 },
        { header: 'Nomi (RU)', key: 'nameRu', width: 32 },
        { header: 'Brend', key: 'brand', width: 20 },
        { header: 'Barkod', key: 'barcode', width: 18 },
        { header: 'Birlik', key: 'unit', width: 12 },
        { header: 'Tasdiqlangan', key: 'isVerified', width: 14 },
        { header: 'Aktiv', key: 'isActive', width: 10 },
        { header: "Do'konlar soni", key: 'usageCount', width: 14 },
      ],
      rows.map((p) => ({
        nameUzLatn: p.nameUzLatn || p.name,
        nameUzCyrl: p.nameUzCyrl || '',
        nameRu: p.nameRu || '',
        brand: p.brand ?? '',
        barcode: p.barcode ?? '',
        unit: `${p.unitSize} ${p.unitType}`,
        isVerified: p.isVerified ? 'ha' : "yo'q",
        isActive: p.isActive ? 'ha' : "yo'q",
        usageCount: p.usageCount,
      })),
    );
  }

  /** Aggregate counters for the catalog page's summary bar (shared products only). */
  async adminGetCatalogStats(): Promise<{ total: number; verified: number; active: number }> {
    const base = this.globalProducts.createQueryBuilder('gp').where('gp.ownerShopId IS NULL');
    const [total, verified, active] = await Promise.all([
      base.clone().getCount(),
      base.clone().andWhere('gp.isVerified = true').getCount(),
      base.clone().andWhere('gp.isActive = true').getCount(),
    ]);
    return { total, verified, active };
  }

  async adminCreateGlobalProduct(dto: {
    name?: string;
    nameUzLatn?: string;
    nameUzCyrl?: string;
    nameRu?: string;
    barcode?: string;
    brand?: string;
    categoryId?: string;
    unitType?: UnitType;
    unitSize?: number;
    photos?: string[];
    description?: string;
    descriptionUzLatn?: string;
    descriptionUzCyrl?: string;
    descriptionRu?: string;
    parentGlobalProductId?: string;
    isVerified?: boolean;
  }): Promise<GlobalProduct> {
    if (dto.barcode) {
      const existing = await this.globalProducts.findOne({ where: { barcode: dto.barcode } });
      if (existing) throw new BadRequestException('Bu barcode allaqachon katalogda mavjud');
    }
    if (dto.parentGlobalProductId) {
      const parent = await this.globalProducts.findOne({ where: { id: dto.parentGlobalProductId } });
      if (!parent) throw new NotFoundException('Asosiy mahsulot topilmadi');
    }

    const nameUzLatn = dto.nameUzLatn?.trim() || dto.name?.trim() || '';
    const nameUzCyrl = dto.nameUzCyrl?.trim() || (nameUzLatn ? latinToCyrillic(nameUzLatn) : '');
    const nameRu = dto.nameRu?.trim() || nameUzLatn;

    const descriptionUzLatn = dto.descriptionUzLatn?.trim() || dto.description?.trim() || null;
    const descriptionUzCyrl =
      dto.descriptionUzCyrl?.trim() || (descriptionUzLatn ? latinToCyrillic(descriptionUzLatn) : null);
    const descriptionRu = dto.descriptionRu?.trim() || descriptionUzLatn;

    const gp = this.globalProducts.create({
      name: nameUzLatn || nameRu,
      nameUzLatn,
      nameUzCyrl,
      nameRu,
      barcode: dto.barcode ?? null,
      brand: dto.brand ?? null,
      categoryId: dto.categoryId ?? null,
      unitType: dto.unitType ?? 'piece',
      unitSize: dto.unitSize ?? 1,
      photos: dto.photos ?? [],
      description: descriptionUzLatn,
      descriptionUzLatn,
      descriptionUzCyrl,
      descriptionRu,
      parentGlobalProductId: dto.parentGlobalProductId ?? null,
      isVerified: dto.isVerified ?? true,
      isActive: true,
      ownerShopId: null,
    });
    return this.globalProducts.save(gp);
  }

  async adminUpdateGlobalProduct(
    id: string,
    dto: Partial<{
      name: string;
      nameUzLatn: string;
      nameUzCyrl: string;
      nameRu: string;
      barcode: string | null;
      brand: string | null;
      categoryId: string | null;
      unitType: UnitType;
      unitSize: number;
      photos: string[];
      description: string | null;
      descriptionUzLatn: string | null;
      descriptionUzCyrl: string | null;
      descriptionRu: string | null;
      parentGlobalProductId: string | null;
      isVerified: boolean;
      isActive: boolean;
    }>,
  ): Promise<GlobalProduct> {
    const gp = await this.globalProducts.findOne({ where: { id } });
    if (!gp) throw new NotFoundException('Global mahsulot topilmadi');
    if (dto.barcode && dto.barcode !== gp.barcode) {
      const existing = await this.globalProducts.findOne({ where: { barcode: dto.barcode } });
      if (existing) throw new BadRequestException('Bu barcode allaqachon katalogda mavjud');
    }
    if (dto.parentGlobalProductId && dto.parentGlobalProductId !== gp.parentGlobalProductId) {
      if (dto.parentGlobalProductId === id) {
        throw new BadRequestException('Mahsulot o\'z-o\'ziga ota bo\'la olmaydi');
      }
      const parent = await this.globalProducts.findOne({ where: { id: dto.parentGlobalProductId } });
      if (!parent) throw new NotFoundException('Asosiy mahsulot topilmadi');
    }

    if (dto.nameUzLatn !== undefined || dto.name !== undefined) {
      const nameUzLatn = dto.nameUzLatn?.trim() || dto.name?.trim() || '';
      gp.nameUzLatn = nameUzLatn;
      gp.name = nameUzLatn;
      if (!dto.nameUzCyrl && nameUzLatn) {
        gp.nameUzCyrl = latinToCyrillic(nameUzLatn);
      }
    }
    if (dto.nameUzCyrl !== undefined) gp.nameUzCyrl = dto.nameUzCyrl.trim();
    if (dto.nameRu !== undefined) gp.nameRu = dto.nameRu.trim();

    if (dto.descriptionUzLatn !== undefined || dto.description !== undefined) {
      const desc = dto.descriptionUzLatn?.trim() || dto.description?.trim() || null;
      gp.descriptionUzLatn = desc;
      gp.description = desc;
      if (!dto.descriptionUzCyrl && desc) {
        gp.descriptionUzCyrl = latinToCyrillic(desc);
      }
    }
    if (dto.descriptionUzCyrl !== undefined) gp.descriptionUzCyrl = dto.descriptionUzCyrl?.trim() || null;
    if (dto.descriptionRu !== undefined) gp.descriptionRu = dto.descriptionRu?.trim() || null;

    if (dto.barcode !== undefined) gp.barcode = dto.barcode;
    if (dto.brand !== undefined) gp.brand = dto.brand;
    if (dto.categoryId !== undefined) gp.categoryId = dto.categoryId;
    if (dto.unitType !== undefined) gp.unitType = dto.unitType;
    if (dto.unitSize !== undefined) gp.unitSize = dto.unitSize;
    if (dto.photos !== undefined) gp.photos = dto.photos;
    if (dto.parentGlobalProductId !== undefined) gp.parentGlobalProductId = dto.parentGlobalProductId;
    if (dto.isVerified !== undefined) gp.isVerified = dto.isVerified;
    if (dto.isActive !== undefined) gp.isActive = dto.isActive;

    return this.globalProducts.save(gp);
  }

  async adminGetGlobalProductStats(id: string) {
    const gp = await this.globalProducts.findOne({ where: { id } });
    if (!gp) throw new NotFoundException('Global mahsulot topilmadi');
    const activeShopCount = await this.variants.count({
      where: { globalProductId: id, isActive: true },
    });
    return { ...gp, activeShopCount };
  }

  /** Per-shop usage details for admin (which shops sell it, at what price). */
  async adminGetGlobalProductUsage(id: string) {
    const gp = await this.globalProducts.findOne({ where: { id } });
    if (!gp) throw new NotFoundException('Global mahsulot topilmadi');

    const rows = await this.variants
      .createQueryBuilder('v')
      .innerJoin('v.shop', 's')
      .addSelect(['s.id', 's.name'])
      .where('v.globalProductId = :id', { id })
      .andWhere('v.isActive = true')
      .orderBy('v.price', 'ASC')
      .getMany();

    return rows.map((v: any) => ({
      variantId: v.id,
      shopId: (v.shop as Shop)?.id ?? v.shopId,
      shopName: (v.shop as Shop)?.name ?? '',
      price: v.price,
      discountPrice: v.discountPrice,
      stock: v.stock,
    }));
  }
}
