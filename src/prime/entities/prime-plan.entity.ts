import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'prime_plans' })
export class PrimePlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  name!: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  monthlyPrice!: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  yearlyPrice!: string | null;

  /** Commission % for subscribers of this plan */
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  commissionRate!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
