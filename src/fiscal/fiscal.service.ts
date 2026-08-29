import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';

import { Order, PaymentMethod } from '../orders/entities/order.entity';
import { GlobalProduct } from '../products/entities/global-product.entity';
import { SellerProfile } from '../sellers/entities/seller-profile.entity';
import { SETTING_KEYS } from '../settings/entities/global-setting.entity';
import { SettingsService } from '../settings/settings.service';
import {
  FiscalReceipt,
  FiscalReceiptLine,
  FiscalReceiptStatus,
  FiscalReceiptType,
} from './entities/fiscal-receipt.entity';
import { TaxCategory } from './entities/tax-category.entity';
import { FISCAL_PROVIDER } from './fiscal-provider.interface';
import type { FiscalProvider } from './fiscal-provider.interface';
import { toLocalizedText } from '../common/types/localized-text.type';

/**
 * Fiskal cheklar — komissioner modeli.
 *
 * Har bir pul harakati chek bilan qoplanadi:
 *  - onlayn to'lov muvaffaqiyatli (Click complete)  → sotuv cheki
 *  - naqd buyurtma yetkazildi / do'konda sotildi     → sotuv cheki
 *  - to'lov qaytarildi (reversal) yoki naqd bekor    → qaytarish cheki
 *  - qisman qaytarish (partial return)               → qisman qaytarish cheki
 *
 * Qaytarish cheki asl chekni soliq tizimida bekor qiladi — mijoz chek QR'ini
 * skanerlab cashback olgan bo'lsa ham, soliq tizimi refund chekni ko'rib
 * cashbackni o'zi qaytarib oladi; bizning majburiyat faqat refund chekni
 * o'z vaqtida chiqarish.
 *
 * fiscal_mode: off — cheklar umuman yaratilmaydi; collect — yaratiladi va
 * saqlanadi (OFD hali ulanmagan bosqich uchun: ma'lumot yig'ilib boradi,
 * keyin live'ga o'tilganda pending'lar yuboriladi); live — cron OFDga uzatadi.
 */
@Injectable()
export class FiscalService {
  private readonly logger = new Logger(FiscalService.name);

  constructor(
    @InjectRepository(FiscalReceipt)
    private readonly receipts: Repository<FiscalReceipt>,
    @InjectRepository(TaxCategory)
    private readonly taxCategories: Repository<TaxCategory>,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(SellerProfile)
    private readonly sellerProfiles: Repository<SellerProfile>,
    @InjectRepository(GlobalProduct)
    private readonly globalProducts: Repository<GlobalProduct>,
    private readonly settings: SettingsService,
    @Inject(FISCAL_PROVIDER)
    private readonly provider: FiscalProvider,
  ) {}

  private get mode(): string {
    return this.settings.get(SETTING_KEYS.FISCAL_MODE, 'collect');
  }

  /* ─── Chek yaratish ─── */

