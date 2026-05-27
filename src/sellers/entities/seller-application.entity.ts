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

  @Column({ type: 'varchar', length: 128 })
  shopName!: string;

  @Column({ type: 'varchar', length: 512 })
  shopAddress!: string;

  @Column({ type: 'double precision' })
  shopLatitude!: number;

  @Column({ type: 'double precision' })
  shopLongitude!: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  shopPhotos!: string[];

  @Column({ type: 'varchar', length: 64, nullable: true })
  stir!: string | null;

  @Column({ type: 'enum', enum: SellerApplicationStatus, default: SellerApplicationStatus.Pending })
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
