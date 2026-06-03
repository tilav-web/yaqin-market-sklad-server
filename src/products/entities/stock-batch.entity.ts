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

/**
 * A single receiving lot ("kirim") of a product variant, tracked for FIFO
 * cost accounting. Each time the seller receives stock we create one batch with
 * its own unit cost and (optional) expiry. Sales consume the OLDEST non-empty
 * batch first (`receivedAt ASC`), so each sale's cost of goods is the real
 * purchase price of the units that left the shelf.
 *
 * `quantityRemaining` is the source of truth for available stock; the variant's
 * `stock` column is kept as a cached sum of all batches' remaining quantity.
 */
@Entity({ name: 'stock_batches' })
@Index(['productVariantId'])
@Index(['shopId'])
@Index(['productVariantId', 'quantityRemaining'])
@Index(['receivedAt'])
@Index(['expiryDate'])
export class StockBatch {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  productVariantId!: string;

  @ManyToOne(() => ProductVariant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productVariantId' })
  productVariant!: ProductVariant;

  /** Denormalised for fast shop-wide queries (inventory value, expiry alerts). */
  @Column({ type: 'uuid' })
  shopId!: string;

  /** Per-unit purchase cost in so'm. */
  @Column({ type: 'int', default: 0 })
  costPrice!: number;

  /** How many units this lot originally contained. */
  @Column({ type: 'int' })
  quantityReceived!: number;

  /** How many units of this lot are still on the shelf (FIFO drains this). */
  @Column({ type: 'int' })
  quantityRemaining!: number;

  @Column({ type: 'date', nullable: true })
  expiryDate!: Date | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  supplierName!: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  note!: string | null;

  /** True for lots created by customer returns (restocked goods). */
  @Column({ type: 'boolean', default: false })
  isReturn!: boolean;

  @Column({ type: 'uuid', nullable: true })
  performedByUserId!: string | null;

  /** FIFO ordering key — oldest receipt is consumed first. */
  @Column({ type: 'timestamptz' })
  receivedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