  /**
   * Sotuv cheki — to'lov haqiqatda qabul qilingan paytda chaqiriladi.
   * Idempotent: bitta orderga bitta sotuv cheki. Hech qachon throw qilmaydi
   * (to'lov oqimini chek muammosi to'xtatmasligi kerak) — xato log+null.
   */
  async createSaleReceipt(orderId: string): Promise<FiscalReceipt | null> {
    try {
      if (this.mode === 'off') return null;
      const existing = await this.receipts.findOne({
        where: { orderId, type: FiscalReceiptType.Sale },
      });
      if (existing) return existing;

      const order = await this.orders.findOne({
        where: { id: orderId },
        relations: {
          items: { productVariant: { globalProduct: { taxCategory: true } } },
          shop: true,
        },
      });
      if (!order) {
        this.logger.warn(`createSaleReceipt: order ${orderId} topilmadi`);
        return null;
      }

      const profile = await this.sellerProfiles.findOne({
        where: { userId: order.shop.ownerId },
      });

      const vatRate = profile?.vatPayer
        ? this.settings.getNumber(SETTING_KEYS.VAT_RATE_PERCENT, 12)
        : 0;
      const platformStir = this.settings.get(SETTING_KEYS.PLATFORM_STIR);
      const platformLegalName = this.settings.get(SETTING_KEYS.PLATFORM_LEGAL_NAME);
      const missing: string[] = [];
      if (!profile?.stir) missing.push('seller:stir');
      if (profile && profile.komissionerStatus !== 'confirmed')
        missing.push('seller:komissioner');
      if (!platformStir) missing.push('platform:stir');
      if (!platformLegalName) missing.push('platform:legalName');

      const lines: FiscalReceiptLine[] = [];
      for (const item of order.items) {
        // Naqd buyurtmada chek Delivered paytida chiqadi — undan oldin
        // (Delivering bosqichida) qisman qaytarilgan donalar mijozdan pul
        // olinmagan, chekka kirmaydi. Onlaynda chek to'lov paytida chiqadi,
        // u paytda returnedQuantity hali 0 — to'liq summa ketadi (keyingi
        // qaytarishlar alohida refund chek bilan qoplanadi).
        const qty = item.quantity - item.returnedQuantity;
        if (qty <= 0) continue;
        const tax = item.productVariant?.globalProduct?.taxCategory ?? null;
        if (!tax) {
          const gid = item.productVariant?.globalProduct?.id ?? 'unknown';
          missing.push(`product:${gid}:mxik`);
        }
        // Markirovkali tovar: har bir dona uchun skanerlangan Data Matrix kod
        // bo'lishi shart — kod yetishmasa chek incomplete bo'ladi (skanerlash
        // seller mobil ilovasida, marking-codes endpoint orqali keladi).
        const markingRequired = tax?.markingRequired ?? false;
        const markingCodes = (item.markingCodes ?? []).slice(0, qty);
        if (markingRequired && markingCodes.length < qty) {
          missing.push(`marking:${item.id}`);
        }
        const lineTotal = item.unitPrice * qty;
        lines.push({
          orderItemId: item.id,
          productName: item.productName,
          mxikCode: tax?.mxikCode ?? null,
          packageCode: tax?.packageCode ?? null,
          unitCode: tax?.unitCode ?? null,
          markingRequired,
          markingCodes,
          quantity: qty,
          unitPrice: item.unitPrice,
          lineTotal,
          vatRate,
          vatAmount: Math.round((lineTotal * vatRate) / (100 + vatRate)) || 0,
        });
      }

      // Yetkazib berish — alohida xizmat qatori (chek jami mijoz to'lagan
      // summaga teng bo'lishi shart). MXIK: tasnif "Kuryerlik xizmati",
      // sozlamadan olinadi (delivery_mxik_code).
      if (order.deliveryFee > 0) {
        const deliveryMxik = this.settings.get(SETTING_KEYS.DELIVERY_MXIK_CODE, '');
        if (!deliveryMxik) missing.push('delivery:mxik');
        lines.push({
          orderItemId: 'delivery',
          productName: 'Yetkazib berish xizmati',
          mxikCode: deliveryMxik || null,
          packageCode: null,
          unitCode: null,
          markingRequired: false,
          markingCodes: [],
          quantity: 1,
          unitPrice: order.deliveryFee,
          lineTotal: order.deliveryFee,
          vatRate,
          vatAmount:
            Math.round((order.deliveryFee * vatRate) / (100 + vatRate)) || 0,
        });
      }

      const isCash = order.paymentMethod === PaymentMethod.Cash;
      const receipt = this.receipts.create({
        orderId,
        type: FiscalReceiptType.Sale,
        status: missing.length
          ? FiscalReceiptStatus.Incomplete
          : FiscalReceiptStatus.Pending,
        provider: this.provider.name,
        sellerStir: profile?.stir ?? null,
        sellerName: profile?.fullName ?? order.shop.name ?? null,
        sellerVatPayer: profile?.vatPayer ?? false,
        platformStir: platformStir || null,
        platformLegalName: platformLegalName || null,
        lines,
        totalAmount: order.total,
        totalVatAmount: lines.reduce((s, l) => s + l.vatAmount, 0),
        cashAmount: isCash ? order.total : 0,
        cardAmount: isCash ? 0 : order.total,
        missingFields: missing,
      });
      const saved = await this.receipts.save(receipt);
      this.logger.log(
        `Sotuv cheki ${saved.id} (order ${orderId}) yaratildi — status: ${saved.status}` +
          (missing.length ? `, yetishmaydi: ${missing.join(', ')}` : ''),
      );
      return saved;
    } catch (err) {
      this.logger.error(
        `createSaleReceipt(${orderId}) xato: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Qaytarish cheki. items berilmasa — to'liq qaytarish (bekor/refund),
   * berilsa — faqat shu qatorlar/miqdorlar (partial return).
   * Sotuv cheki bo'lmagan orderga refund chek chiqarilmaydi (fiskalizatsiya
   * qilinmagan pulni "qaytarish" soliq tizimida ma'nosiz).
   */
  async createRefundReceipt(
    orderId: string,
    items?: { orderItemId: string; quantity: number }[],
  ): Promise<FiscalReceipt | null> {
    try {
      if (this.mode === 'off') return null;
      const sale = await this.receipts.findOne({
        where: { orderId, type: FiscalReceiptType.Sale },
      });
      if (!sale) return null;

      let lines: FiscalReceiptLine[];
      if (items?.length) {
        const byId = new Map(items.map((i) => [i.orderItemId, i.quantity]));
        lines = sale.lines
          .filter((l) => byId.has(l.orderItemId))
          .map((l) => {
            const qty = Math.min(byId.get(l.orderItemId)!, l.quantity);
            const lineTotal = l.unitPrice * qty;
            return {
              ...l,
              quantity: qty,
              lineTotal,
              vatAmount:
                Math.round((lineTotal * l.vatRate) / (100 + l.vatRate)) || 0,
            };
          });
      } else {
        lines = sale.lines.map((l) => ({ ...l }));
      }
      if (!lines.length) return null;

      const totalAmount = lines.reduce((s, l) => s + l.lineTotal, 0);
      const receipt = this.receipts.create({
        orderId,
        type: FiscalReceiptType.Refund,
        originalReceiptId: sale.id,
        status: sale.missingFields.length
          ? FiscalReceiptStatus.Incomplete
          : FiscalReceiptStatus.Pending,
        provider: this.provider.name,
        sellerStir: sale.sellerStir,
        sellerName: sale.sellerName,
        sellerVatPayer: sale.sellerVatPayer,
        platformStir: sale.platformStir,
        platformLegalName: sale.platformLegalName,
        lines,
        totalAmount,
        totalVatAmount: lines.reduce((s, l) => s + l.vatAmount, 0),
        cashAmount: sale.cashAmount > 0 ? totalAmount : 0,
        cardAmount: sale.cardAmount > 0 ? totalAmount : 0,
        missingFields: [...sale.missingFields],
      });
      const saved = await this.receipts.save(receipt);
      this.logger.log(
        `Qaytarish cheki ${saved.id} (order ${orderId}, ${totalAmount} so'm) yaratildi`,
      );
      return saved;
    } catch (err) {
      this.logger.error(
        `createRefundReceipt(${orderId}) xato: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Incomplete chekni order ma'lumotidan qayta quradi — admin MXIK/STIR
   * to'ldirgandan keyin chaqiriladi.
   */
  async rebuildReceipt(receiptId: string): Promise<FiscalReceipt> {
    const receipt = await this.receipts.findOne({ where: { id: receiptId } });
    if (!receipt) throw new NotFoundException('Chek topilmadi');
    if (
      receipt.status === FiscalReceiptStatus.Confirmed ||
      receipt.status === FiscalReceiptStatus.Sent
    ) {
      throw new BadRequestException(
        'Yuborilgan/tasdiqlangan chekni qayta qurish mumkin emas',
      );
    }
    if (receipt.type === FiscalReceiptType.Refund) {
      // Refund chek sotuv chekidan quriladi — avval sotuv chekini tuzating.
      const sale = receipt.originalReceiptId
        ? await this.receipts.findOne({
            where: { id: receipt.originalReceiptId },
          })
        : null;
      if (sale) {
        receipt.sellerStir = sale.sellerStir;
        receipt.platformStir = sale.platformStir;
        receipt.platformLegalName = sale.platformLegalName;
        receipt.missingFields = [...sale.missingFields];
        receipt.status = sale.missingFields.length
          ? FiscalReceiptStatus.Incomplete
          : FiscalReceiptStatus.Pending;
        return this.receipts.save(receipt);
      }
      return receipt;
    }
    await this.receipts.delete({ id: receiptId });
    const rebuilt = await this.createSaleReceipt(receipt.orderId);
    if (!rebuilt)
      throw new BadRequestException(
        "Chekni qayta qurib bo'lmadi (fiscal_mode=off?)",
      );
    return rebuilt;
  }

  /* ─── OFDga yuborish ─── */

  /**
   * Shundan ko'p muvaffaqiyatsiz urinishdan keyin cron chekni tashlab
   * ketadi (cheksiz urinish + log-shovqin o'rniga) — qator hali
   * `Failed`/`attempts` bilan bazada qoladi, faqat avtomatik qayta
   * urinishdan chiqariladi. `rebuildReceipt` orqali qo'lda qayta urinish
   * mumkin.
   */
  private static readonly MAX_DISPATCH_ATTEMPTS = 10;

  /** live rejimda pending cheklarni provayder orqali uzatadi. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async dispatchPending(): Promise<void> {
    if (this.mode !== 'live') return;
    const pending = await this.receipts.find({
      where: [
        { status: FiscalReceiptStatus.Pending },
        {
          status: FiscalReceiptStatus.Failed,
          attempts: LessThan(FiscalService.MAX_DISPATCH_ATTEMPTS),
        },
      ],
      order: { createdAt: 'ASC' },
      take: 50,
    });
    for (const receipt of pending) {
      try {
        const result = await this.provider.dispatch(receipt);
        receipt.status = FiscalReceiptStatus.Confirmed;
        receipt.provider = this.provider.name;
        receipt.fiscalSign = result.fiscalSign;
        receipt.fiscalReceiptNumber = result.fiscalReceiptNumber;
        receipt.terminalId = result.terminalId;
        receipt.qrUrl = result.qrUrl;
        receipt.sentAt = new Date();
        receipt.confirmedAt = new Date();
      } catch (err) {
        receipt.status = FiscalReceiptStatus.Failed;
        receipt.attempts += 1;
        receipt.lastError = (err as Error).message;
        if (receipt.attempts >= FiscalService.MAX_DISPATCH_ATTEMPTS) {
          // Routine failures log at warn (via provider); this is the
          // escalation point — greppable/alertable, and the last one this
          // receipt will ever produce automatically.
          this.logger.error(
            `dispatchPending: chek ${receipt.id} (order ${receipt.orderId}) ` +
              `${FiscalService.MAX_DISPATCH_ATTEMPTS} marta urinishdan keyin ham OFDga yuborilmadi — ` +
              `avtomatik qayta urinish to'xtatildi, qo'lda tekshiring. Oxirgi xato: ${receipt.lastError}`,
          );
        }
      }
      await this.receipts.save(receipt);
    }
  }

  /* ─── Admin so'rovlar ─── */

  async listReceipts(opts: {
    status?: FiscalReceiptStatus;
    type?: FiscalReceiptType;
    orderId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ items: FiscalReceipt[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (opts.status) where.status = opts.status;
    if (opts.type) where.type = opts.type;
    if (opts.orderId) where.orderId = opts.orderId;
    const [items, total] = await this.receipts.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (opts.page ?? 0) * (opts.limit ?? 30),
      take: opts.limit ?? 30,
    });
    return { items, total };
  }

  async getReceipt(id: string): Promise<FiscalReceipt> {
    const r = await this.receipts.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Chek topilmadi');
    return r;
  }

  async stats(): Promise<Record<string, number>> {
    const rows: { status: string; count: string }[] = await this.receipts
      .createQueryBuilder('r')
      .select('r.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('r.status')
      .getRawMany();
    return Object.fromEntries(
      rows.map((r) => [r.status, parseInt(r.count, 10)]),
    );
  }

  /**
   * MXIK biriktirilmagan faol katalog mahsulotlari — admin "soliq
   * ma'lumotlarini to'ldirish" ish ro'yxati.
   */
  async productsMissingTaxInfo(
    page = 0,
    limit = 50,
  ): Promise<{ items: GlobalProduct[]; total: number }> {
    const [items, total] = await this.globalProducts.findAndCount({
      where: { taxCategoryId: IsNull(), isActive: true },
      order: { usageCount: 'DESC', name: 'ASC' },
      skip: page * limit,
      take: limit,
    });
    return { items, total };
  }

  /** Katalog mahsulotiga soliq toifasini biriktirish. */
  async assignTaxCategory(
    globalProductId: string,
    taxCategoryId: string | null,
  ): Promise<GlobalProduct> {
    const product = await this.globalProducts.findOne({
      where: { id: globalProductId },
    });
    if (!product) throw new NotFoundException('Mahsulot topilmadi');
    if (taxCategoryId) {
      const tax = await this.taxCategories.findOne({
        where: { id: taxCategoryId },
      });
      if (!tax) throw new NotFoundException('Soliq toifasi topilmadi');
    }
    product.taxCategoryId = taxCategoryId;
    return this.globalProducts.save(product);
  }

  async getGlobalProduct(globalProductId: string): Promise<GlobalProduct> {
    const product = await this.globalProducts.findOne({ where: { id: globalProductId } });
    if (!product) throw new NotFoundException('Mahsulot topilmadi');
    return product;
  }

  /**
   * Tasnif taklifini bir bosishda qo'llash: shu mxikCode bilan toifa bo'lsa
   * o'shanga, bo'lmasa yangi toifa yaratib mahsulotga biriktiradi.
   */
  async applyTasnifSuggestion(
    globalProductId: string,
    dto: { mxikCode: string; name: string; unitCode?: string | null; markingRequired?: boolean },
  ): Promise<GlobalProduct> {
    let tax = await this.taxCategories.findOne({ where: { mxikCode: dto.mxikCode } });
    if (!tax) {
      tax = await this.taxCategories.save(
        this.taxCategories.create({
          title: toLocalizedText(dto.name.slice(0, 256)),
          mxikCode: dto.mxikCode,
          unitCode: dto.unitCode ?? null,
          markingRequired: dto.markingRequired ?? false,
        }),
      );
    }
    return this.assignTaxCategory(globalProductId, tax.id);
  }

  /**
   * Order bo'yicha incomplete sotuv chekini qayta qurish — marking kodlar
   * skanerlangandan yoki MXIK biriktirilgandan keyin chaqiriladi. Chek yo'q
   * yoki allaqachon to'liq bo'lsa jim o'tadi.
   */
  async rebuildIncompleteSaleForOrder(orderId: string): Promise<void> {
    try {
      const receipt = await this.receipts.findOne({
        where: { orderId },
      });
      if (!receipt || receipt.status !== FiscalReceiptStatus.Incomplete) return;
      await this.rebuildReceipt(receipt.id);
    } catch {
      // Background reconciliation — hesh qachon xato otmaydi.
    }
  }

  /* ─── TaxCategory CRUD ─── */

  listTaxCategories(): Promise<TaxCategory[]> {
    return this.taxCategories.find();
  }

  async createTaxCategory(dto: any): Promise<TaxCategory> {
    const title = toLocalizedText(dto.titleI18n || { uz: dto.titleUzLatn, kr: dto.titleUzCyrl, ru: dto.titleRu } || dto.title);
    const cat = this.taxCategories.create({
      mxikCode: dto.mxikCode,
      packageCode: dto.packageCode ?? null,
      unitCode: dto.unitCode ?? null,
      markingRequired: dto.markingRequired ?? false,
      title,
    });
    return this.taxCategories.save(cat);
  }

  async updateTaxCategory(
    id: string,
    dto: any,
  ): Promise<TaxCategory> {
    const tax = await this.taxCategories.findOne({ where: { id } });
    if (!tax) throw new NotFoundException('Soliq toifasi topilmadi');
    if (dto.title !== undefined || dto.titleUzLatn !== undefined || dto.titleUzCyrl !== undefined || dto.titleRu !== undefined || dto.titleI18n !== undefined) {
      const cur = typeof tax.title === 'object' ? tax.title : { uz: tax.title || '', kr: '', ru: '' };
      tax.title = toLocalizedText(
        dto.titleI18n || {
          uz: dto.titleUzLatn ?? dto.title ?? cur?.uz,
          kr: dto.titleUzCyrl ?? cur?.kr,
          ru: dto.titleRu ?? cur?.ru,
        },
      );
    }
    if (dto.mxikCode !== undefined) tax.mxikCode = dto.mxikCode;
    if (dto.packageCode !== undefined) tax.packageCode = dto.packageCode;
    if (dto.unitCode !== undefined) tax.unitCode = dto.unitCode;
    if (dto.markingRequired !== undefined) tax.markingRequired = dto.markingRequired;
    return this.taxCategories.save(tax);
  }
}
