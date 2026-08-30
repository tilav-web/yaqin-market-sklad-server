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

import { User } from '../../users/entities/user.entity';

export interface WorkingHourSlot {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  openTime: string;
  closeTime: string;
  isOpen: boolean;
}

export interface Holiday {
  date: string;
  reason?: string;
}

export type DeliveryPricingType = 'flat' | 'per_km' | 'per_500m' | 'per_100m';

export interface DeliveryZone {
  maxKm: number;
  freeKm: number;
  pricingType: DeliveryPricingType;
  pricePerStep: number;
}

@Entity({ name: 'shops' })
@Index(['ownerId'])
@Index(['isActive'])
export class Shop {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  ownerId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ownerId' })
  owner!: User;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  photos!: string[];

  @Column({ type: 'varchar', length: 512 })
  address!: string;

  @Column({ type: 'double precision' })
  latitude!: number;

  @Column({ type: 'double precision' })
  longitude!: number;

  /**
   * Device fix at the moment this pin was last set — anti-fraud evidence,
   * wired up once `shop_relocated_after_orders` is enabled. Not populated yet.
   */
  @Column({ type: 'jsonb', nullable: true })
  pinEvidence!: import('../../geo/location-evidence').LocationEvidence | null;

  /** Last time latitude/longitude changed. Not populated yet. */
  @Column({ type: 'timestamptz', nullable: true })
  relocatedAt!: Date | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  workingHours!: WorkingHourSlot[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  holidays!: Holiday[];

  @Column({ type: 'boolean', default: true })
  isOpenManual!: boolean;

  /** Whether the shop offers online delivery (false = showcase / in-store only). */
  @Column({ type: 'boolean', default: true })
  isDeliveryEnabled!: boolean;

  /** Whether customer can visit or pick up orders in-store (samovivoz). */
  @Column({ type: 'boolean', default: true })
  isPickupEnabled!: boolean;

  /**
   * Independent delivery schedule (e.g. 24/7 shop but delivery only 09:00-21:00).
   * If empty, defaults to inheriting workingHours.
   */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  deliveryHours!: WorkingHourSlot[];

  /** Contact phone for customer inquiries (especially for in-store showcase shops). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  @Column({ type: 'int', default: 0 })
  minOrderPrice!: number;

  @Column({
    type: 'jsonb',
    default: () =>
      '\'{"maxKm":2,"freeKm":2,"pricingType":"flat","pricePerStep":0}\'::jsonb',
  })
  deliveryZone!: DeliveryZone;

  /** Customer yetkazib berish hududi (GeoJSON Polygon, null = faqat km asosida ishlaydi). */
  @Column({ type: 'jsonb', nullable: true, default: null })
  deliveryPolygon!: import('../../geo/geo.util').GeoJsonPolygon | null;

  /** Tekin yetkazib berish hududi (deliveryPolygon ichida bo'lishi kerak). */
  @Column({ type: 'jsonb', nullable: true, default: null })
  freeDeliveryPolygon!: import('../../geo/geo.util').GeoJsonPolygon | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  blockedUserIds!: string[];

  @Column({ type: 'double precision', default: 0 })
  ratingAverage!: number;

  @Column({ type: 'int', default: 0 })
  ratingCount!: number;

  /**
   * Separate from ratingAverage (which measures PRODUCT quality, averaged
   * from product reviews) — this is the shop/delivery EXPERIENCE, from the
   * customer explicitly rating the shop after delivery (Review.target='shop').
   * Kept distinct rather than merged so neither signal dilutes the other.
   */
  @Column({ type: 'double precision', nullable: true })
  serviceRatingAverage!: number | null;

  @Column({ type: 'int', default: 0 })
  serviceRatingCount!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  /** Set true when shop was deactivated due to overdue debt; cleared when debt is paid */
  @Column({ type: 'boolean', default: false })
  deactivatedByDebt!: boolean;

  /**
   * When the owner last opened this shop's orders. New orders created after
   * this moment are "unseen" and drive the profile notification badge; opening
   * the orders tab refreshes it so the badge clears.
   */
  @Column({ type: 'timestamptz', nullable: true })
  ownerOrdersSeenAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
