import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  GlobalSetting,
  SETTING_KEYS,
  STRING_SETTING_KEYS,
} from './entities/global-setting.entity';

const DEFAULTS: Record<string, { value: string; description: string }> = {
  [SETTING_KEYS.COMMISSION_RATE_DEFAULT]: {
    value: '12.00',
    description: 'Standart komissiya foizi (%)',
  },
  [SETTING_KEYS.DEBT_DUE_DAYS]: {
    value: '30',
    description: "Qarz to'lash muddati (kun)",
  },
  [SETTING_KEYS.SETTLEMENT_HOURS]: {
    value: '24',
    description: 'Pul yetkazilgandan necha soat keyin chiqariladi',
  },
  [SETTING_KEYS.EXPIRY_WARNING_DAYS]: {
    value: '7',
    description: 'Yaroqlilik muddati ogohlantirish (kun)',
  },
  [SETTING_KEYS.EXPIRY_CRITICAL_DAYS]: {
    value: '2',
    description: 'Yaroqlilik muddati kritik (kun)',
  },
  [SETTING_KEYS.LOW_STOCK_WARNING_DEFAULT]: {
    value: '10',
    description: 'Kam qoldiq ogohlantirish default',
  },
  [SETTING_KEYS.LOW_STOCK_CRITICAL_DEFAULT]: {
    value: '3',
    description: 'Kam qoldiq kritik default',
  },
  [SETTING_KEYS.CLICK_FEE_PERCENT]: {
    value: '3.00',
    description: 'Click ekvayring komissiyasi (%) — shartnomadagi haqiqiy foiz',
  },
  [SETTING_KEYS.PAYOUT_FEE_PERCENT]: {
    value: '1.00',
    description: "Sellerga karta o'tkazma komissiyasi (%)",
  },
  [SETTING_KEYS.MIN_ORDER_TOTAL]: {
    value: '0',
    description: "Minimal buyurtma summasi (so'm), 0 = cheklov yo'q",
  },
  [SETTING_KEYS.VAT_RATE_PERCENT]: {
    value: '12',
    description: 'QQS standart stavkasi (%)',
  },
  [SETTING_KEYS.FISCAL_MODE]: {
    value: 'collect',
    description:
      "Fiskal rejim: off (chek yaratilmaydi) | collect (cheklar yig'iladi, yuborilmaydi) | live (OFDga yuboriladi)",
  },
  [SETTING_KEYS.PLATFORM_LEGAL_NAME]: {
    value: '',
    description: 'Operator (MChJ) rasmiy nomi — fiskal cheklar uchun',
  },
  [SETTING_KEYS.PLATFORM_STIR]: {
    value: '',
    description: 'Operator (MChJ) STIRi — fiskal cheklar uchun',
  },
  [SETTING_KEYS.DELIVERY_MXIK_CODE]: {
    value: '10105001002000000',
    description:
      "Yetkazib berish xizmati MXIK kodi (tasnif: 'Kuryerlik xizmati')",
  },
  [SETTING_KEYS.DIDOX_USER_KEY]: {
    value: '',
    description:
      "Didox API kaliti (user-key) — Soliq ma'lumotlarini avtomatik tekshirish uchun",
  },
  [SETTING_KEYS.DIDOX_API_URL]: {
    value: 'https://api.didox.uz',
    description: 'Didox API asosiy manzili (masalan: https://api.didox.uz)',
  },
  [SETTING_KEYS.RISK_DELIVERED_MAX_DISTANCE_M]: {
    value: '300',
    description:
      '"Yetkazildi" tugmasi bosilgan joy manzildan qancha uzoq bo\'lsa flag (metr)',
  },
  [SETTING_KEYS.RISK_EVIDENCE_MAX_ACCURACY_M]: {
    value: '150',
    description:
      "GPS aniqligi bundan yomon bo'lsa masofa qoidasi ishlamaydi (metr)",
  },
  [SETTING_KEYS.RISK_PICKUP_MAX_DISTANCE_M]: {
    value: '400',
    description:
      'Kuryer "yo\'lga chiqdim" bosgan joy do\'kondan uzoqligi (metr)',
  },
  [SETTING_KEYS.RISK_IMPOSSIBLE_SPEED_KMH]: {
    value: '120',
    description: 'Ikki nuqta orasidagi imkonsiz tezlik chegarasi (km/soat)',
  },
  [SETTING_KEYS.RISK_IMPOSSIBLE_MIN_SEGMENT_M]: {
    value: '1000',
    description:
      'Bundan qisqa masofada tezlik tekshirilmaydi — GPS sakrashi (metr)',
  },
  [SETTING_KEYS.RISK_LOW_RATING_THRESHOLD]: {
    value: '2',
    description: 'Kuryerga shu yoki past yulduz — flag',
  },
  [SETTING_KEYS.RISK_ADDRESS_PIN_MAX_DISTANCE_M]: {
    value: '0',
    description:
      "Saqlangan manzil pini qurilma GPSidan uzoqligi (metr). 0 = o'chirilgan",
  },
  [SETTING_KEYS.RISK_SHOP_RELOCATION_MAX_M]: {
    value: '500',
    description: "Buyurtmalari bor do'kon pinining siljishi (metr)",
  },
  [SETTING_KEYS.RISK_DEVICE_MAX_ACCOUNTS]: {
    value: '5',
    description: "Bitta qurilmada haftasiga nechta akkaunt — undan ko'pi flag",
  },
  [SETTING_KEYS.RISK_PING_RETENTION_DAYS]: {
    value: '90',
    description: 'Kuryer marshruti saqlanish muddati (kun)',
  },
  [SETTING_KEYS.RISK_PING_MIN_INTERVAL_SEC]: {
    value: '5',
    description: "Bir buyurtma uchun ping oralig'i (soniya)",
  },
  [SETTING_KEYS.RISK_QR_HANDSHAKE_ENABLED]: {
    value: '1',
    description:
      "Bayrog'i tasdiqlangan kuryerga QR-tasdiq talab qilinsinmi (1/0)",
  },
};

