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

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ type: 'int' })
  beforeStock!: number;

  @Column({ type: 'int' })
  afterStock!: number;

  @Column({ type: 'varchar', length: 256, nullable: true })
  reason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  orderId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  performedByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
