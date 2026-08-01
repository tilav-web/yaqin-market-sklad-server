import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Soliq toifasi — MXIK (IKPU) ma'lumotnomasi.
 *
 * Alohida entity qilingani sabab: FMCG katalogida yuzlab mahsulot bir xil
 * MXIK kodga tushadi (masalan barcha 1.5L gazlangan ichimliklar). Admin bir
 * marta toifa yaratadi, mahsulotlar (GlobalProduct.taxCategoryId) unga
 * bog'lanadi — kod o'zgarsa bitta joyda tuzatiladi.
 *
 * Kodlar manbasi: tasnif.soliq.uz. Noto'g'ri MXIK uchun jarima — savdo
 * summasining 1%i, shuning uchun mxikCode'ni admin tasdiqlagan holda kiritish
 * muhim.
 */
@Entity({ name: 'tax_categories' })
@Index(['mxikCode'])
export class TaxCategory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Admin uchun tushunarli nom, masalan "Gazlangan ichimliklar (PET)". */
  @Column({ type: 'varchar', length: 256 })
  title!: string;

  /** 17 xonali MXIK/IKPU kodi (tasnif.soliq.uz). */
  @Column({ type: 'varchar', length: 32 })
  mxikCode!: string;

  /** Tasnifdagi qadoq (upakovka) kodi — chek qatorida MXIK bilan birga ketadi. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  packageCode!: string | null;

  /** Tasnifdagi o'lchov birligi kodi (dona/kg/litr...). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  unitCode!: string | null;

  /**
   * Asl belgisi (Data Matrix) majburiy markirovka ostidagi tovarmi.
   * Suv/salqin ichimliklar 2024-03-01 dan majburiy — chek qatorida markirovka
   * kodi talab qilinadi (skanerlash oqimi keyingi bosqichda).
   */
  @Column({ type: 'boolean', default: false })
  markingRequired!: boolean;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
