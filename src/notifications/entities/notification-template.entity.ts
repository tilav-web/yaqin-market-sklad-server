import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { LocalizedText } from '../../common/types/localized-text.type';

/** A reusable title/body the admin can pick when broadcasting notifications. */
@Entity({ name: 'notification_templates' })
export class NotificationTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({
    type: 'jsonb',
    default: () => '\'{"uz":"","kr":"","ru":""}\'::jsonb',
  })
  title!: LocalizedText;

  @Column({
    type: 'jsonb',
    default: () => '\'{"uz":"","kr":"","ru":""}\'::jsonb',
  })
  body!: LocalizedText;

  @Column({ type: 'text', nullable: true })
  richBody?: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  imageUrl?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
