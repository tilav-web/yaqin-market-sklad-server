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

import { Shop } from './shop.entity';
import type { StaffPermission } from './shop-staff.entity';

/**
 * A seller-defined, reusable named permission bundle — the shop-scoped
 * counterpart to the fixed system presets in PRESET_PERMISSIONS (kassir/
 * menejer/sklad/yetkazib_beruvchi). Selecting one when creating an
 * invitation or editing a staff member just COPIES its `permissions` (and
 * `name` as the initial customRoleName) onto that invitation/staff row —
 * it is not a live reference, so renaming or deleting a preset here never
 * retroactively changes anyone already granted from it.
 */
@Entity({ name: 'shop_staff_presets' })
@Unique(['shopId', 'name'])
@Index(['shopId'])
export class ShopStaffPreset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  shopId!: string;

  @ManyToOne(() => Shop, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shopId' })
  shop!: Shop;

  @Column({ type: 'varchar', length: 64 })
  name!: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  permissions!: StaffPermission[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
