import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { Shop } from './shop.entity';

export type StaffPreset = 'kassir' | 'menejer' | 'sklad' | 'yetkazib_beruvchi' | 'custom';

export const ALL_STAFF_PERMISSIONS = [
  // inventory
  'inventory.view',
  'inventory.product.create',
  'inventory.product.edit_info',
  'inventory.product.edit_price',
  'inventory.product.edit_stock',
  'inventory.receive',
  'inventory.count',
  'inventory.movement.view',
  'inventory.low_stock_alerts',
  'inventory.barcode.scan',
  // sales (in-store POS)
  'sales.instore',
  // orders
  'orders.view_all',
  'orders.view_assigned',
  'orders.accept',
  'orders.update_status',
  'orders.cancel',
  'orders.chat',
  'orders.view_customer_contact',
  // shop (limited)
  'shop.toggle_open',
  'shop.settings.view',
  // debt ledger (qarz daftar)
  'debt.manage',
  // reviews
  'reviews.view',
  // promotions
  'promotions.view',
  'promotions.manage',
] as const;

export type StaffPermission = (typeof ALL_STAFF_PERMISSIONS)[number];

export const PRESET_PERMISSIONS: Record<Exclude<StaffPreset, 'custom'>, StaffPermission[]> = {
  kassir: [
    'inventory.view',
    'inventory.product.edit_stock',
    'inventory.barcode.scan',
    'sales.instore',
    'orders.view_all',
    'orders.accept',
    'orders.update_status',
    'orders.chat',
    'orders.view_customer_contact',
    'debt.manage',
  ],
  menejer: [
    'inventory.view',
    'inventory.product.create',
    'inventory.product.edit_info',
    'inventory.product.edit_price',
    'inventory.product.edit_stock',
    'inventory.receive',
    'inventory.count',
    'inventory.movement.view',
    'inventory.low_stock_alerts',
    'inventory.barcode.scan',
    'sales.instore',
    'orders.view_all',
    'orders.accept',
    'orders.update_status',
    'orders.cancel',
    'orders.chat',
    'orders.view_customer_contact',
    'reviews.view',
    'shop.toggle_open',
    'shop.settings.view',
    'debt.manage',
    'promotions.view',
    'promotions.manage',
  ],
  sklad: [
    'inventory.view',
    'inventory.product.create',
    'inventory.product.edit_info',
    'inventory.product.edit_stock',
    'inventory.receive',
    'inventory.count',
    'inventory.movement.view',
    'inventory.low_stock_alerts',
    'inventory.barcode.scan',
  ],
  yetkazib_beruvchi: [
    'orders.view_assigned',
    'orders.update_status',
    'orders.chat',
    'orders.view_customer_contact',
  ],
};

/**
 * Business rule: a staff member works for a single owner only (one user
 * cannot be active staff at shops owned by two different sellers at once).
 * There is intentionally no DB-level CHECK/EXCLUDE constraint enforcing
 * this — it spans rows in the `shops` table (via shop.ownerId) and can't be
 * expressed as a simple constraint scoped to this table alone (it would
 * need a cross-table trigger). Race-safety is instead handled at the
 * application level in shops.service.ts#acceptStaffInvitation, which locks
 * the target User row before checking existing memberships so two
 * concurrent invitation-accepts for the same user can't both pass.
 */
@Entity({ name: 'shop_staff' })
@Unique(['shopId', 'userId'])
@Index(['shopId'])
@Index(['userId'])
export class ShopStaff {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  shopId!: string;

  @ManyToOne(() => Shop, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shopId' })
  shop!: Shop;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar', length: 64 })
  customRoleName!: string;

  @Column({ type: 'varchar', length: 32, default: 'custom' })
  preset!: StaffPreset;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  permissions!: StaffPermission[];

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  removedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
