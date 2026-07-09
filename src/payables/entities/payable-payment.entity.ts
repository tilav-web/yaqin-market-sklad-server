import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** A repayment the shop makes toward a creditor's outstanding balance (partial allowed). */
@Entity({ name: 'payable_payments' })
@Index(['shopId'])
@Index(['shopId', 'accountId'])
export class PayablePayment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  shopId!: string;

  @Column({ type: 'uuid' })
  accountId!: string;

  @Column({ type: 'int' })
  amount!: number;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
