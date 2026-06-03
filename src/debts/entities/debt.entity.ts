import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** One line of a credit sale. variantId is null for off-system (manual) items. */
export interface DebtLine {
  variantId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/**
 * A single credit sale ("qarzga berildi") — the shop hands goods to a known
 * customer to be paid later. Items can be real catalogue products (optionally
 * decremented from stock) plus a free "extra charge" for things not in the
 * system. Customers are identified by phone number (the ledger groups by it).
 */
@Entity({ name: 'debts' })
@Index(['shopId'])
@Index(['shopId', 'customerPhone'])
export class Debt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  shopId!: string;

  @Column({ type: 'varchar', length: 128 })
  customerName!: string;

  @Column({ type: 'varchar', length: 32 })
  customerPhone!: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  lines!: DebtLine[];

  /** Sum of the product lines. */
  @Column({ type: 'int', default: 0 })
  itemsTotal!: number;

  /** Manual surcharge for off-system goods or fees. */
  @Column({ type: 'int', default: 0 })
  extraCharge!: number;

  /** itemsTotal + extraCharge. */
  @Column({ type: 'int' })
  total!: number;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  /** Whether the catalogue lines were drawn down from inventory. */
  @Column({ type: 'boolean', default: false })
  stockDecremented!: boolean;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
