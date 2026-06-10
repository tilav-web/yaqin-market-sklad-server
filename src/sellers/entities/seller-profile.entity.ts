import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'seller_profiles' })
@Index(['userId'], { unique: true })
export class SellerProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', unique: true })
  userId!: string;

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
