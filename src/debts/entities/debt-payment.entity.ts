import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** A repayment toward a customer's outstanding balance (partial allowed). */
@Entity({ name: 'debt_payments' })
@Index(['shopId'])
@Index(['shopId', 'customerPhone'])
export class DebtPayment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  shopId!: string;

  @Column({ type: 'varchar', length: 32 })
  customerPhone!: string;

  @Column({ type: 'int' })
  amount!: number;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
