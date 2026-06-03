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

import { Shop } from '../../shops/entities/shop.entity';
import { ProductFamily } from './product-family.entity';

export type UnitType = 'piece' | 'kg' | 'liter' | 'gram' | 'pack';

@Entity({ name: 'product_variants' })
@Index(['shopId'])
@Index(['productFamilyId'])
@Index(['barcode'])
export class ProductVariant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  shopId!: string;

  @ManyToOne(() => Shop, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shopId' })
  shop!: Shop;

  @Column({ type: 'uuid' })
  productFamilyId!: string;

  @ManyToOne(() => ProductFamily, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productFamilyId' })
  productFamily!: ProductFamily;

  @Column({ type: 'varchar', length: 256 })
  name!: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  photos!: string[];

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'piece' })
  unitType!: UnitType;

  @Column({ type: 'double precision', default: 1 })
  unitSize!: number;

  @Column({ type: 'int' })
  price!: number;

  @Column({ type: 'int', nullable: true })
  discountPrice!: number | null;

  @Column({ type: 'int', default: 0 })
  stock!: number;

  @Column({ type: 'int', default: 5 })
  lowStockThreshold!: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  barcode!: string | null;

  /** Links this shop offering to the shared catalogue entry (by barcode). */
  @Column({ type: 'uuid', nullable: true })
  globalProductId!: string | null;

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
