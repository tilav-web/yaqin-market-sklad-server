import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { EvidenceSource } from '../../geo/location-evidence';

/**
 * A courier's live GPS trail while an order is `delivering` — the durable
 * counterpart to the 60s Redis cache in OrdersService.updateCourierLocation
 * (that cache is for the live map; this table is the anti-fraud/dispute
 * evidence trail). Retained `risk_ping_retention_days` (default 90), see
 * RiskPingService's daily cron.
 *
 * bigserial PK (not uuid) and no FK to `orders` — deliberate deviations from
 * the rest of the codebase: this is high-volume, time-ordered, insert-only
 * data whose retention delete must range-scan independently of the order it
 * came from.
 */
@Entity({ name: 'courier_location_pings' })
@Index(['orderId', 'receivedAt'])
@Index(['courierUserId', 'receivedAt'])
@Index(['receivedAt'])
export class CourierLocationPing {
  @PrimaryGeneratedColumn('increment')
  id!: string;

  @Column({ type: 'uuid' })
  orderId!: string;

  @Column({ type: 'uuid' })
  courierUserId!: string;

  @Column({ type: 'uuid', nullable: true })
  shopId!: string | null;

  @Column({ type: 'double precision' })
  latitude!: number;

  @Column({ type: 'double precision' })
  longitude!: number;

  @Column({ type: 'real', nullable: true })
  accuracy!: number | null;

  @Column({ type: 'boolean', nullable: true })
  mocked!: boolean | null;

  @Column({ type: 'varchar', length: 16, default: 'background' })
  source!: EvidenceSource;

  @Column({ type: 'varchar', length: 64, nullable: true })
  deviceId!: string | null;

  /** Device clock at fix time — untrusted, never used for ordering. */
  @Column({ type: 'timestamptz', nullable: true })
  capturedAt!: Date | null;

  /** Server clock — the only trustworthy timestamp; ordering/retention key off this. */
  @CreateDateColumn({ type: 'timestamptz' })
  receivedAt!: Date;

  /** Haversine distance/implied speed from THIS courier's immediately previous ping. Null on the first ping of a run. */
  @Column({ type: 'double precision', nullable: true })
  segmentKm!: number | null;

  @Column({ type: 'double precision', nullable: true })
  segmentKmh!: number | null;
}
