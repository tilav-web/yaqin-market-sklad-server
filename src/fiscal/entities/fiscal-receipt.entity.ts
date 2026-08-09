import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum FiscalReceiptType {
  /** Sotuv cheki — to'lov qabul qilinganda (online: Click complete, naqd: Delivered). */
  Sale = 'sale',
  /** Qaytarish cheki — refund/bekor/partial return. Asl chekka bog'lanadi. */
  Refund = 'refund',
}

export enum FiscalReceiptStatus {
  /**
   * Ma'lumot yetishmaydi (mahsulotda MXIK yo'q, sellerda STIR yo'q...) —
   * missingFields'da ro'yxati. Ma'lumot to'ldirilgach retry qilinadi.
   */
  Incomplete = 'incomplete',
  /** To'liq shakllangan, provayderga yuborilishini kutmoqda (fiscal_mode=collect da shu holatda to'planadi). */
  Pending = 'pending',
  /** Provayderga yuborildi, tasdiq kutilmoqda. */
  Sent = 'sent',
  /** OFD tasdiqladi — fiscalSign/qrUrl to'ldirilgan. */
  Confirmed = 'confirmed',
  /** Yuborish xatosi — lastError'da sabab, cron qayta uradi. */
  Failed = 'failed',
}

/** Chekning bitta qatori — order item'dan soliq rekvizitlari bilan snapshot. */
export interface FiscalReceiptLine {
  orderItemId: string;
  productName: string;
  mxikCode: string | null;
  packageCode: string | null;
  unitCode: string | null;
  markingRequired: boolean;
  /** Data Matrix kodi — skanerlash oqimi qo'shilganda to'ldiriladi. */
  /** Data Matrix kodlari — har bir sotilgan dona uchun bittadan (skanerlangan bo'lsa). */
  markingCodes: string[];
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** QQS stavkasi (%). Seller QQS to'lovchisi bo'lmasa 0. */
  vatRate: number;
  /** Narx ichidagi QQS: lineTotal * r / (100 + r). */
  vatAmount: number;
}

/**
 * Fiskal chek — komissioner modelida sotuvchi (komitent) nomidan chiqariladi:
 * chekda har bir tovar sotuvchining STIRi bilan ketadi, operator (platforma)
 * rekvizitlari GlobalSetting'dan olinadi.
 *
 * Hozircha real OFD provayder yo'q — cheklar to'liq shakllangan holda
 * saqlanadi (fiscal_mode=collect). OFD shartnomasi tuzilgach provayder
 * yoziladi va fiscal_mode=live da pending cheklar avtomatik jo'natiladi.
 */
@Entity({ name: 'fiscal_receipts' })
@Index(['orderId'])
@Index(['status'])
@Index(['type', 'status'])
export class FiscalReceipt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // FK atayin yo'q — chek soliq hujjati, order o'chirilsa ham qolishi kerak.
  @Column({ type: 'uuid' })
  orderId!: string;

  @Column({
    type: 'enum',
    enum: FiscalReceiptType,
    default: FiscalReceiptType.Sale,
  })
  type!: FiscalReceiptType;

  /** Refund cheki uchun — bekor qilinayotgan sotuv chekining id'si. */
  @Column({ type: 'uuid', nullable: true })
  originalReceiptId!: string | null;

  @Column({
    type: 'enum',
    enum: FiscalReceiptStatus,
    default: FiscalReceiptStatus.Pending,
  })
  status!: FiscalReceiptStatus;

  /** Chekni chiqargan provayder identifikatori ('none' — hali ulanmagan). */
  @Column({ type: 'varchar', length: 32, default: 'none' })
  provider!: string;

  /** Komitent (sotuvchi) rekvizitlari — chek paytidagi snapshot. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  sellerStir!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  sellerName!: string | null;

  /** Seller QQS to'lovchisimi (chek paytidagi snapshot). */
  @Column({ type: 'boolean', default: false })
  sellerVatPayer!: boolean;

  /**
   * Operator (platforma, MChJ) rekvizitlari — chek paytidagi snapshot,
   * GlobalSetting.platform_stir/platform_legal_name'dan. Komissioner
   * modelida chekning har bir qatorida SOTUVCHI STIRi ko'rinadi (yuqorida),
   * lekin chekni CHIQARGAN tomon sifatida operator identifikatori ham real
   * OFD integratsiyasi uchun zarur — shuning uchun alohida saqlanadi.
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  platformStir!: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  platformLegalName!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  lines!: FiscalReceiptLine[];

  /** Chek jami (refund chekda ham musbat — type farqlaydi). */
  @Column({ type: 'int' })
  totalAmount!: number;

  @Column({ type: 'int', default: 0 })
  totalVatAmount!: number;

  /** Fiskal API talabi: naqd/karta bo'linishi. */
  @Column({ type: 'int', default: 0 })
  cashAmount!: number;

  @Column({ type: 'int', default: 0 })
  cardAmount!: number;

  /** Incomplete holat sababi: ["product:<gid>:mxik", "seller:stir", ...]. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  missingFields!: string[];

  // ---- OFD javobidan to'ldiriladigan maydonlar ----
  @Column({ type: 'varchar', length: 64, nullable: true })
  fiscalSign!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  fiscalReceiptNumber!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  terminalId!: string | null;

  /** Mijozga ko'rsatiladigan soliq QR havolasi (cashback skaneri uchun). */
  @Column({ type: 'varchar', length: 512, nullable: true })
  qrUrl!: string | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
