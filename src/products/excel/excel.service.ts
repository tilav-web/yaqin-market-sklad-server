import { createHash } from 'crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { Workbook } from 'exceljs';

import { Category } from '../../categories/entities/category.entity';
import { Order, OrderStatus } from '../../orders/entities/order.entity';
import { RedisService } from '../../redis/redis.service';
import { Shop } from '../../shops/entities/shop.entity';
import { ShopStaff, StaffPermission } from '../../shops/entities/shop-staff.entity';
import { assertShopPermission } from '../../shops/shop-access.util';
import { GlobalProduct, UnitType } from '../entities/global-product.entity';
import { InventoryMovement, MovementType } from '../entities/inventory-movement.entity';
import { ProductVariant } from '../entities/product-variant.entity';
import { ProductsService } from '../products.service';
import type { ImportRowDto } from './dto/excel.dto';

/** How long a confirmImport result is cached under its content fingerprint (see confirmImport). */
const IMPORT_IDEMPOTENCY_TTL_SEC = 5 * 60;

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const STATUS_LABEL: Record<OrderStatus, string> = {
  [OrderStatus.New]: 'Yangi',
  [OrderStatus.Accepted]: 'Qabul qilindi',
  [OrderStatus.Preparing]: "Yig'ilmoqda",
  [OrderStatus.Delivering]: 'Yetkazib berilmoqda',
  [OrderStatus.Delivered]: 'Yetkazildi',
  [OrderStatus.Cancelled]: 'Bekor qilindi',
  [OrderStatus.SellerNoResponse]: "Do'kon javob bermadi",
  [OrderStatus.SellerRejected]: "Do'kon rad etdi",
};

const MOVEMENT_LABEL: Record<MovementType, string> = {
  [MovementType.In]: 'Kirim',
  [MovementType.Sold]: 'Sotuv',
  [MovementType.Returned]: 'Qaytarish',
  [MovementType.Expired]: 'Brak (muddati o\'tgan)',
  [MovementType.Adjusted]: "Qo'lda tuzatish",
  [MovementType.Damaged]: 'Brak (shikastlangan/boshqa)',
  [MovementType.PriceChanged]: 'Narx o\'zgartirildi',
};

const UNIT_LABEL_TO_TYPE: Record<string, UnitType> = {
  dona: 'piece',
  piece: 'piece',
  kg: 'kg',
  kilogramm: 'kg',
  litr: 'liter',
  liter: 'liter',
  gram: 'gram',
  pack: 'pack',
  qop: 'pack',
  paket: 'pack',
};

export interface ImportError {
  row: number;
  message: string;
}

export interface ImportPreviewRow {
  rowNumber: number;
  name: string;
  barcode?: string;
  categoryId?: string;
  price: number;
  discountPrice?: number;
  stock: number;
  unitType?: UnitType;
  unitSize?: number;
  lowStockThreshold?: number;
  criticalThreshold?: number;
  expiryDate?: string;
  globalProductId?: string;
  warnings: string[];
}

export interface ImportPreviewResult {
  willCreate: number;
  errors: ImportError[];
  rows: ImportPreviewRow[];
}

/**
 * Excel import/export for sklad (SPEC.md §25). Reuses ProductsService's
 * existing creation paths (createFromGlobal / createCustomProduct) for the
 * import-confirm step so stock crediting, FIFO batch creation, and
 * GlobalProduct usageCount bookkeeping stay in one place.
 */
@Injectable()
export class ExcelService {
  constructor(
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
    @InjectRepository(GlobalProduct)
    private readonly globalProducts: Repository<GlobalProduct>,
    @InjectRepository(InventoryMovement)
    private readonly movements: Repository<InventoryMovement>,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(ShopStaff)
    private readonly staff: Repository<ShopStaff>,
    private readonly products: ProductsService,
    private readonly redis: RedisService,
  ) {}

  private ensureAccess(userId: string, shopId: string, permission: StaffPermission) {
    return assertShopPermission(this.shops, this.staff, userId, shopId, permission);
  }

  // ─── Export ─────────────────────────────────────────────────────────────

