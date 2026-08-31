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

@Entity({ name: 'seller_bank_accounts' })
@Index(['userId'])
export class SellerBankAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  /** 20-digit bank account number (e.g. 20208000...) */
  @Column({ type: 'varchar', length: 32 })
  accountNumber!: string;

  /** 5-digit bank MFO code (e.g. 00444) */
  @Column({ type: 'varchar', length: 16 })
  mfo!: string;

  /** Bank branch name (e.g. "AT Xalq Banki Toshkent sh.") */
  @Column({ type: 'varchar', length: 128 })
  bankName!: string;

  /** Account holder or company name (e.g. "TILAV" MCHJ) */
  @Column({ type: 'varchar', length: 128 })
  accountHolderName!: string;

  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
