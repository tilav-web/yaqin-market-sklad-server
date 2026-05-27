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

export type DeliveryPricingType = 'flat' | 'per_km' | 'per_500m';

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

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  workingHours!: WorkingHourSlot[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  holidays!: Holiday[];

  @Column({ type: 'boolean', default: true })
  isOpenManual!: boolean;

  @Column({ type: 'int', default: 0 })
  minOrderPrice!: number;

  @Column({ type: 'jsonb', default: () => "'{\"maxKm\":2,\"freeKm\":2,\"pricingType\":\"flat\",\"pricePerStep\":0}'::jsonb" })
  deliveryZone!: DeliveryZone;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  blockedUserIds!: string[];

  @Column({ type: 'double precision', default: 0 })
  ratingAverage!: number;

  @Column({ type: 'int', default: 0 })
  ratingCount!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
