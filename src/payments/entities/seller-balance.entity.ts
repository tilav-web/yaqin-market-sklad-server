import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'seller_balances' })
export class SellerBalance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  sellerId!: string;

  /** Waiting 24h settlement — cannot be withdrawn */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  pendingBalance!: string;

  /** Available for withdrawal */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  availableBalance!: string;

  /** Owed to platform (accumulated cash commissions) */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  debtBalance!: string;

  /** Debt must be paid by this date; null = no debt */
  @Column({ type: 'date', nullable: true })
  debtDueDate!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastDebtReminderAt!: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
