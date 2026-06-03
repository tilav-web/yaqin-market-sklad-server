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

export enum OrderChannel {
  /** Customer placed it in the app for delivery. */
  Delivery = 'delivery',
  /** Seller rang it up at the counter (walk-in, paid on the spot). */
  InStore = 'in_store',
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

  // Null for in-store walk-in sales (no app customer).
  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'userId' })
  user!: User | null;

  @Column({ type: 'uuid' })
  shopId!: string;

  @ManyToOne(() => Shop, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shopId' })
  shop!: Shop;

  // Null for in-store sales (no delivery).
  @Column({ type: 'uuid', nullable: true })
  deliveryAddressId!: string | null;

  @ManyToOne(() => UserAddress, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'deliveryAddressId' })
  deliveryAddress!: UserAddress | null;

  @Column({ type: 'enum', enum: OrderChannel, default: OrderChannel.Delivery })
  channel!: OrderChannel;

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
