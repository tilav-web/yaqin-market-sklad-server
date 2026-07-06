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

/**
 * A device's Expo push token. `userId` is NULL for an anonymous device (the app
 * registers its token on first launch, before login); once the user logs in we
 * stamp their id onto the same token row so their notifications start flowing.
 * One row per token; a user may have several (multi-device).
 */
@Entity({ name: 'device_tokens' })
@Index(['userId'])
export class DeviceToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Null until the device's user logs in (then linked to that user).
  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User | null;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 256 })
  token!: string;

  @Column({ type: 'varchar', length: 16, default: 'android' })
  platform!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
