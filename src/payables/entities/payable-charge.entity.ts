import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * An increase to what the shop owes a creditor (e.g. goods taken on credit
 * from a supplier, this month's rent). Mirrors `Debt` — the shop-side charge
 * that raises the balance owed.
 */
@Entity({ name: 'payable_charges' })
@Index(['shopId'])
@Index(['shopId', 'accountId'])
export class PayableCharge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  shopId!: string;

  @Column({ type: 'uuid' })
  accountId!: string;

  @Column({ type: 'int' })
  amount!: number;

  @Column({ type: 'varchar', length: 256, nullable: true })
  description!: string | null;

  /** When this charge is due to be paid, if known. */
  @Column({ type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
