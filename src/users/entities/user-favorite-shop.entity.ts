import {
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Column,
} from 'typeorm';

import { Shop } from '../../shops/entities/shop.entity';
import { User } from './user.entity';

@Entity({ name: 'user_favorite_shops' })
@Index(['userId', 'shopId'], { unique: true })
@Index(['shopId'])
export class UserFavoriteShop {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'uuid' })
  shopId!: string;

  @ManyToOne(() => Shop, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shopId' })
  shop!: Shop;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
