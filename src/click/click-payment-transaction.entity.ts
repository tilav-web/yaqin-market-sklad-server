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

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount!: string;

  @Column({ type: 'enum', enum: ClickTxStatus, default: ClickTxStatus.Pending })
  status!: ClickTxStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
