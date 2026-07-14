import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ProductVariant } from './product-variant.entity';

export enum MovementType {
  In = 'in',
  Sold = 'sold',
  Returned = 'returned',
  Expired = 'expired',
  Adjusted = 'adjusted',
  Damaged = 'damaged',
  /** Bulk/manual price edit — SPEC.md §24.2. Carries beforePrice/afterPrice, not stock. */
  PriceChanged = 'price_changed',
}

/** Mandatory reason for a "brak" (write-off) — SPEC.md §26.3. */
export enum BrakReasonCode {
  Expired = 'expired',
  Damaged = 'damaged',
  Stolen = 'stolen',
  /** Requires a free-text note (see BrakStockDto). */
  Other = 'other',
}

@Entity({ name: 'inventory_movements' })
@Index(['productVariantId'])
@Index(['createdAt'])
export class InventoryMovement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  productVariantId!: string;

  @ManyToOne(() => ProductVariant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productVariantId' })
  productVariant!: ProductVariant;

  @Column({ type: 'enum', enum: MovementType })
  type!: MovementType;

  /** Not meaningful for `PriceChanged` (stock is untouched) — 0 in that case. */
  @Column({ type: 'int' })
  quantity!: number;

  /** Not meaningful for `PriceChanged` — same as afterStock in that case. */
  @Column({ type: 'int' })
  beforeStock!: number;

  @Column({ type: 'int' })
  afterStock!: number;

  /** Set only for `PriceChanged` movements. */
  @Column({ type: 'int', nullable: true })
  beforePrice!: number | null;

  /** Set only for `PriceChanged` movements. */
  @Column({ type: 'int', nullable: true })
  afterPrice!: number | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  reason!: string | null;

  /** Set only for brak (write-off) movements — SPEC.md §26.3. */
  @Column({ type: 'enum', enum: BrakReasonCode, nullable: true })
  brakReasonCode!: BrakReasonCode | null;

  /** Free-text detail — required by the API when brakReasonCode = 'other'. */
  @Column({ type: 'text', nullable: true })
  brakReasonNote!: string | null;

  @Column({ type: 'uuid', nullable: true })
  orderId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  performedByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
