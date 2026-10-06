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
import { Conversation } from './conversation.entity';

@Entity({ name: 'conversation_messages' })
@Index(['conversationId', 'createdAt'])
export class ConversationMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  conversationId!: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation!: Conversation;

  @Column({ type: 'uuid' })
  senderUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'senderUserId' })
  sender!: User;

  @Column({ type: 'boolean' })
  fromShop!: boolean;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'uuid', nullable: true })
  attachedProductId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  attachedOrderNumber!: string | null;

  @Column({ type: 'text', nullable: true })
  photoUrl!: string | null;

  @Column({ type: 'boolean', default: false })
  isRead!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
