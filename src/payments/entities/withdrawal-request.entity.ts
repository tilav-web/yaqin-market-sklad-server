import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum WithdrawalStatus {
  Pending    = 'pending',
  Processing = 'processing',
  Completed  = 'completed',
  Rejected   = 'rejected',
}

@Entity({ name: 'withdrawal_requests' })
@Index(['sellerId', 'status'])
export class WithdrawalRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sellerId!: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount!: string;

  /** Snapshot at request time */
  @Column({ type: 'varchar', length: 16 })
  bankCardNumber!: string;

  @Column({ type: 'varchar', length: 128 })
  bankCardHolderName!: string;

  @Column({ type: 'enum', enum: WithdrawalStatus, default: WithdrawalStatus.Pending })
  status!: WithdrawalStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  requestedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  processedByAdminId!: string | null;

  @Column({ type: 'text', nullable: true })
  adminNote!: string | null;
}
