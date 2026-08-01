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
    description: "Yetkazib berish xizmati MXIK kodi (tasnif: 'Kuryerlik xizmati')",
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
}
