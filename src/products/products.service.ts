import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, ILike, In, Repository } from 'typeorm';

import { boundingBox, calcDeliveryFee, haversineKm } from '../geo/geo.util';
import { Review } from '../orders/entities/review.entity';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff, StaffPermission } from '../shops/entities/shop-staff.entity';
import { assertShopPermission } from '../shops/shop-access.util';
import { isShopOpenNow } from '../shops/shop-hours.util';
import { GlobalProduct } from './entities/global-product.entity';
import { InventoryMovement, MovementType } from './entities/inventory-movement.entity';
import { ProductFamily } from './entities/product-family.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { StockBatch } from './entities/stock-batch.entity';
import { consumeFifo, receiveBatch } from './inventory.util';

/** Per-variant FIFO cost summary attached to seller inventory rows. */
export interface VariantCost {
  /** Weighted-average cost of the units currently in stock. */
  avgCost: number;
  /** Cost of the next unit that would be sold (oldest batch). */
  nextCost: number;
  /** Total purchase value of stock on hand (Σ remaining × cost). */
  stockValue: number;
}

export type VariantWithCost = ProductVariant & { cost: VariantCost };

export type FeedProduct = Omit<ProductVariant, 'shop'> & {
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
    @InjectRepository(ProductFamily)
    private readonly families: Repository<ProductFamily>,
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
    private readonly dataSource: DataSource,
  ) {}

  /** Owner, or active staff holding `permission`. */
  private ensureShopAccess(
    userId: string,
    shopId: string,
    permission: StaffPermission,
  ): Promise<Shop> {
    return assertShopPermission(this.shops, this.staff, userId, shopId, permission);
  }

  /** Owner-only — for actions staff must never do (delete / deactivate). */
  private async ensureShopOwner(userId: string, shopId: string): Promise<Shop> {
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Do\'kon topilmadi');
    if (shop.ownerId !== userId) {
      throw new ForbiddenException('Bu amalni faqat do\'kon egasi bajara oladi');
    }
    return shop;
  }

  // Families
  listFamilies(shopId: string): Promise<ProductFamily[]> {
    return this.families.find({
      where: { shopId },
      relations: { category: true },
      order: { name: 'ASC' },
    });
  }

  async createFamily(
    userId: string,
    shopId: string,
    dto: { name: string; categoryId?: string; brand?: string; description?: string },
  ): Promise<ProductFamily> {
    await this.ensureShopAccess(userId, shopId, 'inventory.product.create');
    const fam = this.families.create({
      shopId,
      name: dto.name,
      categoryId: dto.categoryId ?? null,
      brand: dto.brand ?? null,
      description: dto.description ?? null,
    });
    return this.families.save(fam);
  }

  // Variants
  listVariants(shopId: string): Promise<ProductVariant[]> {
    return this.variants.find({
      where: { shopId },
      relations: { productFamily: true },
      order: { createdAt: 'DESC' },
    });
  }

  async getVariant(id: string): Promise<ProductVariant> {
    const v = await this.variants.findOne({ where: { id }, relations: { productFamily: true } });
    if (!v) throw new NotFoundException('Mahsulot topilmadi');
    return v;
  }

  async createVariant(
    userId: string,
    shopId: string,
    dto: {
      productFamilyId: string;
      name: string;
      photos?: string[];
      description?: string;
      unitType: 'piece' | 'kg' | 'liter' | 'gram' | 'pack';
      unitSize: number;
      price: number;
      discountPrice?: number;
      stock: number;
      costPrice?: number;
      lowStockThreshold?: number;
      barcode?: string;
      expiryDate?: string;
    },
  ): Promise<ProductVariant> {
    await this.ensureShopAccess(userId, shopId, 'inventory.product.create');
    const family = await this.families.findOne({ where: { id: dto.productFamilyId, shopId } });
    if (!family) throw new NotFoundException('Mahsulot oilasi topilmadi');

    return this.dataSource.transaction(async (manager) => {
      // Variant starts at stock 0; the opening quantity is added as the first
      // FIFO batch so it carries a real purchase cost.
      const variant = manager.create(ProductVariant, {
        shopId,
        productFamilyId: family.id,
        name: dto.name,
        photos: dto.photos ?? [],
        description: dto.description ?? null,
        unitType: dto.unitType,
        unitSize: dto.unitSize,
        price: dto.price,
        discountPrice: dto.discountPrice ?? null,
        stock: 0,
        lowStockThreshold: dto.lowStockThreshold ?? 5,
        barcode: dto.barcode ?? null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
      });
      const saved = await manager.save(variant);

      // Link/seed the shared catalogue by barcode so the next seller who scans
      // this barcode gets the details auto-filled.
      if (dto.barcode) {
        saved.globalProductId = await this.upsertGlobalProduct(manager, userId, {
          barcode: dto.barcode,
          name: dto.name,
          brand: family.brand,
          unitType: dto.unitType,
          unitSize: dto.unitSize,
          categoryId: family.categoryId,
          photos: dto.photos ?? [],
        });
        await manager.save(saved);
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
      return saved;
    });
  }

  /**
   * Find an existing shared catalogue entry by barcode, or create one. Returns
   * the global product id to stamp onto the variant. Existing entries get their
   * usage count bumped; blank fields are back-filled from this seller's data.
   */
  private async upsertGlobalProduct(
    manager: import('typeorm').EntityManager,
    userId: string,
    data: {
      barcode: string;
      name: string;
      brand: string | null;
      unitType: ProductVariant['unitType'];
      unitSize: number;
      categoryId: string | null;
      photos: string[];
    },
  ): Promise<string> {
    const existing = await manager.findOne(GlobalProduct, { where: { barcode: data.barcode } });
    if (existing) {
      existing.usageCount += 1;
      if (!existing.photos?.length && data.photos.length) existing.photos = data.photos;
      if (!existing.brand && data.brand) existing.brand = data.brand;
      if (!existing.categoryId && data.categoryId) existing.categoryId = data.categoryId;
      await manager.save(existing);
      return existing.id;
    }
    const created = await manager.save(
      manager.create(GlobalProduct, {
        barcode: data.barcode,
        name: data.name,
        brand: data.brand,
        defaultUnitType: data.unitType,
        defaultUnitSize: data.unitSize,
        categoryId: data.categoryId,
        photos: data.photos,
        createdBySellerId: userId,
        usageCount: 1,
      }),
    );
    return created.id;
  }

  /** Public lookup: scan a barcode → shared catalogue entry (or null). */
  async lookupGlobalByBarcode(barcode: string): Promise<GlobalProduct | null> {
    return this.globalProducts.findOne({ where: { barcode: barcode.trim() } });
  }

  async updateVariant(
    userId: string,
    variantId: string,
    dto: {
      name?: string;
      photos?: string[];
      description?: string;
      price?: number;
      discountPrice?: number | null;
      lowStockThreshold?: number;
      isActive?: boolean;
    },
  ): Promise<ProductVariant> {
    const variant = await this.getVariant(variantId);
    // Base edit requires edit_info; price changes require edit_price; toggling
    // isActive (deactivation = a soft delete) is owner-only.
    await this.ensureShopAccess(userId, variant.shopId, 'inventory.product.edit_info');
    if (dto.price !== undefined || dto.discountPrice !== undefined) {
      await this.ensureShopAccess(userId, variant.shopId, 'inventory.product.edit_price');
    }
    if (dto.isActive !== undefined && dto.isActive !== variant.isActive) {
      await this.ensureShopOwner(userId, variant.shopId);
    }
    Object.assign(variant, dto);
    return this.variants.save(variant);
  }

  async deleteVariant(userId: string, variantId: string): Promise<void> {
    const variant = await this.getVariant(variantId);
    // Deleting a product is owner-only (per spec).
    await this.ensureShopOwner(userId, variant.shopId);
    variant.isActive = false;
    await this.variants.save(variant);
  }

  /**
   * Quick manual correction (the ±1 buttons). A positive delta adds a small lot
   * at the variant's most recent cost; a negative delta drains FIFO batches as
   * an adjustment/write-off. For proper receiving with a cost, use receiveStock.
   */
  async adjustStock(
    userId: string,
    variantId: string,
    delta: number,
    reason?: string,
  ): Promise<ProductVariant> {
    const variant = await this.getVariant(variantId);
    await this.ensureShopAccess(userId, variant.shopId, 'inventory.product.edit_stock');
    if (delta === 0) return variant;
    if (variant.stock + delta < 0) throw new BadRequestException('Qoldiq manfiy bo\'la olmaydi');

    return this.dataSource.transaction(async (manager) => {
      if (delta > 0) {
        const lastCost = await this.lastCost(variantId);
        await receiveBatch(manager, {
          variant,
          quantity: delta,
          costPrice: lastCost,
          userId,
          reason: reason ?? 'Qo\'lda tuzatish',
        });
      } else {
        await consumeFifo(manager, {
          variant,
          quantity: -delta,
          type: MovementType.Adjusted,
          userId,
          reason: reason ?? 'Qo\'lda tuzatish',
        });
      }
      return manager.findOneOrFail(ProductVariant, { where: { id: variantId } });
    });
  }

  /**
   * Formal stock receipt ("Kirim"): adds a new FIFO batch with its own purchase
   * cost, optional expiry date and supplier note.
   */
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
  ): Promise<ProductVariant> {
    const variant = await this.getVariant(variantId);
    await this.ensureShopAccess(userId, variant.shopId, 'inventory.product.edit_stock');
    return this.dataSource.transaction(async (manager) => {
      await receiveBatch(manager, {
        variant,
        quantity: dto.quantity,
        costPrice: dto.costPrice,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        supplierName: dto.supplierName ?? null,
        note: dto.note ?? null,
        userId,
        reason: dto.supplierName ? `Kirim — ${dto.supplierName}` : 'Kirim',
      });
      return manager.findOneOrFail(ProductVariant, { where: { id: variantId } });
    });
  }

  /**
   * Inventarizatsiya: set the on-hand stock to a physically counted number.
   * The difference is reconciled through FIFO (surplus → batch at last cost,
   * shortage → drain oldest batches) and logged as an adjustment.
   */
  async countStock(userId: string, variantId: string, actualQty: number): Promise<ProductVariant> {
    const variant = await this.getVariant(variantId);
    await this.ensureShopAccess(userId, variant.shopId, 'inventory.receive');
    const delta = actualQty - variant.stock;
    if (delta === 0) return variant;
    return this.dataSource.transaction(async (manager) => {
      if (delta > 0) {
        await receiveBatch(manager, {
          variant,
          quantity: delta,
          costPrice: await this.lastCost(variantId),
          userId,
          reason: 'Inventarizatsiya (ortiqcha)',
        });
      } else {
        await consumeFifo(manager, {
          variant,
          quantity: -delta,
          type: MovementType.Adjusted,
          userId,
          reason: 'Inventarizatsiya (kamomad)',
        });
      }
      return manager.findOneOrFail(ProductVariant, { where: { id: variantId } });
    });
  }

  /** Cost of the most recently received batch, used as a default for +corrections. */
  private async lastCost(variantId: string): Promise<number> {
    const last = await this.batches.findOne({
      where: { productVariantId: variantId },
      order: { receivedAt: 'DESC' },
    });
    return last?.costPrice ?? 0;
  }

  /** Remaining FIFO batches for a variant (newest first), for the seller view. */
  async listBatches(userId: string, variantId: string): Promise<StockBatch[]> {
    const v = await this.getVariant(variantId);
    await this.ensureShopAccess(userId, v.shopId, 'inventory.view');
    return this.batches.find({
      where: { productVariantId: variantId },
      order: { receivedAt: 'DESC' },
      take: 100,
    });
  }

  /** Compute per-variant FIFO cost summaries for a set of variants. */
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

    // Oldest remaining batch per variant gives the "next unit" cost (FIFO head).
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

  /**
   * Seller inventory list enriched with FIFO cost summaries. Supports search
   * (name / family name / exact barcode), a low-stock filter and pagination so
   * shops with hundreds of products stay fast. Pagination kicks in only when a
   * `limit` is supplied; without it the full list is returned (back-compat for
   * the debt / POS product pickers).
   */
  async listVariantsWithCost(
    userId: string,
    shopId: string,
    opts: { search?: string; limit?: number; offset?: number; lowOnly?: boolean } = {},
  ): Promise<VariantWithCost[]> {
    await this.ensureShopAccess(userId, shopId, 'inventory.view');
    const qb = this.variants
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.productFamily', 'pf')
      .where('v.shopId = :shopId', { shopId })
      .andWhere('v.isActive = true');

    const search = opts.search?.trim();
    if (search) {
      qb.andWhere('(v.name ILIKE :q OR pf.name ILIKE :q OR v.barcode = :raw)', {
        q: `%${search}%`,
        raw: search,
      });
    }
    if (opts.lowOnly) qb.andWhere('v.stock <= v.lowStockThreshold');

    qb.orderBy('v.createdAt', 'DESC');
    if (opts.limit !== undefined) {
      qb.skip(Math.max(opts.offset ?? 0, 0)).take(Math.min(Math.max(opts.limit, 1), 100));
    }

    const variants = await qb.getMany();
    const costs = await this.costSummaries(variants.map((v) => v.id));
    return variants.map((v) =>
      Object.assign(v, { cost: costs.get(v.id) ?? { avgCost: 0, nextCost: 0, stockValue: 0 } }),
    );
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

  async listLowStock(userId: string, shopId: string): Promise<ProductVariant[]> {
    await this.ensureShopAccess(userId, shopId, 'inventory.view');
    return this.variants
      .createQueryBuilder('v')
      .where('v.shopId = :shopId', { shopId })
      .andWhere('v.isActive = true')
      .andWhere('v.stock <= v.lowStockThreshold')
      .orderBy('v.stock', 'ASC')
      .getMany();
  }

  // Public catalog
  listShopCatalog(shopId: string, search?: string, categoryId?: string): Promise<ProductVariant[]> {
    const where: Record<string, unknown> = { shopId, isActive: true };
    if (search) where.name = ILike(`%${search}%`);
    return this.variants.find({
      where,
      relations: { productFamily: true },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  searchVariantsInShops(shopIds: string[], query: string): Promise<ProductVariant[]> {
    if (shopIds.length === 0) return Promise.resolve([]);
    return this.variants
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.productFamily', 'pf')
      .where('v.shopId IN (:...shopIds)', { shopIds })
      .andWhere('v.isActive = true')
      .andWhere('v.stock > 0')
      .andWhere('v.name ILIKE :q OR pf.name ILIKE :q', { q: `%${query}%` })
      .orderBy('v.ratingAverage', 'DESC')
      .take(100)
      .getMany();
  }

  getVariantsFromFamily(
    shopId: string,
    familyId: string,
  ): Promise<ProductVariant[]> {
    return this.variants.find({
      where: { shopId, productFamilyId: familyId, isActive: true },
      order: { unitSize: 'ASC', price: 'ASC' },
    });
  }

  /**
   * Single-variant detail for the customer product page: the variant itself,
   * a shop summary (for add-to-cart + open state) and its sibling variants in
   * the same product family (e.g. 0.5L / 1L / 1.5L).
   */
  async getVariantDetail(variantId: string) {
    const variant = await this.variants.findOne({
      where: { id: variantId, isActive: true },
      relations: { productFamily: true },
    });
    if (!variant) throw new NotFoundException('Mahsulot topilmadi');

    const [siblings, shop] = await Promise.all([
      this.variants.find({
        where: {
          shopId: variant.shopId,
          productFamilyId: variant.productFamilyId,
          isActive: true,
        },
        order: { unitSize: 'ASC', price: 'ASC' },
      }),
      this.shops.findOne({ where: { id: variant.shopId } }),
    ]);

    return {
      ...variant,
      shop: shop
        ? {
            id: shop.id,
            name: shop.name,
            // Schedule-aware open state (keeps the existing field name).
            isOpenManual: isShopOpenNow(shop),
            minOrderPrice: shop.minOrderPrice,
            photos: shop.photos,
          }
        : null,
      siblings,
    };
  }

  /** Seller-facing: all reviews across the shop's products, newest first. */
  async listShopReviews(userId: string, shopId: string) {
    await this.ensureShopAccess(userId, shopId, 'reviews.view');
    const variants = await this.variants.find({ where: { shopId }, select: { id: true, name: true } });
    if (variants.length === 0) return [];
    const nameMap = new Map(variants.map((v) => [v.id, v.name]));
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

  /** Public, anonymised review list for a variant (only reviewer name + stars + text). */
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

  /**
   * Global product feed for the customer Home tab.
   *
   * Algorithm:
   *  1. Find all shops whose delivery zone covers the user's coordinates.
   *  2. Pull every active in-stock variant from those shops, paginated.
   *  3. Optionally filter by category or search query.
   *  4. Decorate each variant with `shop` info (distance + delivery fee at user).
   *
   * Returned products are sorted by an availability score: in-stock items from
   * closer shops with higher ratings come first.
   */
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

    // Step 1: shops within delivery zone of this user. Closed shops (manual
    // switch OR weekly schedule/holiday) are excluded — their products must not
    // surface in the feed/search.
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
      .filter(({ shop, distanceKm }) => distanceKm <= shop.deliveryZone.maxKm);

    if (reachableShops.length === 0) {
      return { items: [], nextPage: null };
    }

    const shopIds = reachableShops.map((s) => s.shop.id);
    const shopMap = new Map(reachableShops.map((s) => [s.shop.id, s]));

    // Step 2: query variants
    const qb = this.variants
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.productFamily', 'pf')
      .where('v.shopId IN (:...shopIds)', { shopIds })
      .andWhere('v.isActive = true')
      .andWhere('v.stock > 0');

    if (opts.q) {
      qb.andWhere('(v.name ILIKE :q OR pf.name ILIKE :q OR pf.brand ILIKE :q)', { q: `%${opts.q}%` });
    }
    let categoryIds: string[] = [];
    if (opts.categoryIds?.length) categoryIds = opts.categoryIds;
    else if (opts.categoryId) categoryIds = [opts.categoryId];
    if (categoryIds.length > 0) {
      qb.andWhere('pf.categoryId IN (:...categoryIds)', { categoryIds });
    }
    if (opts.onlyDiscounted) {
      qb.andWhere('v.discountPrice IS NOT NULL AND v.discountPrice < v.price');
    }
    // Price-range filters apply to the EFFECTIVE price (discounted when present).
    if (opts.minPrice !== undefined) {
      qb.andWhere('COALESCE(v.discountPrice, v.price) >= :minPrice', { minPrice: opts.minPrice });
    }
    if (opts.maxPrice !== undefined) {
      qb.andWhere('COALESCE(v.discountPrice, v.price) <= :maxPrice', { maxPrice: opts.maxPrice });
    }

    // Sort spec: comma-separated ordered tokens. The first applied token is the
    // primary order, the rest are tiebreakers — so "price_asc,rating" means
    // cheapest first, ties broken by higher rating.
    const tokens = (opts.sort ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    let applied = false;
    const order = (col: string, dir: 'ASC' | 'DESC') => {
      if (applied) qb.addOrderBy(col, dir);
      else {
        qb.orderBy(col, dir);
        applied = true;
      }
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
    const variants = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    // Step 3: decorate with shop info
    const items: FeedProduct[] = variants.map((v) => {
      const ref = shopMap.get(v.shopId);
      const distanceKm = ref?.distanceKm ?? 0;
      const shop = ref?.shop;
      const deliveryFeeAtUser = shop
        ? calcDeliveryFee({
            distanceKm,
            freeKm: shop.deliveryZone.freeKm,
            pricingType: shop.deliveryZone.pricingType,
            pricePerStep: shop.deliveryZone.pricePerStep,
          })
        : 0;
      const decorated = Object.assign({}, v, {
        shop: {
          id: shop?.id ?? v.shopId,
          name: shop?.name ?? '',
          distanceKm,
          deliveryFeeAtUser,
          isOpen: shop ? isShopOpenNow(shop) : false,
          photos: shop?.photos ?? [],
        },
      });
      return decorated;
    });

    const nextPage = page * limit < total ? page + 1 : null;
    return { items, nextPage };
  }
}
