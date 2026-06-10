import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { UnitType } from './product-variant.entity';

/**
 * A shared, platform-wide product master keyed by barcode. The FIRST seller to
 * scan an unknown barcode fills in the details (name, brand, photo, unit); every
 * later seller who scans the same barcode gets those details auto-filled and
 * only has to enter their own price, stock and cost.
 *
 * This is intentionally separate from per-shop `ProductVariant` (which owns
 * price/stock/discount/FIFO cost) — a GlobalProduct is the catalogue identity,
 * the variant is one shop's offering of it.
 */
@Entity({ name: 'global_products' })
@Index(['barcode'], { unique: true })
export class GlobalProduct {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  barcode!: string | null;

  @Column({ type: 'varchar', length: 256 })
  name!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  brand!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'piece' })
  defaultUnitType!: UnitType;

  @Column({ type: 'double precision', default: 1 })
  defaultUnitSize!: number;

  @Column({ type: 'uuid', nullable: true })
  categoryId!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  photos!: string[];

  /** Seller who first created the catalogue entry. */
  @Column({ type: 'uuid', nullable: true })
  createdBySellerId!: string | null;

  /** Curated by an admin (trusted). */
  @Column({ type: 'boolean', default: false })
  isVerified!: boolean;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** Variantlarni guruhlash uchun (masalan "Coca-Cola"). */
  @Column({ type: 'varchar', length: 128, nullable: true })
  groupName!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  /** How many shops currently stock this product — popularity / trust signal. */
  @Column({ type: 'int', default: 0 })
  usageCount!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
