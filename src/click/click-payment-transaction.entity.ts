import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ClickTxStatus {
  Pending = 'pending',
  Success = 'success',
  Cancelled = 'cancelled',
}

@Entity('click_payment_transaction')
export class ClickPaymentTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // One transaction row per order — prepare() reuses/updates it across
  // retries instead of creating a new one, so this must be unique to catch
  // any duplicate insert race from concurrent webhook calls at the DB level.
  @Index({ unique: true })
  @Column({ type: 'uuid' })
  orderId!: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  clickTransId!: string | null;

  // Set instead of clickTransId when the order was paid via the Merchant API
  // card_token/payment call (saved-card flow) rather than the Shop API
  // prepare/complete webhooks — that flow has no click_trans_id at all.
  @Column({ type: 'varchar', nullable: true })
  clickPaymentId!: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount!: string;

  @Column({ type: 'enum', enum: ClickTxStatus, default: ClickTxStatus.Pending })
  status!: ClickTxStatus;

  // Populated when Click's Merchant API declines a card_token/payment call
  // (status -> Cancelled) — kept alongside the raw note so a future lookup
  // table can be backfilled from real-world codes without losing history.
  @Column({ type: 'int', nullable: true })
  errorCode!: number | null;

  @Column({ type: 'varchar', nullable: true })
  errorNote!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
