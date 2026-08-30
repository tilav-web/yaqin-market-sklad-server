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

export type StaffRole =
  | 'cashier'
  | 'storekeeper'
  | 'courier'
  | 'manager'
  | 'custom';
export type StaffPreset =
  | StaffRole
  | 'kassir'
  | 'sklad'
  | 'yetkazib_beruvchi'
  | 'menejer'
  | 'omborchi'
  | 'kuryer';

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
  // payables — shop's own debts to external creditors (ta'minotchi/ijara/kredit)
  'payables.manage',
  // reviews
  'reviews.view',
  // promotions
  'promotions.view',
  'promotions.manage',
] as const;

export type StaffPermission = (typeof ALL_STAFF_PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<
  'cashier' | 'storekeeper' | 'courier' | 'manager',
  StaffPermission[]
> = {
  cashier: [
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
  storekeeper: [
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
  courier: [
    'orders.view_assigned',
    'orders.update_status',
    'orders.chat',
    'orders.view_customer_contact',
  ],
  manager: [
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
    'payables.manage',
    'promotions.view',
    'promotions.manage',
  ],
};

export const PRESET_PERMISSIONS: Record<string, StaffPermission[]> = {
  ...ROLE_PERMISSIONS,
  kassir: ROLE_PERMISSIONS.cashier,
  sklad: ROLE_PERMISSIONS.storekeeper,
  omborchi: ROLE_PERMISSIONS.storekeeper,
  yetkazib_beruvchi: ROLE_PERMISSIONS.courier,
  kuryer: ROLE_PERMISSIONS.courier,
  menejer: ROLE_PERMISSIONS.manager,
};

export function computePermissionsForRoles(
  roles: string[],
  customPerms: StaffPermission[] = [],
): StaffPermission[] {
  const permSet = new Set<StaffPermission>(customPerms);
  for (const role of roles) {
    const perms =
      PRESET_PERMISSIONS[role] ||
      ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
    if (perms) {
      for (const p of perms) {
        permSet.add(p);
      }
    }
  }
  return Array.from(permSet);
}

export function normalizeToStaffRole(roleOrPreset?: string | null): StaffRole {
  if (!roleOrPreset) return 'custom';
  const map: Record<string, StaffRole> = {
    cashier: 'cashier',
    kassir: 'cashier',
    storekeeper: 'storekeeper',
    sklad: 'storekeeper',
    omborchi: 'storekeeper',
    courier: 'courier',
    kuryer: 'courier',
    yetkazib_beruvchi: 'courier',
    manager: 'manager',
    menejer: 'manager',
    custom: 'custom',
  };
  return map[roleOrPreset] || 'custom';
}

export function formatRolesDisplayName(roles: string[]): string {
  const map: Record<string, string> = {
    cashier: 'Kassir',
    storekeeper: 'Omborchi',
    courier: 'Kuryer',
    manager: 'Menejer',
    kassir: 'Kassir',
    omborchi: 'Omborchi',
    sklad: 'Omborchi',
    kuryer: 'Kuryer',
    yetkazib_beruvchi: 'Kuryer',
    menejer: 'Menejer',
    custom: 'Maxsus',
  };
  const names = roles.map((r) => map[r] || r).filter(Boolean);
  return names.length > 0 ? names.join(', ') : 'Xodim';
}

/**
 * Business rule: a staff member works for a single owner only (one user
 * cannot be active staff at shops owned by two different sellers at once).
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
  roles!: StaffRole[];

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
