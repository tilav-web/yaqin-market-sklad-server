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
}

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  phone!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  name!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.Active })
  status!: UserStatus;

  @Column({ type: 'boolean', default: false })
  isSellerApproved!: boolean;

  @Column({ type: 'boolean', default: false })
  isAdmin!: boolean;

  /**
   * Cached set of roles for the user. Derived from other columns
   * (always `customer`, plus `seller`/`admin` when applicable) and from
   * `shop_staff` membership. Refreshed at login and on role-changing events.
   */
  @Column({ type: 'jsonb', default: () => "'[\"customer\"]'::jsonb" })
  roles!: string[];

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
