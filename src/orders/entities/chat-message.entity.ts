import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { Order } from './order.entity';

/**
 * In-order chat message between the customer and the shop (owner/staff).
 * Both sides read/write the same thread, keyed by `orderId`.
 */
@Entity({ name: 'chat_messages' })
@Index(['orderId', 'createdAt'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order!: Order;

  @Column({ type: 'uuid' })
  senderUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'senderUserId' })
  sender!: User;

  /** True when the sender acted as the shop side (owner/staff), else customer. */
  @Column({ type: 'boolean' })
  fromShop!: boolean;

  @Column({ type: 'text' })
  text!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
