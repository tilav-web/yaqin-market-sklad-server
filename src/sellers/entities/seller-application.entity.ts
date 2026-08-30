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

export enum SellerApplicationStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
}

@Entity({ name: 'seller_applications' })
@Index(['userId'])
@Index(['status'])
export class SellerApplication {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar', length: 64 })
  firstName!: string;

  @Column({ type: 'varchar', length: 64 })
  lastName!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  contactPhone!: string | null;

  /** STIR — komissioner modelida chek chiqarish uchun majburiy rekvizit. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  stir!: string | null;

  /** Tashkilot nomi (masalan: YATT KARIMOV JASUR yoki "BARAKA" MCHJ) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  companyName!: string | null;

  /** YaTT, MChJ, AJ... — soliq rejimini tushunish uchun arizada so'raladi. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  entityType!: string | null;

  /** Yuridik manzil */
  @Column({ type: 'varchar', length: 512, nullable: true })
  legalAddress!: string | null;

  /** 16 xonali Uzcard / Humo karta raqami */
  @Column({ type: 'varchar', length: 32, nullable: true })
  bankCardNumber!: string | null;

  /** Karta egasining to'liq F.I.SH. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  bankCardHolderName!: string | null;

  /** my.soliq.uz da TILAV MChJ ni komissioner qilib qo'shganini tasdiqlagan */
  @Column({ type: 'boolean', default: false })
  soliqConfirmed!: boolean;

  /** TILAV MChJ ommaviy ofertasiga rozilik bildirgan */
  @Column({ type: 'boolean', default: false })
  ofertaAccepted!: boolean;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({
    type: 'enum',
    enum: SellerApplicationStatus,
    default: SellerApplicationStatus.Pending,
  })
  status!: SellerApplicationStatus;

  @Column({ type: 'text', nullable: true })
  rejectionReason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedByUserId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
