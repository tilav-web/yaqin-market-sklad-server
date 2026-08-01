import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';

export enum SellerApplicationStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
}

@Entity({ name: 'seller_applications' })
@Index(['userId'])
@Index(['status'])
export class SellerApplication {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar', length: 64 })
  firstName!: string;

  @Column({ type: 'varchar', length: 64 })
  lastName!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  contactPhone!: string | null;

  /** STIR — komissioner modelida chek chiqarish uchun majburiy rekvizit. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  stir!: string | null;

  /** YaTT, MChJ, AJ... — soliq rejimini tushunish uchun arizada so'raladi. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  entityType!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({
    type: 'enum',
    enum: SellerApplicationStatus,
    default: SellerApplicationStatus.Pending,
  })
  status!: SellerApplicationStatus;

  @Column({ type: 'text', nullable: true })
  rejectionReason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedByUserId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