/** Komissiya foizi berilganda platforma marjasi qanday bo'lishini hisoblaydi. */
export interface EconomicsBreakdown {
  commissionPercent: number;
  clickFeePercent: number;
  payoutFeePercent: number;
  /** Onlayn buyurtma: komissiya − Click ekvayring − seller ulushiga payout. */
  onlineMarginPercent: number;
  /** Naqd buyurtma: komissiya qarz sifatida yig'iladi, Click/payout yo'q. */
  cashMarginPercent: number;
  /** 100 000 so'mlik buyurtma misolida so'mdagi taqsimot. */
  examplePer100k: {
    online: {
      commission: number;
      clickFee: number;
      payoutFee: number;
      platformNet: number;
      sellerNet: number;
    };
    cash: { commission: number; platformNet: number; sellerNet: number };
  };
  warnings: string[];
}

@Injectable()
export class SettingsService implements OnModuleInit {
  private cache = new Map<string, string>();

  constructor(
    @InjectRepository(GlobalSetting)
    private readonly repo: Repository<GlobalSetting>,
  ) {}

  async onModuleInit() {
    // Seed defaults if missing
    for (const [key, { value, description }] of Object.entries(DEFAULTS)) {
      const existing = await this.repo.findOne({ where: { key } });
      if (!existing) {
        await this.repo.save(this.repo.create({ key, value, description }));
      }
    }
    await this.refreshCache();
  }

  private async refreshCache() {
    const all = await this.repo.find();
    this.cache.clear();
    all.forEach((s) => this.cache.set(s.key, s.value));
  }

  get(key: string, fallback = ''): string {
    return this.cache.get(key) ?? DEFAULTS[key]?.value ?? fallback;
  }

