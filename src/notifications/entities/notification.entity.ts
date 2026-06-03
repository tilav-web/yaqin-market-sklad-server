import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A delivered notification kept for a user's in-app inbox. One row per
 * recipient (so broadcasts fan out to many rows). The matching push is sent
 * separately; this is the readable history with an unread flag.
 */
@Entity({ name: 'notifications' })
@Index(['userId', 'createdAt'])
@Index(['userId', 'isRead'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 128 })
  title!: string;

  @Column({ type: 'varchar', length: 512 })
  body!: string;

  /** Free-form payload (e.g. { kind, orderId, shopId }) for tap routing. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  data!: Record<string, unknown>;

  /** Short category for icon/grouping (order, chat, stock, admin, …). */
  @Column({ type: 'varchar', length: 32, default: 'general' })
  kind!: string;

  @Column({ type: 'boolean', default: false })
  isRead!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
