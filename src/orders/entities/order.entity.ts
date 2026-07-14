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

export enum PaymentStatus {
  /** Cash order — no online payment needed. */
  NotRequired = 'not_required',
  /** click_online order awaiting payment. */
  Pending = 'pending',
  /** Payment confirmed by Click webhook. */
  Paid = 'paid',
  /** Payment failed or cancelled. */
  Failed = 'failed',
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

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.NotRequired })
  paymentStatus!: PaymentStatus;

  @Column({ type: 'uuid', nullable: true })
  acceptedByStaffId!: string | null;

  /** ShopStaff.id this order is assigned to (e.g. the delivering courier). */
  @Column({ type: 'uuid', nullable: true })
  assignedStaffId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  deliveredByStaffId!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  timeline!: OrderTimelineEvent[];

  @Column({ type: 'text', nullable: true })
  cancellationReason!: string | null;

  /** Optional reason the customer adds (later) for returned items. */
  @Column({ type: 'text', nullable: true })
  returnReason!: string | null;

  /**
   * Commission % captured at order-creation time (seller's Prime rate or the
   * then-current global default). Settlement uses THIS value, never whatever
   * rate happens to be active later — a rate change must only affect new
   * orders, not ones already placed (SPEC §10.1).
   */
  @Column({ type: 'double precision', nullable: true })
  commissionRateSnapshot!: number | null;

  /**
   * Admin-set flag — this order is charged 0% commission regardless of
   * `commissionRateSnapshot` (SPEC §10.3, e.g. an admin test order or an
   * order cancelled due to a platform bug). Only takes effect if set BEFORE
   * the order reaches `Delivered` — settlement runs once, at that
   * transition, and is not retroactively reversible after the fact.
   */
  @Column({ type: 'boolean', default: false })
  commissionExempt!: boolean;

  /** Set once the "please rate your order" reminder push has been sent (avoids repeat spam). */
  @Column({ type: 'timestamptz', nullable: true })
  reviewReminderSentAt!: Date | null;

  /**
   * Set once the "you have a paid order still unaccepted" urgent nudge has
   * been sent to the shop. A paid online order is never auto-cancelled (no
   * automated refund path exists) — this alert is the fallback so it
   * doesn't just sit there unnoticed instead.
   */
  @Column({ type: 'timestamptz', nullable: true })
  paidUnacceptedAlertSentAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
