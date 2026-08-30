import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum SellerTxType {
  CashOrderCommission = 'cash_order_commission', // naqd buyurtma → qarzga
  OnlineOrderPending = 'online_order_pending', // online buyurtma → pending
  PendingSettled = 'pending_settled', // 24h → available
  DebtRepaid = 'debt_repaid', // qarz so'ndirildi
  WithdrawalRequested = 'withdrawal_requested', // yechib olish so'rovi
  WithdrawalCompleted = 'withdrawal_completed', // yechib olish bajarildi
  PrimePayment = 'prime_payment', // prime obuna to'lovi
  AdminAdjustment = 'admin_adjustment', // admin qo'lda tuzatish
  RefundDebit = 'refund_debit', // qaytarish (online)
}

@Entity({ name: 'seller_transactions' })
@Index(['sellerId', 'createdAt'])
@Index(['orderId'])
export class SellerTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sellerId!: string;

  @Column({ type: 'uuid', nullable: true })
  orderId!: string | null;

  @Column({ type: 'enum', enum: SellerTxType })
  type!: SellerTxType;

  /** Positive = credit to seller, negative = debit */
  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount!: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  commissionRate!: string | null;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  commissionAmount!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'settled' })
  status!: 'pending' | 'settled' | 'cancelled';

  /** For pending online orders: when this becomes available */
  @Column({ type: 'timestamptz', nullable: true })
  settlesAt!: Date | null;

  @Column({ type: 'text' })
  description!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
