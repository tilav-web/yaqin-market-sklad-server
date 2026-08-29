import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { LocalizedText } from '../../common/types/localized-text.type';

/** A published Android APK build that customers can download from the site. */
@Entity({ name: 'app_releases' })
export class AppRelease {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  version!: string;

  /** MinIO object key holding the APK binary. */
  @Column({ type: 'varchar', length: 256 })
  fileKey!: string;

  @Column({ type: 'int' })
  sizeBytes!: number;

  @Column({ type: 'jsonb', nullable: true })
  notes!: LocalizedText | null;

  /** Exactly one release is the "latest" served to the download button. */
  @Index()
  @Column({ type: 'boolean', default: false })
  isLatest!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
