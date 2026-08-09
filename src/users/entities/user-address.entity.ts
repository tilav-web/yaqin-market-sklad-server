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

import { LocationEvidence } from '../../geo/location-evidence';
import { User } from './user.entity';

@Entity({ name: 'user_addresses' })
@Index(['userId'])
export class UserAddress {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar', length: 64 })
  label!: string;

  @Column({ type: 'varchar', length: 512 })
  address!: string;

  @Column({ type: 'double precision' })
  latitude!: number;

  @Column({ type: 'double precision' })
  longitude!: number;

  @Column({ type: 'varchar', length: 256, nullable: true })
  notes!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  entrance!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  floor!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  apartment!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  intercom!: string | null;

  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  /**
   * Device fix at the moment this pin was last set (create or lat/lng
   * edit) — anti-fraud evidence, wired up once `address_far_from_device`
   * (currently shipped disabled) is enabled. Not populated yet.
   */
  @Column({ type: 'jsonb', nullable: true })
  pinEvidence!: LocationEvidence | null;

  /** How many times the coordinates have been changed. Not populated yet. */
  @Column({ type: 'int', default: 0 })
  pinSetCount!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
