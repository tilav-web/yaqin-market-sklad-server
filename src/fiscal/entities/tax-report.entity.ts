import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum TaxReportType {
  SALARY_NDFL = 'salary_ndfl', // 15-sana: Xodim/direktor JShODS va Ijtimoiy soliq
  VAT = 'vat', // 20-sana: QQS (12%)
  PROFIT_TAX = 'profit_tax', // Har kvartal 20-sana: Foyda solig'i
  TURNOVER_TAX = 'turnover_tax', // Aylanmadan olinadigan soliq (4%)
}

export enum TaxReportStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  OVERDUE = 'overdue',
}

@Entity('tax_reports')
export class TaxReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  reportType!: TaxReportType;

  /** Masalan: '2026-08', '2026-09', '2026-Q3', '2026' */
  @Column({ type: 'varchar', length: 16 })
  period!: string;

  @Column({
    type: 'varchar',
    length: 16,
    default: TaxReportStatus.PENDING,
  })
  status!: TaxReportStatus;

  /** Oxirgi topshirish sanasi (YYYY-MM-DD), masalan '2026-09-15' */
  @Column({ type: 'varchar', length: 10 })
  dueDate!: string;

  @Column({ type: 'timestamp with time zone', nullable: true })
  submittedAt?: Date | null;

  /** Hisoblangan barcha ko'rsatkichlar (JSON) */
  @Column({ type: 'jsonb', default: {} })
  data!: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ type: 'text', nullable: true })
  submissionConfirmation?: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt!: Date;
}
