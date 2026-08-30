import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RiskRule {
  MockedLocation = 'mocked_location',
  DeliveredFarFromAddress = 'delivered_far_from_address',
  DeliveredWithoutEvidence = 'delivered_without_evidence',
  PickupFarFromShop = 'pickup_far_from_shop',
  ImpossibleTravel = 'impossible_travel',
  NotReceivedComplaint = 'not_received_complaint',
  LowCourierRating = 'low_courier_rating',
  CorroboratedFalseDelivery = 'corroborated_false_delivery',
  AddressFarFromDevice = 'address_far_from_device',
  ShopRelocatedAfterOrders = 'shop_relocated_after_orders',
  DeviceSharedAcrossAccounts = 'device_shared_across_accounts',
}

export enum RiskSeverity {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export enum RiskFlagStatus {
  Open = 'open',
  Confirmed = 'confirmed',
  Dismissed = 'dismissed',
}

export enum RiskSubjectType {
  User = 'user',
  Shop = 'shop',
  Order = 'order',
  Device = 'device',
}

/**
 * A system-raised anti-fraud signal — deliberately NOT modeled on
 * AdminAuditLog (that entity requires a mandatory admin actor and a closed
 * action enum; this one's actor is the system, and it needs severity +
 * review status that a pure audit trail doesn't).
 *
 * Rows are deduplicated and COUNTED, not append-only: `raise()` does an
 * `INSERT ... ON CONFLICT ("dedupeKey") DO UPDATE SET occurrences =
 * occurrences + 1, "lastSeenAt" = now()`. `status` is never touched by that
 * upsert — once an admin dismisses a flag it stays dismissed; per-subject
 * rules embed an ISO week in their dedupeKey so the SAME misbehaviour next
 * week raises a fresh row instead of silently reopening the old one.
 */
@Entity({ name: 'risk_flags' })
@Index(['status', 'severity', 'lastSeenAt'])
@Index(['subjectType', 'subjectId'])
@Index(['orderId'])
export class RiskFlag {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: RiskRule })
  rule!: RiskRule;

  @Column({ type: 'enum', enum: RiskSeverity })
  severity!: RiskSeverity;

  @Column({ type: 'enum', enum: RiskFlagStatus, default: RiskFlagStatus.Open })
  status!: RiskFlagStatus;

  /** Who would be sanctioned/investigated if this turns out to be real. */
  @Column({ type: 'enum', enum: RiskSubjectType })
  subjectType!: RiskSubjectType;

  /** A User.id, Shop.id, Order.id, or deviceId depending on subjectType. */
  @Column({ type: 'varchar', length: 64 })
  subjectId!: string;

  @Column({ type: 'uuid', nullable: true })
  orderId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  shopId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  deviceId!: string | null;

  /** One-line Uzbek summary computed at flag time — the admin list never recomputes it. */
  @Column({ type: 'varchar', length: 256 })
  summary!: string;

  /** Rule inputs: measured distance, thresholds used, evidence snapshots, counterparty ids. */
  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, unknown> | null;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 160 })
  dedupeKey!: string;

  @Column({ type: 'int', default: 1 })
  occurrences!: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  firstSeenAt!: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date;

  @Column({ type: 'uuid', nullable: true })
  reviewedByAdminId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  reviewNote!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