  async exportInventory(
    userId: string,
    shopId: string,
    filters: { categoryId?: string; stockStatus?: 'low' | 'ok' | 'zero' },
  ): Promise<Buffer> {
    await this.ensureAccess(userId, shopId, 'inventory.view');

    const qb = this.variants
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.globalProduct', 'gp')
      .where('v.shopId = :shopId', { shopId })
      .andWhere('v.isActive = true');
    if (filters.categoryId) qb.andWhere('gp.categoryId = :categoryId', { categoryId: filters.categoryId });
    if (filters.stockStatus === 'zero') qb.andWhere('v.stock = 0');
    else if (filters.stockStatus === 'low') qb.andWhere('v.stock > 0 AND v.stock <= v."lowStockThreshold"');
    else if (filters.stockStatus === 'ok') qb.andWhere('v.stock > v."lowStockThreshold"');
    const rows = await qb.orderBy('gp.name', 'ASC').getMany();

    const categoryIds = [...new Set(rows.map((v) => v.globalProduct?.categoryId).filter((v): v is string => !!v))];
    const categories = categoryIds.length ? await this.categories.findBy({ id: In(categoryIds) }) : [];
    const categoryName = new Map(categories.map((c) => [c.id, c.nameUzLatn]));

    const wb = new Workbook();
    const ws = wb.addWorksheet('Sklad holati');
    ws.columns = [
      { header: 'Nomi', key: 'name', width: 32 },
      { header: 'Barcode', key: 'barcode', width: 18 },
      { header: 'Narx', key: 'price', width: 12 },
      { header: 'Chegirma narxi', key: 'discountPrice', width: 14 },
      { header: 'Qoldiq', key: 'stock', width: 10 },
      { header: 'Kategoriya', key: 'category', width: 22 },
      { header: 'Oxirgi yangilanish', key: 'updatedAt', width: 20 },
    ];
    for (const v of rows) {
      ws.addRow({
        name: v.globalProduct?.name ?? '',
        barcode: v.globalProduct?.barcode ?? '',
        price: v.price,
        discountPrice: v.discountPrice ?? '',
        stock: v.stock,
        category: v.globalProduct?.categoryId ? (categoryName.get(v.globalProduct.categoryId) ?? '') : '',
        updatedAt: formatDateTime(v.updatedAt),
      });
    }
    ws.getRow(1).font = { bold: true };
    return toBuffer(wb);
  }

  async exportOrders(userId: string, shopId: string, from: string, to: string): Promise<Buffer> {
    await this.ensureAccess(userId, shopId, 'orders.view_all');
    const { fromDate, toDate } = parseRange(from, to);

    const orders = await this.orders.find({
      where: { shopId, createdAt: Between(fromDate, toDate) },
      relations: { items: true, user: true },
      order: { createdAt: 'ASC' },
    });

    const wb = new Workbook();
    const ws = wb.addWorksheet('Buyurtmalar');
    ws.columns = [
      { header: 'Sana', key: 'date', width: 20 },
      { header: 'Buyurtma raqami', key: 'orderNumber', width: 18 },
      { header: 'Mahsulotlar', key: 'items', width: 50 },
      { header: 'Summa', key: 'total', width: 14 },
      { header: 'Status', key: 'status', width: 18 },
      { header: 'Mijoz', key: 'customer', width: 24 },
    ];
    for (const o of orders) {
      ws.addRow({
        date: formatDateTime(o.createdAt),
        orderNumber: o.orderNumber,
        items: o.items.map((i) => `${i.productName} x${i.quantity}`).join(', '),
        total: o.total,
        status: STATUS_LABEL[o.status] ?? o.status,
        customer: o.user?.name ?? 'Mehmon',
      });
    }
    ws.getRow(1).font = { bold: true };
    return toBuffer(wb);
  }

