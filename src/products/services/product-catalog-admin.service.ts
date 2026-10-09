import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { buildXlsxBuffer } from '../../common/xlsx.util';
import { slugify } from '../../common/utils/slug.util';
import {
  LocalizedInput,
  toLocalizedText,
} from '../../common/types/localized-text.type';
import { Shop } from '../../shops/entities/shop.entity';
import { GlobalProduct, UnitType } from '../entities/global-product.entity';
import { ProductVariant } from '../entities/product-variant.entity';

@Injectable()
export class ProductCatalogAdminService {
  constructor(
    @InjectRepository(GlobalProduct)
    private readonly globalProducts: Repository<GlobalProduct>,
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
  ) {}

  adminGlobalProductsFilterQuery(opts: {
    q?: string;
    activeOnly?: boolean;
    categoryId?: string;
  }): SelectQueryBuilder<GlobalProduct> {
    const qb = this.globalProducts
      .createQueryBuilder('gp')
      .leftJoinAndSelect('gp.category', 'cat')
      .where('gp.ownerShopId IS NULL')
      .orderBy('gp.updatedAt', 'DESC');

    const search = opts.q?.trim();
    if (search) {
      qb.andWhere(
        "(gp.name->>'uz' ILIKE :q OR gp.name->>'ru' ILIKE :q OR gp.brand ILIKE :q OR gp.barcode = :raw)",
        {
          q: `%${search}%`,
          raw: search,
        },
      );
    }
    if (opts.activeOnly) qb.andWhere('gp.isActive = true');
    if (opts.categoryId)
      qb.andWhere('gp.categoryId = :categoryId', {
        categoryId: opts.categoryId,
      });
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

  async adminExportGlobalProducts(opts: {
    q?: string;
    activeOnly?: boolean;
    categoryId?: string;
  }): Promise<Buffer> {
    const rows = await this.adminGlobalProductsFilterQuery(opts)
      .take(5000)
      .getMany();
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
        nameUzLatn: typeof p.name === 'object' ? p.name?.uz : p.name,
        nameUzCyrl: typeof p.name === 'object' ? p.name?.kr : '',
        nameRu: typeof p.name === 'object' ? p.name?.ru : '',
        brand: p.brand ?? '',
        barcode: p.barcode ?? '',
        unit: `${p.unitSize} ${p.unitType}`,
        isVerified: p.isVerified ? 'ha' : "yo'q",
        isActive: p.isActive ? 'ha' : "yo'q",
        usageCount: p.usageCount,
      })),
    );
  }

  async adminGetCatalogStats(): Promise<{
    total: number;
    verified: number;
    active: number;
  }> {
    const base = this.globalProducts
      .createQueryBuilder('gp')
      .where('gp.ownerShopId IS NULL');
    const [total, verified, active] = await Promise.all([
      base.clone().getCount(),
      base.clone().andWhere('gp.isVerified = true').getCount(),
      base.clone().andWhere('gp.isActive = true').getCount(),
    ]);
    return { total, verified, active };
  }

  async ensureUniqueSlug(
    rawNameOrSlug: string,
    excludeId?: string,
  ): Promise<string> {
    let base = slugify(rawNameOrSlug);
    if (!base) base = 'product';
    let candidate = base;
    let counter = 1;

    while (true) {
      const qb = this.globalProducts
        .createQueryBuilder('gp')
        .where('gp.slug = :candidate', { candidate });
      if (excludeId) {
        qb.andWhere('gp.id != :excludeId', { excludeId });
      }
      const existing = await qb.getOne();
      if (!existing) return candidate;
      counter += 1;
      candidate = `${base}-${counter}`;
    }
  }

  async adminCreateGlobalProduct(dto: {
    slug?: string;
    nameI18n?: LocalizedInput;
    descriptionI18n?: LocalizedInput;
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
      const existing = await this.globalProducts.findOne({
        where: { barcode: dto.barcode },
      });
      if (existing)
        throw new BadRequestException('Bu barcode allaqachon katalogda mavjud');
    }
    if (dto.parentGlobalProductId) {
      const parent = await this.globalProducts.findOne({
        where: { id: dto.parentGlobalProductId },
      });
      if (!parent) throw new NotFoundException('Asosiy mahsulot topilmadi');
    }

    const localizedName = toLocalizedText(
      dto.nameI18n || {
        uz: dto.nameUzLatn || dto.name,
        kr: dto.nameUzCyrl,
        ru: dto.nameRu,
      },
    );

    const hasDesc =
      dto.descriptionI18n ||
      dto.descriptionUzLatn ||
      dto.description ||
      dto.descriptionRu;
    const localizedDesc = hasDesc
      ? toLocalizedText(
          dto.descriptionI18n || {
            uz: dto.descriptionUzLatn || dto.description,
            kr: dto.descriptionUzCyrl,
            ru: dto.descriptionRu,
          },
        )
      : null;

    const rawSlug =
      dto.slug || localizedName.uz || localizedName.ru || 'product';
    const slug = await this.ensureUniqueSlug(rawSlug);

    const gp = this.globalProducts.create({
      slug,
      name: localizedName,
      barcode: dto.barcode ?? null,
      brand: dto.brand ?? null,
      categoryId: dto.categoryId ?? null,
      unitType: dto.unitType ?? 'piece',
      unitSize: dto.unitSize ?? 1,
      photos: dto.photos ?? [],
      description: localizedDesc,
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
      slug: string;
      nameI18n: LocalizedInput;
      descriptionI18n: LocalizedInput;
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
      const existing = await this.globalProducts.findOne({
        where: { barcode: dto.barcode },
      });
      if (existing)
        throw new BadRequestException('Bu barcode allaqachon katalogda mavjud');
    }
    if (
      dto.parentGlobalProductId &&
      dto.parentGlobalProductId !== gp.parentGlobalProductId
    ) {
      if (dto.parentGlobalProductId === id) {
        throw new BadRequestException("Mahsulot o'z-o'ziga ota bo'la olmaydi");
      }
      const parent = await this.globalProducts.findOne({
        where: { id: dto.parentGlobalProductId },
      });
      if (!parent) throw new NotFoundException('Asosiy mahsulot topilmadi');
    }

    if (
      dto.nameUzLatn !== undefined ||
      dto.name !== undefined ||
      dto.nameRu !== undefined ||
      dto.nameUzCyrl !== undefined ||
      dto.nameI18n !== undefined
    ) {
      const cur =
        typeof gp.name === 'object' ? gp.name : { uz: gp.name, kr: '', ru: '' };
      gp.name = toLocalizedText(
        dto.nameI18n || {
          uz: dto.nameUzLatn ?? dto.name ?? cur?.uz,
          kr: dto.nameUzCyrl ?? cur?.kr,
          ru: dto.nameRu ?? cur?.ru,
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
      const cur =
        typeof gp.description === 'object'
          ? gp.description
          : { uz: gp.description || '', kr: '', ru: '' };
      const uz = dto.descriptionUzLatn ?? dto.description ?? cur?.uz;
      if (
        dto.descriptionI18n ||
        uz ||
        dto.descriptionRu ||
        dto.descriptionUzCyrl
      ) {
        gp.description = toLocalizedText(
          dto.descriptionI18n || {
            uz,
            kr: dto.descriptionUzCyrl ?? cur?.kr,
            ru: dto.descriptionRu ?? cur?.ru,
          },
        );
      } else {
        gp.description = null;
      }
    }

    if (dto.slug !== undefined && dto.slug.trim()) {
      gp.slug = await this.ensureUniqueSlug(dto.slug, id);
    } else if (!gp.slug) {
      const nameUz = typeof gp.name === 'object' ? gp.name?.uz : gp.name;
      gp.slug = await this.ensureUniqueSlug(nameUz || 'product', id);
    }

    if (dto.barcode !== undefined) gp.barcode = dto.barcode;
    if (dto.brand !== undefined) gp.brand = dto.brand;
    if (dto.categoryId !== undefined) gp.categoryId = dto.categoryId;
    if (dto.unitType !== undefined) gp.unitType = dto.unitType;
    if (dto.unitSize !== undefined) gp.unitSize = dto.unitSize;
    if (dto.photos !== undefined) gp.photos = dto.photos;
    if (dto.parentGlobalProductId !== undefined)
      gp.parentGlobalProductId = dto.parentGlobalProductId;
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

    return rows.map((v) => ({
      variantId: v.id,
      shopId: (v.shop as Shop | undefined)?.id ?? v.shopId,
      shopName: (v.shop as Shop | undefined)?.name ?? '',
      price: v.price,
      discountPrice: v.discountPrice,
      stock: v.stock,
    }));
  }
}
