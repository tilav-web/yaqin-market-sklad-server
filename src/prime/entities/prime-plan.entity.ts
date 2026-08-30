import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { LocalizedText } from '../../common/types/localized-text.type';

@Entity({ name: 'prime_plans' })
export class PrimePlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'jsonb',
    default: () => '\'{"uz":"","kr":"","ru":""}\'::jsonb',
  })
  name!: LocalizedText;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  monthlyPrice!: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  yearlyPrice!: string | null;

  /** Commission % for subscribers of this plan */
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  commissionRate!: string;

  @Column({ type: 'jsonb', nullable: true })
  description!: LocalizedText | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
