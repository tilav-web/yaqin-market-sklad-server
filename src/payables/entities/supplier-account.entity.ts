import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Kinds of external creditor a shop can owe money to. */
export const PAYABLE_CATEGORIES = [
  'supplier',
  'rent',
  'utility',
  'loan',
  'salary',
  'other',
] as const;
export type PayableCategory = (typeof PAYABLE_CATEGORIES)[number];

/**
 * A creditor the shop owes money to — a supplier/wholesaler, landlord,
 * utility company, lender, employee, etc. Mirrors `Debt`'s customer ledger
 * but in the opposite direction: here the shop is the debtor, not the payee.
 */
@Entity({ name: 'supplier_accounts' })
@Index(['shopId'])
export class SupplierAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  shopId!: string;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'varchar', length: 24 })
  category!: PayableCategory;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'boolean', default: false })
  isArchived!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