  async exportMovements(userId: string, shopId: string, from: string, to: string): Promise<Buffer> {
    await this.ensureAccess(userId, shopId, 'inventory.movement.view');
    const { fromDate, toDate } = parseRange(from, to);

    const rows = await this.movements
      .createQueryBuilder('m')
      .innerJoinAndSelect('m.productVariant', 'v')
      .innerJoinAndSelect('v.globalProduct', 'gp')
      .where('v.shopId = :shopId', { shopId })
      .andWhere('m.createdAt BETWEEN :from AND :to', { from: fromDate, to: toDate })
      .orderBy('m.createdAt', 'ASC')
      .getMany();

    const wb = new Workbook();
    const ws = wb.addWorksheet('Kirim-chiqim tarixi');
    ws.columns = [
      { header: 'Sana', key: 'date', width: 20 },
      { header: 'Mahsulot', key: 'name', width: 32 },
      { header: 'Turi', key: 'type', width: 16 },
      { header: 'Miqdor', key: 'quantity', width: 10 },
      { header: 'Oldingi qoldiq', key: 'before', width: 14 },
      { header: 'Keyingi qoldiq', key: 'after', width: 14 },
      { header: 'Oldingi narx', key: 'beforePrice', width: 14 },
      { header: 'Keyingi narx', key: 'afterPrice', width: 14 },
      { header: 'Sabab', key: 'reason', width: 30 },
    ];
    for (const m of rows) {
      // PriceChanged rows don't move stock — quantity/before/after there are
      // just placeholders (0, same value), so blank them out rather than
      // showing a misleading "0 units, stock unchanged" for a price edit.
      const isPriceChange = m.type === MovementType.PriceChanged;
      ws.addRow({
        date: formatDateTime(m.createdAt),
        name: m.productVariant?.globalProduct?.name ?? '',
        type: MOVEMENT_LABEL[m.type] ?? m.type,
        quantity: isPriceChange ? '' : m.quantity,
        before: isPriceChange ? '' : m.beforeStock,
        after: isPriceChange ? '' : m.afterStock,
        beforePrice: m.beforePrice ?? '',
        afterPrice: m.afterPrice ?? '',
        reason: m.reason ?? '',
      });
    }
    ws.getRow(1).font = { bold: true };
    return toBuffer(wb);
  }

  /** Empty `.xlsx` with the exact import column headers (SPEC.md §25.1). */
  async downloadTemplate(): Promise<Buffer> {
    const wb = new Workbook();
    const ws = wb.addWorksheet('Shablon');
    ws.columns = [
      { header: 'nom', key: 'nom', width: 28 },
      { header: 'barcode', key: 'barcode', width: 18 },
      { header: 'kategoriya_kodi', key: 'kategoriya_kodi', width: 18 },
      { header: 'narx', key: 'narx', width: 12 },
      { header: 'chegirma_narxi', key: 'chegirma_narxi', width: 14 },
      { header: 'qoldiq', key: 'qoldiq', width: 10 },
      { header: 'olchov_birligi', key: 'olchov_birligi', width: 14 },
      { header: 'olchov_hajmi', key: 'olchov_hajmi', width: 14 },
      { header: 'ogohlantirish_chegarasi', key: 'ogohlantirish_chegarasi', width: 22 },
      { header: 'kritik_chegara', key: 'kritik_chegara', width: 16 },
      { header: 'yaroqlilik_muddati', key: 'yaroqlilik_muddati', width: 18 },
    ];
    ws.getRow(1).font = { bold: true };
    return toBuffer(wb);
  }

  // ─── Import ─────────────────────────────────────────────────────────────

  private static readonly REQUIRED_COLUMNS = ['nom', 'narx', 'qoldiq'];

