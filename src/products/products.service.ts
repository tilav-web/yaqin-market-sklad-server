import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';

import { Shop } from '../shops/entities/shop.entity';
import { InventoryMovement, MovementType } from './entities/inventory-movement.entity';
import { ProductFamily } from './entities/product-family.entity';
import { ProductVariant } from './entities/product-variant.entity';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(ProductFamily)
    private readonly families: Repository<ProductFamily>,
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
    @InjectRepository(InventoryMovement)
    private readonly movements: Repository<InventoryMovement>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    private readonly dataSource: DataSource,
  ) {}

  private async ensureShopOwned(userId: string, shopId: string): Promise<Shop> {
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Do\'kon topilmadi');
    if (shop.ownerId !== userId) throw new ForbiddenException();
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
    await this.ensureShopOwned(userId, shopId);
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
      lowStockThreshold?: number;
      barcode?: string;
      expiryDate?: string;
    },
  ): Promise<ProductVariant> {
    await this.ensureShopOwned(userId, shopId);
    const family = await this.families.findOne({ where: { id: dto.productFamilyId, shopId } });
    if (!family) throw new NotFoundException('Mahsulot oilasi topilmadi');

    return this.dataSource.transaction(async (manager) => {
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
        stock: dto.stock,
        lowStockThreshold: dto.lowStockThreshold ?? 5,
        barcode: dto.barcode ?? null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
      });
      const saved = await manager.save(variant);
      if (dto.stock > 0) {
        await manager.save(
          manager.create(InventoryMovement, {
            productVariantId: saved.id,
            type: MovementType.In,
            quantity: dto.stock,
            beforeStock: 0,
            afterStock: dto.stock,
            reason: 'Boshlang\'ich qoldiq',
            performedByUserId: userId,
          }),
        );
      }
      return saved;
    });
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
    await this.ensureShopOwned(userId, variant.shopId);
    Object.assign(variant, dto);
    return this.variants.save(variant);
  }

  async deleteVariant(userId: string, variantId: string): Promise<void> {
    const variant = await this.getVariant(variantId);
    await this.ensureShopOwned(userId, variant.shopId);
    variant.isActive = false;
    await this.variants.save(variant);
  }

  async adjustStock(
    userId: string,
    variantId: string,
    delta: number,
    reason?: string,
  ): Promise<ProductVariant> {
    const variant = await this.getVariant(variantId);
    await this.ensureShopOwned(userId, variant.shopId);
    const newStock = variant.stock + delta;
    if (newStock < 0) throw new BadRequestException('Qoldiq manfiy bo\'la olmaydi');

    return this.dataSource.transaction(async (manager) => {
      const before = variant.stock;
      variant.stock = newStock;
      const saved = await manager.save(variant);
      await manager.save(
        manager.create(InventoryMovement, {
          productVariantId: variant.id,
          type: delta > 0 ? MovementType.In : MovementType.Adjusted,
          quantity: Math.abs(delta),
          beforeStock: before,
          afterStock: newStock,
          reason: reason ?? null,
          performedByUserId: userId,
        }),
      );
      return saved;
    });
  }

  listMovements(userId: string, variantId: string): Promise<InventoryMovement[]> {
    return this.getVariant(variantId).then(async (v) => {
      await this.ensureShopOwned(userId, v.shopId);
      return this.movements.find({
        where: { productVariantId: variantId },
        order: { createdAt: 'DESC' },
        take: 100,
      });
    });
  }

  async listLowStock(userId: string, shopId: string): Promise<ProductVariant[]> {
    await this.ensureShopOwned(userId, shopId);
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
}
