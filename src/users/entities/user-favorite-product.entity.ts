import {
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Column,
} from 'typeorm';

import { ProductVariant } from '../../products/entities/product-variant.entity';
import { User } from './user.entity';

@Entity({ name: 'user_favorite_products' })
@Index(['userId', 'productId'], { unique: true })
@Index(['productId'])
export class UserFavoriteProduct {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => ProductVariant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product!: ProductVariant;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
