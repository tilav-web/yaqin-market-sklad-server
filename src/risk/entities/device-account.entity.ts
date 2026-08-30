import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * Append-only (deviceId, userId) pairs seen at login — deliberately NOT
 * reusing `device_tokens` (that table is unique on the push token and
 * `registerToken` OVERWRITES `userId` on each login, so two accounts on one
 * phone would collapse into a single row and `device_shared_across_accounts`
 * would never fire). This table keeps every pair the device has ever been
 * linked to, which is the honest model for that rule.
 */
@Entity({ name: 'device_accounts' })
@Index(['userId'])
export class DeviceAccount {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  deviceId!: string;

  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  firstSeenAt!: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date;
}
