import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Category } from '../../categories/entities/category.entity';
import { ProductVariant } from '../../products/entities/product-variant.entity';

export type PromotionType =
  | 'product_discount'
  | 'category_discount'
  | 'free_delivery';
export type DiscountType = 'percent' | 'fixed';

import type { LocalizedText } from '../../common/types/localized-text.type';

@Entity({ name: 'promotions' })
@Index(['shopId'])
@Index(['shopId', 'isActive'])
export class Promotion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  shopId!: string;

  @Column({
    type: 'jsonb',
    default: () => '\'{"uz":"","kr":"","ru":""}\'::jsonb',
  })
  name!: LocalizedText;

  @Column({ type: 'varchar', length: 32 })
  type!: PromotionType;

  @Column({ type: 'varchar', length: 16, nullable: true })
  discountType!: DiscountType | null;

  @Column({ type: 'int', nullable: true })
  discountValue!: number | null;

  @Column({ type: 'uuid', nullable: true })
  targetProductId!: string | null;

  @ManyToOne(() => ProductVariant, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'targetProductId' })
  targetProduct!: ProductVariant | null;

  @Column({ type: 'uuid', nullable: true })
  targetCategoryId!: string | null;

  @ManyToOne(() => Category, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'targetCategoryId' })
  targetCategory!: Category | null;

  @Column({ type: 'int', nullable: true })
  freeDeliveryMinAmount!: number | null;

  @Column({ type: 'timestamptz' })
  startAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endAt!: Date | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'uuid' })
  createdByUserId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
