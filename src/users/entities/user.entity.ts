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

  /** Full display name — kept in sync from firstName+lastName when either is
   * set, so existing call sites that only ever read `.name` keep working. */
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

  /** Rolled up from Review rows with target='courier' where this user is courierUserId. */
  @Column({ type: 'double precision', nullable: true })
  courierRatingAverage!: number | null;

  @Column({ type: 'int', default: 0 })
  courierRatingCount!: number;

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

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  favoriteShopIds!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  favoriteProductIds!: string[];

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
