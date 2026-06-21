import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { Shop } from '../../shops/entities/shop.entity';
import { GlobalProduct } from './global-product.entity';

/** One shop's commercial offering of a GlobalProduct (price, stock, discounts). */
@Entity({ name: 'product_variants' })
@Index(['shopId'])
@Index(['shopId', 'isActive', 'createdAt'])
@Index(['globalProductId'])
@Unique(['shopId', 'globalProductId'])
export class ProductVariant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  shopId!: string;

  @ManyToOne(() => Shop, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shopId' })
  shop!: Shop;

  @Column({ type: 'uuid' })
  globalProductId!: string;

  @ManyToOne(() => GlobalProduct, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'globalProductId' })
  globalProduct!: GlobalProduct;

  @Column({ type: 'int' })
  price!: number;

  @Column({ type: 'int', nullable: true })
  discountPrice!: number | null;

  /** Cached sum of FIFO batch quantities. Updated by receiveBatch/consumeFifo. */
  @Column({ type: 'int', default: 0 })
  stock!: number;

  @Column({ type: 'int', default: 5 })
  lowStockThreshold!: number;

  /** Critical level: triggers immediate push (null = GlobalSetting default). */
  @Column({ type: 'int', nullable: true })
  criticalThreshold!: number | null;

  @Column({ type: 'date', nullable: true })
  expiryDate!: Date | null;

  @Column({ type: 'double precision', default: 0 })
  ratingAverage!: number;

  @Column({ type: 'int', default: 0 })
  ratingCount!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
