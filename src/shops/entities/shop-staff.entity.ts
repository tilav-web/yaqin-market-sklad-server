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
  'inventory.movement.view',
  'inventory.low_stock_alerts',
  'inventory.barcode.scan',
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
  // reviews
  'reviews.view',
] as const;

export type StaffPermission = (typeof ALL_STAFF_PERMISSIONS)[number];

export const PRESET_PERMISSIONS: Record<Exclude<StaffPreset, 'custom'>, StaffPermission[]> = {
  kassir: [
    'inventory.view',
    'inventory.product.edit_stock',
    'orders.view_all',
    'orders.accept',
    'orders.update_status',
    'orders.chat',
    'orders.view_customer_contact',
  ],
  menejer: [
    'inventory.view',
    'inventory.product.create',
    'inventory.product.edit_info',
    'inventory.product.edit_price',
    'inventory.product.edit_stock',
    'inventory.movement.view',
    'inventory.low_stock_alerts',
    'inventory.barcode.scan',
    'orders.view_all',
    'orders.accept',
    'orders.update_status',
    'orders.cancel',
    'orders.chat',
    'orders.view_customer_contact',
    'reviews.view',
    'shop.toggle_open',
    'shop.settings.view',
  ],
  sklad: [
    'inventory.view',
    'inventory.product.create',
    'inventory.product.edit_info',
    'inventory.product.edit_stock',
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
