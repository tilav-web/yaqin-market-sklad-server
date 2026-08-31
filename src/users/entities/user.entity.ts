import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserStatus {
  Active = 'active',
  Blocked = 'blocked',
  Deleted = 'deleted',
}

export enum UserGender {
  Male = 'male',
  Female = 'female',
}

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  phone!: string;

  /** Full display name — kept in sync from firstName+lastName */
  @Column({ type: 'varchar', length: 128, nullable: true })
  name!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  firstName!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  lastName!: string | null;

  @Column({ type: 'date', nullable: true })
  birthDate!: string | null;

  @Column({ type: 'enum', enum: UserGender, nullable: true })
  gender!: UserGender | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.Active })
  status!: UserStatus;

  /**
   * Effective role list for the user (customer, seller, staff, admin).
   * Derived from permissions, SellerProfile and ShopStaff memberships.
   */
  @Column({ type: 'jsonb', default: () => '\'["customer"]\'::jsonb' })
  roles!: string[];

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  deletionReason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
