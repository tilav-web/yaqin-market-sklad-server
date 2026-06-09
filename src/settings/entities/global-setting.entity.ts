import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'global_settings' })
export class GlobalSetting {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ type: 'varchar', length: 256 })
  value!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

export const SETTING_KEYS = {
  COMMISSION_RATE_DEFAULT: 'commission_rate_default', // e.g. "12.00"
  DEBT_DUE_DAYS: 'debt_due_days',                    // e.g. "30"
  SETTLEMENT_HOURS: 'settlement_hours',              // e.g. "24"
} as const;
