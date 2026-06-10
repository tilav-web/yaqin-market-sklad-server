import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type PromotionType = 'product_discount' | 'category_discount' | 'free_delivery';
export type DiscountType = 'percent' | 'fixed';

@Entity({ name: 'promotions' })
@Index(['shopId'])
@Index(['shopId', 'isActive'])
export class Promotion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  shopId!: string;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'varchar', length: 32 })
  type!: PromotionType;

  @Column({ type: 'varchar', length: 16, nullable: true })
  discountType!: DiscountType | null;

  @Column({ type: 'int', nullable: true })
  discountValue!: number | null;

  @Column({ type: 'uuid', nullable: true })
  targetProductId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  targetCategoryId!: string | null;

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
