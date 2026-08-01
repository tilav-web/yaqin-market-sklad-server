import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'global_settings' })
export class GlobalSetting {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ type: 'varchar', length: 256 })
  value!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

export const SETTING_KEYS = {
  COMMISSION_RATE_DEFAULT: 'commission_rate_default', // e.g. "12.00"
  DEBT_DUE_DAYS: 'debt_due_days', // e.g. "30"
  SETTLEMENT_HOURS: 'settlement_hours', // e.g. "24"
  EXPIRY_WARNING_DAYS: 'expiry_warning_days', // e.g. "7"
  EXPIRY_CRITICAL_DAYS: 'expiry_critical_days', // e.g. "2"
  LOW_STOCK_WARNING_DEFAULT: 'low_stock_warning_default', // e.g. "10"
  LOW_STOCK_CRITICAL_DEFAULT: 'low_stock_critical_default', // e.g. "3"
  // ---- To'lov iqtisodiyoti (unit economics) ----
  CLICK_FEE_PERCENT: 'click_fee_percent', // Click ekvayring % (shartnomadan), e.g. "3.00"
  PAYOUT_FEE_PERCENT: 'payout_fee_percent', // sellerga karta o'tkazma % , e.g. "1.00"
  MIN_ORDER_TOTAL: 'min_order_total', // so'm; "0" = cheklov yo'q
  // ---- Soliq / fiskalizatsiya ----
  VAT_RATE_PERCENT: 'vat_rate_percent', // QQS standart stavkasi, e.g. "12"
  FISCAL_MODE: 'fiscal_mode', // off | collect | live
  PLATFORM_LEGAL_NAME: 'platform_legal_name', // operator (MChJ) nomi — cheklar uchun
  PLATFORM_STIR: 'platform_stir', // operator STIRi — cheklar uchun
} as const;

/**
 * Raqam bo'lmagan (matnli) kalitlar — set() bulardan boshqasini raqam sifatida
 * tekshiradi. allowedValues berilgan bo'lsa faqat shu qiymatlar qabul qilinadi.
 */
export const STRING_SETTING_KEYS: Record<string, { allowedValues?: string[] }> =
  {
    [SETTING_KEYS.FISCAL_MODE]: { allowedValues: ['off', 'collect', 'live'] },
    [SETTING_KEYS.PLATFORM_LEGAL_NAME]: {},
    [SETTING_KEYS.PLATFORM_STIR]: {},
  };
