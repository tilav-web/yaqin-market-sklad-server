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
  DELIVERY_MXIK_CODE: 'delivery_mxik_code', // yetkazish xizmati MXIK (tasnif: Kuryerlik xizmati)
  // ---- Anti-fraud / lokatsiya risk qoidalari ----
  RISK_DELIVERED_MAX_DISTANCE_M: 'risk_delivered_max_distance_m', // "Yetkazildi" bosilgan joy manzildan uzoqligi (metr)
  RISK_EVIDENCE_MAX_ACCURACY_M: 'risk_evidence_max_accuracy_m', // GPS aniqligi bundan yomon bo'lsa masofa qoidasi ishlamaydi (metr)
  RISK_PICKUP_MAX_DISTANCE_M: 'risk_pickup_max_distance_m', // "Kuryerga berish" bosilgan joy do'kondan uzoqligi (metr)
  RISK_IMPOSSIBLE_SPEED_KMH: 'risk_impossible_speed_kmh', // Ikki nuqta orasidagi imkonsiz tezlik chegarasi (km/soat)
  RISK_IMPOSSIBLE_MIN_SEGMENT_M: 'risk_impossible_min_segment_m', // Bundan qisqa masofada tezlik tekshirilmaydi (metr)
  RISK_LOW_RATING_THRESHOLD: 'risk_low_rating_threshold', // Kuryerga shu yoki past yulduz — flag
  RISK_ADDRESS_PIN_MAX_DISTANCE_M: 'risk_address_pin_max_distance_m', // Manzil pini qurilma GPSidan uzoqligi (metr). 0 = o'chirilgan
  RISK_SHOP_RELOCATION_MAX_M: 'risk_shop_relocation_max_m', // Buyurtmalari bor do'kon pinining siljishi (metr)
  RISK_DEVICE_MAX_ACCOUNTS: 'risk_device_max_accounts', // Bitta qurilmada haftasiga nechta akkaunt — undan ko'pi flag
  RISK_PING_RETENTION_DAYS: 'risk_ping_retention_days', // Kuryer marshruti saqlanish muddati (kun)
  RISK_PING_MIN_INTERVAL_SEC: 'risk_ping_min_interval_sec', // Bir buyurtma uchun ping oralig'i (soniya)
  RISK_QR_HANDSHAKE_ENABLED: 'risk_qr_handshake_enabled', // Bayroqli kuryerga QR talab qilinsinmi (1/0)
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
    [SETTING_KEYS.DELIVERY_MXIK_CODE]: {},
  };
