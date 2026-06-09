import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** A reusable title/body the admin can pick when broadcasting notifications. */
@Entity({ name: 'notification_templates' })
export class NotificationTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'varchar', length: 128 })
  title!: string;

  @Column({ type: 'varchar', length: 512 })
  body!: string;

  @Column({ type: 'text', nullable: true })
  richBody?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
