import { Injectable, Logger, NotFoundException } from '@nestjs/common';

/**
 * tasnif.soliq.uz — Soliq qo'mitasining ochiq MXIK katalogi API'si.
 *
 * Tekshirilgan endpoint (2026-08):
 *   GET https://tasnif.soliq.uz/api/cls-api/mxik/search/by-params?text=<so'z yoki barcode>&size=&page=
 * `text` ga xalqaro barcode (GTIN) berilsa ham aniq mahsulotni topadi
 * (javobdagi internationalCode maydoni barcode bilan mos keladi).
 *
 * Natijalar 24 soat xotirada keshlanadi — katalog sekin o'zgaradi, ortiqcha
 * so'rov bilan davlat API'sini bezovta qilmaymiz.
 */
export interface TasnifEntry {
  mxikCode: string;
  name: string;
  groupName: string | null;
  className: string | null;
  positionName: string | null;
  internationalCode: string | null;
  unitCode: string | null;
}

const TASNIF_BASE = 'https://tasnif.soliq.uz/api/cls-api';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface TasnifRawItem {
  mxikCode: string;
  mxikName: string | null;
  subPositionName: string | null;
  groupName: string | null;
  className: string | null;
  positionName: string | null;
  internationalCode: string | null;
  unitCode: string | null;
}

@Injectable()
export class TasnifService {
  private readonly logger = new Logger(TasnifService.name);
  private readonly cache = new Map<
    string,
    { at: number; entries: TasnifEntry[] }
  >();

  async search(text: string, size = 10): Promise<TasnifEntry[]> {
    const key = `${text.trim().toLowerCase()}:${size}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.entries;

    const url = `${TASNIF_BASE}/mxik/search/by-params?text=${encodeURIComponent(text.trim())}&size=${size}&page=0`;
    let entries: TasnifEntry[] = [];
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`tasnif HTTP ${res.status}`);
      const body = (await res.json()) as {
        data?: { content?: TasnifRawItem[] };
      };
      entries = (body.data?.content ?? []).map((x) => ({
        mxikCode: x.mxikCode,
        name: x.mxikName ?? x.subPositionName ?? '',
        groupName: x.groupName ?? null,
        className: x.className ?? null,
        positionName: x.positionName ?? null,
        internationalCode: x.internationalCode ?? null,
        unitCode: x.unitCode ?? null,
      }));
    } catch (err) {
      this.logger.warn(
        `tasnif search "${text}" xato: ${(err as Error).message}`,
      );
      throw new NotFoundException(
        "tasnif.soliq.uz javob bermadi — birozdan so'ng qayta urinib ko'ring",
      );
    }
    this.cache.set(key, { at: Date.now(), entries });
    return entries;
  }

  /**
   * Mahsulot uchun MXIK takliflari: avval barcode bo'yicha (aniq moslik),
   * topilmasa nomi bo'yicha qidiradi.
   */
  async suggestForProduct(opts: {
    barcode: string | null;
    name: string;
  }): Promise<{
    matchedBy: 'barcode' | 'name';
    entries: TasnifEntry[];
  }> {
    if (opts.barcode) {
      const byBarcode = await this.search(opts.barcode, 5).catch(
        () => [] as TasnifEntry[],
      );
      // Barcode bo'yicha faqat haqiqiy moslikni qabul qilamiz — tasnif topilmasa
      // ommabop tovarlar ro'yxatini qaytaradi, u taklif emas.
      const exact = byBarcode.filter(
        (e) => e.internationalCode === opts.barcode,
      );
      if (exact.length) return { matchedBy: 'barcode', entries: exact };
    }
    const byName = await this.search(opts.name, 8);
    return { matchedBy: 'name', entries: byName };
  }
}
