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

import { Shop } from '../../shops/entities/shop.entity';
import { User } from '../../users/entities/user.entity';

@Entity({ name: 'conversations' })
@Index(['shopId', 'customerId'], { unique: true })
@Index(['customerId', 'lastMessageAt'])
@Index(['shopId', 'lastMessageAt'])
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  shopId!: string;

  @ManyToOne(() => Shop, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shopId' })
  shop!: Shop;

  @Column({ type: 'uuid' })
  customerId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customerId' })
  customer!: User;

  @Column({ type: 'text', nullable: true })
  lastMessageText!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastMessageAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  unreadCountCustomer!: number;

  @Column({ type: 'int', default: 0 })
  unreadCountShop!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
