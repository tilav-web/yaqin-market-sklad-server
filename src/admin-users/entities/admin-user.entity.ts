import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AdminRole {
  SuperAdmin = 'super_admin',
  Admin = 'admin',
  Moderator = 'moderator',
  Support = 'support',
  Finance = 'finance',
  ContentManager = 'content_manager',
}

export const ALL_ADMIN_ROLES = Object.values(AdminRole);

@Entity({ name: 'admin_users' })
export class AdminUser {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  username!: string;

  @Column({ type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 64 })
  firstName!: string;

  @Column({ type: 'varchar', length: 64 })
  lastName!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'enum', enum: AdminRole, default: AdminRole.Admin })
  role!: AdminRole;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  permissions!: string[];

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  /** Tizimning asosiy o'chmas va bloklanmas Root SuperAdmini */
  @Column({ type: 'boolean', default: false })
  isProtected!: boolean;

  @Column({ type: 'varchar', length: 512, nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  createdByAdminId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
