import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { PrimePlan } from './prime-plan.entity';

@Entity({ name: 'seller_subscriptions' })
@Index(['sellerId', 'isActive'])
export class SellerSubscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sellerId!: string;

  @Column({ type: 'uuid' })
  planId!: string;

  @ManyToOne(() => PrimePlan)
  @JoinColumn({ name: 'planId' })
  plan!: PrimePlan;

  /** Snapshot at purchase time — won't change even if plan changes */
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  commissionRateSnapshot!: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  priceSnapshot!: string;

  @Column({ type: 'date' })
  startDate!: string;

  @Column({ type: 'date' })
  endDate!: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
