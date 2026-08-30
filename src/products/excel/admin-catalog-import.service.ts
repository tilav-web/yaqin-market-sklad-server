import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workbook } from 'exceljs';

import { Category } from '../../categories/entities/category.entity';
import { GlobalProduct, UnitType } from '../entities/global-product.entity';
import { toLocalizedText } from '../../common/types/localized-text.type';
import type {
  AdminCatalogImportConfirmResult,
  AdminCatalogImportPreviewResult,
  AdminCatalogImportRowDto,
} from './dto/admin-catalog-import.dto';

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

const REQUIRED_COLUMNS = ['nom'];

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || String(v).trim() === '';
}

async function toBuffer(wb: Workbook): Promise<Buffer> {
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

@Injectable()
export class AdminCatalogImportService {
  constructor(
    @InjectRepository(GlobalProduct)
    private readonly globalProducts: Repository<GlobalProduct>,
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
  ) {}

  async downloadTemplate(): Promise<Buffer> {
    const wb = new Workbook();
    const ws = wb.addWorksheet('Shablon');
    ws.columns = [
      { header: 'nom', key: 'nom', width: 32 },
      { header: 'barkod', key: 'barkod', width: 18 },
      { header: 'brend', key: 'brend', width: 20 },
      { header: 'kategoriya_kodi', key: 'kategoriya_kodi', width: 18 },
      { header: 'olchov_birligi', key: 'olchov_birligi', width: 14 },
      { header: 'olchov_hajmi', key: 'olchov_hajmi', width: 14 },
    ];
    ws.getRow(1).font = { bold: true };
    return toBuffer(wb);
  }

  async previewImport(
    buffer: Buffer,
  ): Promise<AdminCatalogImportPreviewResult> {
    const wb = new Workbook();
    try {
      // See excel.service.ts for why this cast is needed — exceljs's bundled
      // typings declare their own minimal ambient Buffer that structurally
      // conflicts with this project's newer @types/node Buffer.
      await wb.xlsx.load(
        buffer as unknown as Parameters<typeof wb.xlsx.load>[0],
      );
    } catch {
      throw new BadRequestException(
        "Excel fayl o'qib bo'lmadi — .xlsx formatida ekanini tekshiring",
      );
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Excel faylda varaq topilmadi');

    const headerIndex = new Map<string, number>();
    ws.getRow(1).eachCell((cell, colNumber) => {
      const key = String(cell.value ?? '').trim();
      if (key) headerIndex.set(key, colNumber);
    });
    for (const col of REQUIRED_COLUMNS) {
      if (!headerIndex.has(col)) {
        throw new BadRequestException(`Majburiy ustun topilmadi: "${col}"`);
      }
    }
    const cell = (rowNumber: number, col: string): unknown => {
      const idx = headerIndex.get(col);
      if (!idx) return undefined;
      const raw = ws.getRow(rowNumber).getCell(idx).value;
      if (raw && typeof raw === 'object') {
        if ('text' in raw) return (raw as { text: unknown }).text;
        if ('result' in raw) return (raw as { result: unknown }).result;
      }
      return raw;
    };

    const categories = await this.categories.find({
      select: { id: true, slug: true },
    });
    const categoryBySlug = new Map(categories.map((c) => [c.slug, c.id]));

    const errors: { row: number; message: string }[] = [];
    const rows: (AdminCatalogImportRowDto & { warnings: string[] })[] = [];
    const seenBarcodes = new Set<string>();
    const lastRow = ws.rowCount;

    for (let r = 2; r <= lastRow; r++) {
      const nameRaw = cell(r, 'nom');
      const barcodeRaw = cell(r, 'barkod');
      if (isBlank(nameRaw) && isBlank(barcodeRaw)) continue; // blank trailing row

      const name = String(nameRaw ?? '').trim();
      let hasError = false;
      if (!name) {
        errors.push({ row: r, message: '"nom" majburiy' });
        hasError = true;
      }

      const warnings: string[] = [];
      const barcode = !isBlank(barcodeRaw)
        ? String(barcodeRaw).trim()
        : undefined;
      if (barcode) {
        if (seenBarcodes.has(barcode)) {
          errors.push({
            row: r,
            message: `Barkod "${barcode}" faylda takrorlangan`,
          });
          hasError = true;
        }
        seenBarcodes.add(barcode);
        const existing = await this.globalProducts.findOne({
          where: { barcode },
        });
        if (existing)
          warnings.push(
            `Bu barkod katalogda allaqachon mavjud — o'tkazib yuboriladi`,
          );
      }

      const brandRaw = cell(r, 'brend');
      const brand = !isBlank(brandRaw) ? String(brandRaw).trim() : undefined;

      const unitRaw = cell(r, 'olchov_birligi');
      let unitType: UnitType | undefined;
      if (!isBlank(unitRaw)) {
        const key = String(unitRaw).trim().toLowerCase();
        unitType = UNIT_LABEL_TO_TYPE[key];
        if (!unitType) {
          warnings.push(
            `Noma'lum o'lchov birligi "${String(unitRaw)}" — "dona" qo'llanildi`,
          );
          unitType = 'piece';
        }
      }

      const unitSizeRaw = cell(r, 'olchov_hajmi');
      const unitSize = !isBlank(unitSizeRaw) ? Number(unitSizeRaw) : undefined;
      if (
        unitSize !== undefined &&
        (!Number.isFinite(unitSize) || unitSize <= 0)
      ) {
        errors.push({
          row: r,
          message: '"olchov_hajmi" musbat son bo\'lishi kerak',
        });
        hasError = true;
      }

      const categoryCodeRaw = cell(r, 'kategoriya_kodi');
      let categoryId: string | undefined;
      if (!isBlank(categoryCodeRaw)) {
        const code = String(categoryCodeRaw).trim();
        categoryId = categoryBySlug.get(code);
        if (!categoryId) warnings.push(`Kategoriya kodi topilmadi: "${code}"`);
      }

      if (hasError) continue;

      rows.push({
        rowNumber: r,
        name,
        barcode,
        brand,
        categoryId,
        unitType,
        unitSize,
        isVerified: true,
        warnings,
      });
    }

    return { willCreate: rows.length, errors, rows };
  }

  async confirmImport(
    rows: AdminCatalogImportRowDto[],
  ): Promise<AdminCatalogImportConfirmResult> {
    let created = 0;
    let skipped = 0;
    const failed: { row: number; message: string }[] = [];

    for (const row of rows) {
      try {
        // Check-before-insert rather than INSERT...ON CONFLICT DO NOTHING:
        // `.insert().orIgnore().execute()`'s `identifiers` array is always
        // populated (with a null entry on conflict) by this TypeORM version,
        // so its length can't distinguish "created" from "skipped". The
        // @UniqueConstraint catch below is a safety net for the race between
        // this check and the insert (another row in the same batch, or a
        // concurrent request, claiming the same barcode first) — that case
        // is also a legitimate "skip", not a failure.
        if (row.barcode) {
          const existing = await this.globalProducts.findOne({
            where: { barcode: row.barcode },
          });
          if (existing) {
            skipped++;
            continue;
          }
        }
        await this.globalProducts.save(
          this.globalProducts.create({
            name: toLocalizedText(row.name),
            barcode: row.barcode ?? null,
            brand: row.brand ?? null,
            categoryId: row.categoryId ?? null,
            unitType: (row.unitType as UnitType) ?? 'piece',
            unitSize: row.unitSize ?? 1,
            isVerified: row.isVerified ?? true,
            isActive: true,
            ownerShopId: null,
          }),
        );
        created++;
      } catch (e: any) {
        if (e?.code === '23505') {
          skipped++;
          continue;
        }
        failed.push({
          row: row.rowNumber,
          message: e instanceof Error ? e.message : "Noma'lum xato",
        });
      }
    }

    return { created, skipped, failed };
  }
}
