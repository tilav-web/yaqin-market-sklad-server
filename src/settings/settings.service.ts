import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
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
    description: 'Kam qolgan tovar ogohlantirish (dona)',
  },
  [SETTING_KEYS.LOW_STOCK_CRITICAL_DEFAULT]: {
    value: '3',
    description: 'Kam qolgan tovar kritik (dona)',
  },
  [SETTING_KEYS.CLICK_FEE_PERCENT]: {
    value: '3.00',
    description: 'Click ekvayring komissiyasi (%) — shartnomadan',
  },
  [SETTING_KEYS.PAYOUT_FEE_PERCENT]: {
    value: '1.00',
    description: "Sellerga karta o'tkazma to'lovi (%)",
  },
  [SETTING_KEYS.MIN_ORDER_TOTAL]: {
    value: '0',
    description: "Minimal buyurtma summasi (so'm; 0 = cheklov yo'q)",
  },
  [SETTING_KEYS.VAT_RATE_PERCENT]: {
    value: '12',
    description: "QQS standart stavkasi (%) — O'zR Soliq Kodeksi",
  },
  [SETTING_KEYS.FISCAL_MODE]: {
    value: 'off',
    description: 'Fiskal rejim: off | collect | live',
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
  [SETTING_KEYS.SOLIQ_AUTH_TOKEN]: {
    value: '',
    description: 'Davlat Soliq API sessiya/bearer tokeni',
  },
  [SETTING_KEYS.SOLIQ_TOKEN_EXPIRES_AT]: {
    value: '',
    description: 'Soliq tokenining amal qilish muddati (ISO timestamp)',
  },
  [SETTING_KEYS.SOLIQ_KEY_PATH]: {
    value: '',
    description: "Serverda saqlangan E-IMZO (.pfx) kalit fayli yo'li",
  },
  [SETTING_KEYS.SOLIQ_KEY_PASSWORD_ENC]: {
    value: '',
    description: 'Shifrlangan E-IMZO kalit paroli',
  },
  [SETTING_KEYS.SOLIQ_OPERATOR_TIN]: {
    value: '313296455',
    description: 'Operator (MChJ) STIRi',
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
    // Obsolete Didox sozlamalarini bazadan tozalash
    await this.repo
      .createQueryBuilder()
      .delete()
      .from(GlobalSetting)
      .where('key IN (:...keys)', {
        keys: ['didox_user_key', 'didox_api_url'],
      })
      .execute();

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

  // ==========================================
  // ---- Davlat Soliq & E-IMZO Integratsiyasi ----
  // ==========================================

  private getEncryptionSecret(): Buffer {
    const secret =
      process.env.JWT_SECRET || 'dev_jwt_secret_change_me_in_production';
    return crypto.createHash('sha256').update(secret).digest();
  }

  encryptPassword(password: string): string {
    if (!password) return '';
    const iv = crypto.randomBytes(12);
    const key = this.getEncryptionSecret();
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(password, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decryptPassword(cipherPayload: string): string {
    if (!cipherPayload) return '';
    try {
      const [ivHex, tagHex, dataHex] = cipherPayload.split(':');
      if (!ivHex || !tagHex || !dataHex) return '';
      const iv = Buffer.from(ivHex, 'hex');
      const tag = Buffer.from(tagHex, 'hex');
      const data = Buffer.from(dataHex, 'hex');
      const key = this.getEncryptionSecret();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      return '';
    }
  }

  /**
   * Super Admin tomonidan yuklangan .pfx E-IMZO kalit faylini va parolini saqlash
   */
  async saveSoliqKey(
    fileBuffer: Buffer,
    originalName: string,
    password: string,
    operatorTin?: string,
  ): Promise<{ success: boolean; message: string; keyPath: string }> {
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException(
        "Kalit fayli (.pfx / .p12) bo'sh bo'lishi mumkin emas",
      );
    }
    if (!password || password.trim() === '') {
      throw new BadRequestException('E-IMZO kalit paroli kiritilishi shart');
    }

    const keysDir = path.resolve(process.cwd(), 'storage', 'keys');
    if (!fs.existsSync(keysDir)) {
      fs.mkdirSync(keysDir, { recursive: true });
    }

    const ext = path.extname(originalName).toLowerCase() || '.pfx';
    const filePath = path.join(keysDir, `soliq_eimzo_key${ext}`);
    fs.writeFileSync(filePath, fileBuffer);

    const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
    await this.set(SETTING_KEYS.SOLIQ_KEY_PATH, relPath, true);
    await this.set(
      SETTING_KEYS.SOLIQ_KEY_PASSWORD_ENC,
      this.encryptPassword(password),
      true,
    );
    if (operatorTin && /^\d{9}$/.test(operatorTin.trim())) {
      await this.set(SETTING_KEYS.SOLIQ_OPERATOR_TIN, operatorTin.trim(), true);
    }

    return {
      success: true,
      message: 'E-IMZO (.pfx) kaliti va paroli serverda xavfsiz saqlandi!',
      keyPath: relPath,
    };
  }

  /**
   * Soliq API Bearer tokenini qo'lda yoki E-IMZO brauzer orqali yangilash
   */
  async setSoliqToken(
    token: string,
    expiresInHours = 24,
  ): Promise<{ success: boolean; message: string; expiresAt: string }> {
    const cleanToken = token.trim();
    if (!cleanToken) {
      throw new BadRequestException("Token bo'sh bo'lishi mumkin emas");
    }
    const expiresAt = new Date(
      Date.now() + expiresInHours * 3600 * 1000,
    ).toISOString();

    await this.set(SETTING_KEYS.SOLIQ_AUTH_TOKEN, cleanToken, true);
    await this.set(SETTING_KEYS.SOLIQ_TOKEN_EXPIRES_AT, expiresAt, true);

    return {
      success: true,
      message: `Soliq tokeni muvaffaqiyatli saqlandi! Amal qilish muddati: ${expiresAt}`,
      expiresAt,
    };
  }

  /**
   * Soliq va E-IMZO integratsiyasi holatini tekshirish
   */
  getSoliqStatus(): {
    hasKey: boolean;
    keyPath: string;
    keyFileName: string;
    keyFileSize: number;
    hasPassword: boolean;
    hasToken: boolean;
    isTokenExpired: boolean;
    tokenExpiresAt: string;
    operatorTin: string;
    tokenPreview: string;
  } {
    const keyPath = this.get(SETTING_KEYS.SOLIQ_KEY_PATH);
    let hasKey = false;
    let keyFileSize = 0;
    let keyFileName = '';
    if (keyPath) {
      const absPath = path.resolve(process.cwd(), keyPath);
      if (fs.existsSync(absPath)) {
        hasKey = true;
        const stats = fs.statSync(absPath);
        keyFileSize = stats.size;
        keyFileName = path.basename(absPath);
      }
    }

    const hasPassword = Boolean(this.get(SETTING_KEYS.SOLIQ_KEY_PASSWORD_ENC));
    const token = this.get(SETTING_KEYS.SOLIQ_AUTH_TOKEN);
    const tokenExpiresAt = this.get(SETTING_KEYS.SOLIQ_TOKEN_EXPIRES_AT);
    const hasToken = Boolean(token && token.trim() !== '');
    const isTokenExpired =
      Boolean(tokenExpiresAt) &&
      new Date(tokenExpiresAt).getTime() < Date.now();
    const operatorTin =
      this.get(SETTING_KEYS.SOLIQ_OPERATOR_TIN) ||
      this.get(SETTING_KEYS.PLATFORM_STIR) ||
      '313296455';

    const tokenPreview = token
      ? `${token.slice(0, 8)}...${token.slice(-6)}`
      : '';

    return {
      hasKey,
      keyPath,
      keyFileName,
      keyFileSize,
      hasPassword,
      hasToken,
      isTokenExpired,
      tokenExpiresAt,
      operatorTin,
      tokenPreview,
    };
  }

  /**
   * STIR bo'yicha Soliq yoki Davlat API ulanishini tekshirish
   */
  async testSoliqConnection(
    tin = '313296455',
    customToken?: string,
  ): Promise<{
    success: boolean;
    status: number;
    data?: unknown;
    error?: string;
    message: string;
  }> {
    const cleanTin = tin.replace(/\D/g, '');
    const token = (
      customToken ||
      this.get(SETTING_KEYS.SOLIQ_AUTH_TOKEN) ||
      ''
    ).trim();

    const status = this.getSoliqStatus();

    // Agar faol token mavjud bo'lsa, to'g'ridan-to'g'ri Soliq API'siga murojaat qilish
    if (token) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);
        const res = await fetch(
          `https://my.soliq.uz/tin-service/info?tin=${cleanTin}`,
          {
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            },
          },
        );
        clearTimeout(timeout);

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const json = await res.json();
          return {
            success: true,
            status: res.status,
            data: json,
            message: `Davlat Soliq API ga muvaffaqiyatli ulandi! STIR ${cleanTin} ma'lumotlari qabul qilindi.`,
          };
        }
      } catch {
        // Fall through to status diagnosis below
      }
    }

    // Diagnostik status hisoboti
    if (status.hasKey) {
      return {
        success: true,
        status: 200,
        data: {
          status: 'KEY_CONFIGURED',
          keyFileName: status.keyFileName,
          keyFileSize: `${(status.keyFileSize / 1024).toFixed(1)} KB`,
          operatorTin: status.operatorTin,
          hasPassword: status.hasPassword,
          hasToken: status.hasToken,
          isTokenExpired: status.isTokenExpired,
          tokenExpiresAt: status.tokenExpiresAt || 'Muddati belgilanmagan',
        },
        message:
          status.hasToken && !status.isTokenExpired
            ? 'E-IMZO kaliti va faol Soliq tokeni sozlangan!'
            : 'E-IMZO kaliti serverda xavfsiz saqlangan. Soliq seansi uchun tokenni yangilang.',
      };
    }

    return {
      success: false,
      status: 400,
      message:
        'E-IMZO (.pfx) kaliti yuklanmagan. Iltimos, admin panel orqali MChJ kalit faylini va parolini kiriting.',
    };
  }

  /**
   * Eskirgan Didox testi uchun moslashtiruvchi alias
   */
  async testDidox(userKey?: string, tin = '313296455') {
    return this.testSoliqConnection(tin, userKey);
  }
}
