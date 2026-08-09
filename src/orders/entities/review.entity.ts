import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { ProductVariant } from '../../products/entities/product-variant.entity';
import { Shop } from '../../shops/entities/shop.entity';
import { User } from '../../users/entities/user.entity';
import { Order } from './order.entity';

export enum ReviewTarget {
  Product = 'product',
  Courier = 'courier',
  Shop = 'shop',
}

@Entity({ name: 'reviews' })
@Unique(['userId', 'orderId', 'target', 'productVariantId'])
@Index(['productVariantId'])
@Index(['courierUserId'])
@Index(['shopId'])
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'enum', enum: ReviewTarget, default: ReviewTarget.Product })
  target!: ReviewTarget;

  /** Set only when target = product. */
  @Column({ type: 'uuid', nullable: true })
  productVariantId!: string | null;

  @ManyToOne(() => ProductVariant, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'productVariantId' })
  productVariant!: ProductVariant | null;

  /** Set only when target = courier — the User.id who confirmed delivery (Order.deliveredByUserId). */
  @Column({ type: 'uuid', nullable: true })
  courierUserId!: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'courierUserId' })
  courier!: User | null;

  /** Set only when target = shop. */
  @Column({ type: 'uuid', nullable: true })
  shopId!: string | null;

  @ManyToOne(() => Shop, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'shopId' })
  shop!: Shop | null;

  @Column({ type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order!: Order;

  @Column({ type: 'smallint' })
  stars!: number;

  @Column({ type: 'text', nullable: true })
  text!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
