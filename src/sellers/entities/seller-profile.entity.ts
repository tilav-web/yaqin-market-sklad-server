import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';

@Entity({ name: 'seller_profiles' })
@Index(['userId'], { unique: true })
export class SellerProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', unique: true })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar', length: 128, nullable: true })
  fullName!: string | null;

  /** Passport series+number or PINFL */
  @Column({ type: 'varchar', length: 64, nullable: true })
  passportOrPinfl!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  stir!: string | null;

  /** 16-digit Humo/Uzcard number */
  @Column({ type: 'varchar', length: 32, nullable: true })
  bankCardNumber!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  bankCardHolderName!: string | null;

  /** YaTT, MChJ, AJ, etc. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  entityType!: string | null;

  /**
   * QQS to'lovchisimi — fiskal chek qatorlarida QQS ko'rsatiladimi-yo'qmi
   * shunga qarab hal bo'ladi (QQS mahsulotga emas, sellerning rejimiga
   * bog'liq).
   */
  @Column({ type: 'boolean', default: false })
  vatPayer!: boolean;

  /**
   * Komissioner ro'yxati holati. Seller my.soliq.uz kabinetida platformani
   * (STIRimizni) "vositachi/komissioner" sifatida qo'shishi shart — aks holda
   * uning nomidan chiqargan cheklarimiz soliq hisobotida unga bog'lanmaydi.
   * Buni avtomatik aniqlash uchun ochiq API yo'q — admin soliq kabinetdan
   * tekshirib qo'lda tasdiqlaydi (API paydo bo'lsa shu maydonlar avtomatik
   * to'ldiriladigan bo'ladi).
   */
  @Column({ type: 'varchar', length: 16, default: 'none' })
  komissionerStatus!: 'none' | 'pending' | 'confirmed';

  @Column({ type: 'timestamptz', nullable: true })
  komissionerConfirmedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  komissionerConfirmedByAdminId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  contractNumber!: string | null;

  @Column({ type: 'date', nullable: true })
  contractDate!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  verifiedByAdminId!: string | null;

  @Column({ type: 'text', nullable: true })
  adminNotes!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
