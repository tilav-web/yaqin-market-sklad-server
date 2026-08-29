import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Shop } from './shop.entity';
import type { StaffPermission, StaffPreset, StaffRole } from './shop-staff.entity';

export enum StaffInvitationStatus {
  Pending = 'pending',
  Accepted = 'accepted',
  Rejected = 'rejected',
  Expired = 'expired',
}

@Entity({ name: 'staff_invitations' })
@Index(['shopId'])
@Index(['qrToken'], { unique: true })
export class StaffInvitation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  shopId!: string;

  @ManyToOne(() => Shop, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shopId' })
  shop!: Shop;

  @Column({ type: 'uuid' })
  invitedByUserId!: string;

  @Column({ type: 'varchar', length: 64 })
  customRoleName!: string;

  @Column({ type: 'varchar', length: 32 })
  preset!: StaffPreset;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  roles!: StaffRole[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  permissions!: StaffPermission[];

  @Column({ type: 'varchar', length: 64 })
  qrToken!: string;

  @Column({ type: 'enum', enum: StaffInvitationStatus, default: StaffInvitationStatus.Pending })
  status!: StaffInvitationStatus;

  @Column({ type: 'uuid', nullable: true })
  acceptedByUserId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