  getNumber(key: string, fallback = 0): number {
    const v = this.get(key);
    const n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  async getAll(): Promise<GlobalSetting[]> {
    return this.repo.find({ order: { key: 'ASC' } });
  }

  async set(key: string, value: string, force = false): Promise<GlobalSetting> {
    const stringKey = STRING_SETTING_KEYS[key];
    if (stringKey) {
      if (stringKey.allowedValues && !stringKey.allowedValues.includes(value)) {
        throw new BadRequestException(
          `Qiymat quyidagilardan biri bo'lishi kerak: ${stringKey.allowedValues.join(', ')}`,
        );
      }
      // Bo'sh qiymat doim ruxsat etiladi (masalan platform_stir MChJ ochilishini
      // kutayotganda bo'sh qolishi normal) — faqat TO'LDIRILGAN qiymat formatga
      // mos kelishi tekshiriladi.
      if (stringKey.pattern && value !== '' && !stringKey.pattern.test(value)) {
        throw new BadRequestException(
          `Noto'g'ri format${stringKey.patternHint ? ` — ${stringKey.patternHint} bo'lishi kerak` : ''}`,
        );
      }
    } else {
      // Every numeric setting (percent/days/hours) is parsed by getNumber()
      // with parseFloat — an unparseable value (e.g. a comma-decimal "12,00",
      // or accidental text) previously saved silently and getNumber() would
      // then silently fall back to 0 forever with no indication anything was
      // wrong (e.g. commission dropping to 0%). Number('') is 0, not NaN —
      // reject blank explicitly first, or an emptied field would read as a
      // "valid" zero (e.g. commission -> 0%).
      const n = Number(value);
      if (value.trim() === '' || !Number.isFinite(n) || n < 0) {
        throw new BadRequestException(
          "Qiymat manfiy bo'lmagan raqam bo'lishi kerak",
        );
      }
      if (key === SETTING_KEYS.COMMISSION_RATE_DEFAULT && n > 100) {
        throw new BadRequestException(
          "Komissiya foizi 100 dan katta bo'la olmaydi",
        );
      }
      // Break-even himoyasi: komissiya Click + payout xarajatlarini yopmasa,
      // har bir onlayn buyurtma platformaga zarar. Admin ogohlantirishni
      // ko'rib ataylab davom etmoqchi bo'lsa force=true yuboradi.
      if (key === SETTING_KEYS.COMMISSION_RATE_DEFAULT && !force) {
        const eco = this.computeEconomics(n);
        if (eco.onlineMarginPercent < 0) {
          throw new BadRequestException(
            `DIQQAT: ${n}% komissiya bilan onlayn to'lovda har buyurtmadan ZARAR ko'rasiz ` +
              `(marja ${eco.onlineMarginPercent.toFixed(2)}%). Xarajatlar: Click ${eco.clickFeePercent}% ` +
              `+ sellerga o'tkazma ~${eco.payoutFeePercent}%. 100 000 so'mlik buyurtmada platforma sofi: ` +
              `${eco.examplePer100k.online.platformNet} so'm. Baribir saqlash uchun force=true yuboring.`,
          );
        }
      }
    }

    let setting = await this.repo.findOne({ where: { key } });
    if (!setting) {
      setting = this.repo.create({ key, value, description: null });
    } else {
      setting.value = value;
    }
    const saved = await this.repo.save(setting);
    this.cache.set(key, value);
    return saved;
  }

  /**
   * Berilgan komissiya foizida platformaning haqiqiy marjasi.
   *
   * Pul oqimi (onlayn): mijoz total to'laydi → Click o'z foizini totaldan
   * ushlab qoladi (platforma yutadi, sellerga o'tkazilmaydi) → sellerga
   * (total − komissiya) tegishli → payout paytida o'tkazma komissiyasi ham
   * platforma hisobidan. Naqdda: pul sellerda qoladi, komissiya qarz sifatida
   * yig'iladi — Click ham, payout ham yo'q.
   */
  computeEconomics(commissionPercent?: number): EconomicsBreakdown {
    const c =
      commissionPercent ?? this.getNumber(SETTING_KEYS.COMMISSION_RATE_DEFAULT);
    const click = this.getNumber(SETTING_KEYS.CLICK_FEE_PERCENT);
    const payout = this.getNumber(SETTING_KEYS.PAYOUT_FEE_PERCENT);

    const sellerSharePercent = 100 - c;
    // Payout xarajati butun buyurtmaga nisbatan: payout% × sellerUlushi.
    const payoutCostPercent = (payout * sellerSharePercent) / 100;
    const onlineMarginPercent = c - click - payoutCostPercent;
    const cashMarginPercent = c;

    const base = 100_000;
    const commission = Math.round((base * c) / 100);
    const clickFee = Math.round((base * click) / 100);
    const sellerNet = base - commission;
    const payoutFee = Math.round((sellerNet * payout) / 100);

    const warnings: string[] = [];
    if (onlineMarginPercent < 0) {
      warnings.push(
        `Onlayn to'lovda marja MANFIY (${onlineMarginPercent.toFixed(2)}%) — har bir Click buyurtmasidan zarar ko'rasiz.`,
      );
    } else if (onlineMarginPercent < 1) {
      warnings.push(
        `Onlayn marja juda past (${onlineMarginPercent.toFixed(2)}%) — SMS, server va refund xarajatlari bilan real natija zarar bo'lishi mumkin.`,
      );
    }
    if (c < click) {
      warnings.push(
        `Komissiya (${c}%) Click ekvayringidan (${click}%) past — bu holat hech qachon foydali emas.`,
      );
    }

    return {
      commissionPercent: c,
      clickFeePercent: click,
      payoutFeePercent: payout,
      onlineMarginPercent: Math.round(onlineMarginPercent * 100) / 100,
      cashMarginPercent,
      examplePer100k: {
        online: {
          commission,
          clickFee,
          payoutFee,
          platformNet: commission - clickFee - payoutFee,
          sellerNet,
        },
        cash: { commission, platformNet: commission, sellerNet },
      },
      warnings,
    };
  }

  /**
   * Super Admin Didox API kalitini kiritganda ulanishni tekshirish uchun.
   */
  async testDidox(
    userKey?: string,
    tin = '313296455',
  ): Promise<{
    success: boolean;
    status: number;
    data?: any;
    error?: string;
    message: string;
  }> {
    const key = (
      userKey ||
      this.get(SETTING_KEYS.DIDOX_USER_KEY) ||
      process.env.DIDOX_USER_KEY ||
      ''
    ).trim();
    if (!key) {
      return {
        success: false,
        status: 400,
        message:
          'Didox API kaliti kiritilmagan. Iltimos, Didox kabinetingizdagi user-key ni kiriting.',
      };
    }
    const apiUrl = (
      this.get(SETTING_KEYS.DIDOX_API_URL) || 'https://api.didox.uz'
    ).replace(/\/+$/, '');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${apiUrl}/v1/profile/info?tin=${tin}`, {
        signal: controller.signal,
        headers: {
          'user-key': key,
          Accept: 'application/json',
          'User-Agent': 'YaqinMarket/1.0',
        },
      });
      clearTimeout(timeout);
      const text = await res.text();
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        json = { raw: text };
      }

      if (res.ok) {
        return {
          success: true,
          status: res.status,
          data: json,
          message:
            "Didox & Soliq API ga muvaffaqiyatli ulandi! Ma'lumotlar to'g'ri qabul qilinmoqda.",
        };
      } else {
        const errorMsg = String(json.message || json.error || text);
        return {
          success: false,
          status: res.status,
          error: errorMsg,
          message: `Didox xatolik qaytardi (${res.status}): ${errorMsg || "Token noto'g'ri yoki muddati o'tgan"}`,
        };
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        status: 500,
        error: errorMsg,
        message: `Didox serveriga ulanishda xatolik: ${errorMsg}`,
      };
    }
  }
}
