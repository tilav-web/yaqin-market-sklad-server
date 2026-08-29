import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Category } from '../../categories/entities/category.entity';
import { TaxCategory } from '../../fiscal/entities/tax-category.entity';

export type UnitType = 'piece' | 'kg' | 'liter' | 'gram' | 'pack';

/**
 * Platform-wide product master — single source of truth for display data.
 * Per-shop offerings (price/stock) live in ProductVariant.
 *
 * barcode unique: PostgreSQL allows multiple NULLs in a UNIQUE index, so
 * no-barcode custom products coexist safely.
 */
@Entity({ name: 'global_products' })
@Index(['barcode'], { unique: true })
@Index(['isActive', 'usageCount'])
@Index(['parentGlobalProductId'])
@Index(['ownerShopId'])
export class GlobalProduct {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  barcode!: string | null;

  @Column({ type: 'varchar', length: 256 })
  name!: string;

  @Column({ type: 'varchar', length: 256, default: '' })
  nameUzLatn!: string;

  @Column({ type: 'varchar', length: 256, default: '' })
  nameUzCyrl!: string;

  @Column({ type: 'varchar', length: 256, default: '' })
  nameRu!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  brand!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'piece' })
  unitType!: UnitType;

  @Column({ type: 'double precision', default: 1 })
  unitSize!: number;

  @Column({ type: 'uuid', nullable: true })
  categoryId!: string | null;

  @ManyToOne(() => Category, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'categoryId' })
  category!: Category | null;

  /**
   * Soliq toifasi (MXIK/IKPU) — katalog darajasida, chunki bir mahsulotni
   * sotayotgan barcha do'konlar uchun kod bir xil. Null = fiskal chek
   * 'incomplete' bo'ladi (admin "MXIK biriktirilmagan mahsulotlar" ro'yxatida
   * ko'radi).
   */
  @Column({ type: 'uuid', nullable: true })
  taxCategoryId!: string | null;

  @ManyToOne(() => TaxCategory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'taxCategoryId' })
  taxCategory!: TaxCategory | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  photos!: string[];

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text', nullable: true })
  descriptionUzLatn!: string | null;

  @Column({ type: 'text', nullable: true })
  descriptionUzCyrl!: string | null;

  @Column({ type: 'text', nullable: true })
  descriptionRu!: string | null;

  /** Seller who first created the catalogue entry. */
  @Column({ type: 'uuid', nullable: true })
  createdBySellerId!: string | null;

  /** Curated by an admin (trusted). Shows above community entries in search. */
  @Column({ type: 'boolean', default: false })
  isVerified!: boolean;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  /** How many shops currently stock this product. */
  @Column({ type: 'int', default: 0 })
  usageCount!: number;

  /**
   * Size-group parent (e.g. "Coca-Cola 1L" is the canonical entry;
   * "Coca-Cola 0.5L" and "Coca-Cola 1.5L" point to it).
   * Siblings = WHERE parentGlobalProductId = :gid OR id = :gid.
   */
  @Column({ type: 'uuid', nullable: true })
  parentGlobalProductId!: string | null;

  @ManyToOne(() => GlobalProduct, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parentGlobalProductId' })
  parent!: GlobalProduct | null;

  /**
   * Non-null = private product owned by a single shop (barcode-less custom item
   * or barcoded item the seller created for themselves before it became shared).
   * Shared catalogue search filters WHERE ownerShopId IS NULL.
   */
  @Column({ type: 'uuid', nullable: true })
  ownerShopId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
