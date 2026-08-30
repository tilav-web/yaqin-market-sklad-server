import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ComplaintStatus {
  Open = 'open',
  Resolved = 'resolved',
}

/**
 * Customer dispute over a delivered order, raised within the same
 * escrow-protection window used for pending-transaction settlement
 * (SPEC.md §8.5, §21). Admin reviews and acts via the existing
 * adminForceSettle/adminForceRefund endpoints in payments.service.ts once
 * resolved here.
 */
@Entity({ name: 'order_complaints' })
@Index(['orderId'], { unique: true })
@Index(['shopId'])
@Index(['status'])
export class OrderComplaint {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  orderId!: string;

  @Column({ type: 'uuid' })
  customerId!: string;

  @Column({ type: 'uuid' })
  shopId!: string;

  @Column({ type: 'varchar', length: 256 })
  reason!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({
    type: 'enum',
    enum: ComplaintStatus,
    default: ComplaintStatus.Open,
  })
  status!: ComplaintStatus;

  @Column({ type: 'text', nullable: true })
  resolution!: string | null;

  @Column({ type: 'uuid', nullable: true })
  resolvedByAdminId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;
}
