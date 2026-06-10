import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'chat_templates' })
@Index(['shopId'])
export class ChatTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** null = tizim default (barcha sellerlarga ko'rinadi). */
  @Column({ type: 'uuid', nullable: true })
  shopId!: string | null;

  @Column({ type: 'text' })
  text!: string;

  /** true bo'lsa tahrirlash va o'chirish mumkin emas. */
  @Column({ type: 'boolean', default: false })
  isSystem!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
