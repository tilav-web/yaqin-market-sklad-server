import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum WithdrawalStatus {
  Pending = 'pending',
  Processing = 'processing',
  Completed = 'completed',
  Rejected = 'rejected',
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

  @Column({ type: 'uuid', nullable: true })
  shopId!: string | null;

  /** Legacy card number or optional fallback */
  @Column({ type: 'varchar', length: 32, nullable: true })
  bankCardNumber!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  bankCardHolderName!: string | null;

  /** 20-digit bank account number for B2B payment order */
  @Column({ type: 'varchar', length: 32, nullable: true })
  bankAccountNumber!: string | null;

  /** 5-digit bank MFO code */
  @Column({ type: 'varchar', length: 16, nullable: true })
  bankMfo!: string | null;

  /** Bank name */
  @Column({ type: 'varchar', length: 128, nullable: true })
  bankName!: string | null;

  /** Recipient / Account holder name */
  @Column({ type: 'varchar', length: 128, nullable: true })
  recipientName!: string | null;

  @Column({
    type: 'enum',
    enum: WithdrawalStatus,
    default: WithdrawalStatus.Pending,
  })
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