  async previewImport(userId: string, shopId: string, buffer: Buffer): Promise<ImportPreviewResult> {
    await this.ensureAccess(userId, shopId, 'inventory.product.create');

    const wb = new Workbook();
    try {
      // exceljs's bundled typings declare their own minimal ambient `Buffer`
      // (built against @types/node ^14), which structurally conflicts with
      // the real Node Buffer type from this project's newer @types/node —
      // a known exceljs/typings incompatibility. Cast at this one boundary.
      await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    } catch {
      throw new BadRequestException('Excel fayl o\'qib bo\'lmadi — .xlsx formatida ekanini tekshiring');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Excel faylda varaq topilmadi');

    const headerIndex = new Map<string, number>();
    ws.getRow(1).eachCell((cell, colNumber) => {
      const key = String(cell.value ?? '').trim();
      if (key) headerIndex.set(key, colNumber);
    });
    for (const col of ExcelService.REQUIRED_COLUMNS) {
      if (!headerIndex.has(col)) {
        throw new BadRequestException(`Majburiy ustun topilmadi: "${col}"`);
      }
    }
    const cell = (rowNumber: number, col: string): unknown => {
      const idx = headerIndex.get(col);
      if (!idx) return undefined;
      const raw = ws.getRow(rowNumber).getCell(idx).value;
      // exceljs may hand back {text} for rich text or {result} for formulas.
      if (raw && typeof raw === 'object') {
        if ('text' in raw) return (raw as { text: unknown }).text;
        if ('result' in raw) return (raw as { result: unknown }).result;
      }
      return raw;
    };

    // Preload lookup tables once instead of per-row queries.
    const categories = await this.categories.find({ select: { id: true, slug: true } });
    const categoryBySlug = new Map(categories.map((c) => [c.slug, c.id]));

    const errors: ImportError[] = [];
    const rows: ImportPreviewRow[] = [];
    const lastRow = ws.rowCount;

    for (let r = 2; r <= lastRow; r++) {
      const nameRaw = cell(r, 'nom');
      const priceRaw = cell(r, 'narx');
      const stockRaw = cell(r, 'qoldiq');
      // Skip fully blank trailing rows.
      if (isBlank(nameRaw) && isBlank(priceRaw) && isBlank(stockRaw)) continue;

      const name = String(nameRaw ?? '').trim();
      let hasError = false;
      if (!name) {
        errors.push({ row: r, message: '"nom" majburiy' });
        hasError = true;
      }

      const price = Number(priceRaw);
      if (isBlank(priceRaw) || !Number.isFinite(price) || price < 0) {
        errors.push({ row: r, message: '"narx" 0 yoki musbat son bo\'lishi kerak' });
        hasError = true;
      }

      const stock = Number(stockRaw);
      if (isBlank(stockRaw) || !Number.isFinite(stock) || stock < 0) {
        errors.push({ row: r, message: '"qoldiq" manfiy bo\'lmagan son bo\'lishi kerak' });
        hasError = true;
      }

      const warnings: string[] = [];

      const discountRaw = cell(r, 'chegirma_narxi');
      let discountPrice: number | undefined;
      if (!isBlank(discountRaw)) {
        discountPrice = Number(discountRaw);
        if (!Number.isFinite(discountPrice) || discountPrice < 0) {
          errors.push({ row: r, message: '"chegirma_narxi" son bo\'lishi kerak' });
          hasError = true;
        }
      }

      const unitRaw = cell(r, 'olchov_birligi');
      let unitType: UnitType | undefined;
      if (!isBlank(unitRaw)) {
        const key = String(unitRaw).trim().toLowerCase();
        unitType = UNIT_LABEL_TO_TYPE[key];
        if (!unitType) {
          warnings.push(`Noma'lum o'lchov birligi "${String(unitRaw)}" — "dona" qo'llanildi`);
          unitType = 'piece';
        }
      }

      const unitSizeRaw = cell(r, 'olchov_hajmi');
      const unitSize = !isBlank(unitSizeRaw) ? Number(unitSizeRaw) : undefined;

      const warnThresholdRaw = cell(r, 'ogohlantirish_chegarasi');
      const lowStockThreshold = !isBlank(warnThresholdRaw) ? Number(warnThresholdRaw) : undefined;

      const critThresholdRaw = cell(r, 'kritik_chegara');
      const criticalThreshold = !isBlank(critThresholdRaw) ? Number(critThresholdRaw) : undefined;

      const expiryRaw = cell(r, 'yaroqlilik_muddati');
      const expiryDate = !isBlank(expiryRaw) ? normalizeDate(expiryRaw) : undefined;

      const barcodeRaw = cell(r, 'barcode');
      const barcode = !isBlank(barcodeRaw) ? String(barcodeRaw).trim() : undefined;
      let globalProductId: string | undefined;
      if (barcode) {
        const existing = await this.globalProducts.findOne({ where: { barcode } });
        if (existing) globalProductId = existing.id;
      }

      const categoryCodeRaw = cell(r, 'kategoriya_kodi');
      let categoryId: string | undefined;
      if (!isBlank(categoryCodeRaw)) {
        const code = String(categoryCodeRaw).trim();
        categoryId = categoryBySlug.get(code);
        if (!categoryId) {
          // Invalid category code is a WARNING, not a hard stop (SPEC.md §25.1).
          warnings.push(`Kategoriya kodi topilmadi: "${code}"`);
        }
      }

      if (hasError) continue;

      rows.push({
        rowNumber: r,
        name,
        barcode,
        categoryId,
        price,
        discountPrice,
        stock,
        unitType,
        unitSize,
        lowStockThreshold,
        criticalThreshold,
        expiryDate,
        globalProductId,
        warnings,
      });
    }

    return { willCreate: rows.length, errors, rows };
  }

  async confirmImport(
    userId: string,
    shopId: string,
    rows: ImportRowDto[],
  ): Promise<{ created: number; failed: ImportError[] }> {
    await this.ensureAccess(userId, shopId, 'inventory.product.create');

    // A barcoded row is already protected from a lost-response retry
    // re-creating it (the DB's unique (shopId, globalProductId) constraint
    // rejects the second attempt — caught below into `failed`). A
    // barcode-less row has no such constraint — re-submitting the exact
    // same batch (network retry, accidental double-tap on "Tasdiqlash")
    // would silently create every one of them twice. Cache the result under
    // a fingerprint of the exact row content so a retry within a few
    // minutes replays the same outcome instead of re-importing.
    const fingerprint = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    const idempotencyKey = `excel-import:${shopId}:${fingerprint}`;
    const cached = await this.redis.client.get(idempotencyKey);
    if (cached) return JSON.parse(cached) as { created: number; failed: ImportError[] };

    let created = 0;
    const failed: ImportError[] = [];
    for (const row of rows) {
      try {
        if (row.globalProductId) {
          await this.products.createFromGlobal(userId, shopId, {
            globalProductId: row.globalProductId,
            price: row.price,
            stock: row.stock,
            discountPrice: row.discountPrice,
            expiryDate: row.expiryDate,
            lowStockThreshold: row.lowStockThreshold,
            criticalThreshold: row.criticalThreshold,
          });
        } else {
          await this.products.createCustomProduct(userId, shopId, {
            name: row.name,
            barcode: row.barcode,
            categoryId: row.categoryId,
            unitType: row.unitType,
            unitSize: row.unitSize,
            price: row.price,
            discountPrice: row.discountPrice,
            stock: row.stock,
            lowStockThreshold: row.lowStockThreshold,
            criticalThreshold: row.criticalThreshold,
            expiryDate: row.expiryDate,
          });
        }
        created++;
      } catch (e) {
        failed.push({ row: row.rowNumber, message: e instanceof Error ? e.message : 'Xatolik yuz berdi' });
      }
    }
    const result = { created, failed };
    await this.redis.client.setex(idempotencyKey, IMPORT_IDEMPOTENCY_TTL_SEC, JSON.stringify(result));
    return result;
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || String(v).trim() === '';
}

function formatDateTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function parseRange(from: string, to: string): { fromDate: Date; toDate: Date } {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  // Make `to` inclusive of the whole day when given a bare date (no time part).
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) toDate.setHours(23, 59, 59, 999);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new BadRequestException('Sana oralig\'i noto\'g\'ri');
  }
  return { fromDate, toDate };
}

async function toBuffer(wb: Workbook): Promise<Buffer> {
  // Same exceljs/@types-node Buffer mismatch as load() above — its return
  // type is exceljs's own ambient Buffer shim, not the real Node Buffer.
  const data = await wb.xlsx.writeBuffer();
  return data as unknown as Buffer;
}

export { XLSX_CONTENT_TYPE };
