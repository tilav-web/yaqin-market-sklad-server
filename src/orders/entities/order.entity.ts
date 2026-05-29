import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Shop } from '../../shops/entities/shop.entity';
import { UserAddress } from '../../users/entities/user-address.entity';
import { User } from '../../users/entities/user.entity';
import { OrderItem } from './order-item.entity';

export enum OrderStatus {
  New = 'new',
  Accepted = 'accepted',
  Preparing = 'preparing',
  Delivering = 'delivering',
  Delivered = 'delivered',
  Cancelled = 'cancelled',
}

export enum PaymentMethod {
  Cash = 'cash',
  ClickOnline = 'click_online',
}

export interface OrderTimelineEvent {
  status: OrderStatus;
  at: string;
  byUserId?: string | null;
  note?: string;
}

@Entity({ name: 'orders' })
@Index(['userId'])
@Index(['shopId'])
@Index(['status'])
@Index(['createdAt'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'uuid' })
  shopId!: string;

  @ManyToOne(() => Shop, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shopId' })
  shop!: Shop;

  @Column({ type: 'uuid' })
  deliveryAddressId!: string;

  @ManyToOne(() => UserAddress, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'deliveryAddressId' })
  deliveryAddress!: UserAddress;

  @Column({ type: 'varchar', length: 32 })
  orderNumber!: string;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: ['insert'] })
  items!: OrderItem[];

  @Column({ type: 'int' })
  subTotal!: number;

  @Column({ type: 'int' })
  deliveryFee!: number;

  @Column({ type: 'int' })
  total!: number;

  @Column({ type: 'double precision' })
  distanceKm!: number;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.New })
  status!: OrderStatus;

  @Column({ type: 'enum', enum: PaymentMethod, default: PaymentMethod.Cash })
  paymentMethod!: PaymentMethod;

  @Column({ type: 'uuid', nullable: true })
  acceptedByStaffId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  deliveredByStaffId!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  timeline!: OrderTimelineEvent[];

  @Column({ type: 'text', nullable: true })
  cancellationReason!: string | null;

  /** Optional reason the customer adds (later) for returned items. */
  @Column({ type: 'text', nullable: true })
  returnReason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
