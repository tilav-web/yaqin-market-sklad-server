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

import { User } from '../users/entities/user.entity';

export enum SavedCardStatus {
  /** card_token/request done, waiting for the SMS code via card_token/verify. */
  PendingVerify = 'pending_verify',
  /** Verified — usable for card_token/payment. */
  Active = 'active',
}

/**
 * A card token issued by Click's Merchant API (card_token/request with
 * temporary:0 — persists past a single payment, unlike the Shop API redirect
 * flow which never touches card data at all). `cardToken` is the secret that
 * authorizes charges against this card — it must never be returned to a
 * client or logged; only `cardNumberMasked` is safe to expose.
 */
@Entity('saved_card')
@Index(['userId'])
export class SavedCard {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  /** Click card_token — secret, never exposed via the API. */
  @Column({ type: 'varchar' })
  cardToken!: string;

  /** e.g. "8600 **** **** 1234" — from card_token/verify's card_number field. */
  @Column({ type: 'varchar', nullable: true })
  cardNumberMasked!: string | null;

  /** Phone number Click sent the confirmation SMS to (masked by Click). */
  @Column({ type: 'varchar', nullable: true })
  phoneNumber!: string | null;

  @Column({ type: 'enum', enum: SavedCardStatus, default: SavedCardStatus.PendingVerify })
  status!: SavedCardStatus;

  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
