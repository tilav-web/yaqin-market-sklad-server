import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import { haversineKm } from '../geo/geo.util';
import { LocationEvidence } from '../geo/location-evidence';
import { RedisService } from '../redis/redis.service';
import { SETTING_KEYS } from '../settings/entities/global-setting.entity';
import { SettingsService } from '../settings/settings.service';
import { CourierLocationPing } from './entities/courier-location-ping.entity';
import { RiskRule, RiskSeverity, RiskSubjectType } from './entities/risk-flag.entity';
import { RiskFlagsService } from './risk-flags.service';
import { isoWeekKey } from './risk.util';

export interface OrderPingSummary {
  pingCount: number;
  totalKm: number;
  durationMin: number | null;
  maxKmh: number | null;
  mockedCount: number;
}

interface LastFix {
  lat: number;
  lng: number;
  at: number;
}

@Injectable()
export class RiskPingService {
  private readonly logger = new Logger(RiskPingService.name);

  constructor(
    @InjectRepository(CourierLocationPing) private readonly pings: Repository<CourierLocationPing>,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    private readonly flags: RiskFlagsService,
  ) {}

  /**
   * Persist one courier ping and run the per-ping rules (mocked location,
   * impossible travel). Rate-limited per ORDER (not per courier) — the
   * background task POSTs once per active order on a multi-drop trip, all
   * from the same GPS tick, and we don't want N near-duplicate rows for one
   * physical movement. Never throws — a lost ping/flag is far less harmful
   * than breaking the live-tracking request it rides on.
   */
  async recordPing(input: {
    orderId: string;
    courierUserId: string;
    shopId: string | null;
    evidence: LocationEvidence;
  }): Promise<void> {
    try {
      const minIntervalSec = this.settings.getNumber(SETTING_KEYS.RISK_PING_MIN_INTERVAL_SEC, 5);
      const rateKey = `risk:ping:${input.orderId}`;
      const allowed = await this.redis.client.set(rateKey, '1', 'EX', minIntervalSec, 'NX');
      if (!allowed) return;

      const { segmentKm, segmentKmh } = await this.computeSegment(input.courierUserId, input.evidence);

      await this.pings.save(
        this.pings.create({
          orderId: input.orderId,
          courierUserId: input.courierUserId,
          shopId: input.shopId,
          latitude: input.evidence.latitude,
          longitude: input.evidence.longitude,
          accuracy: input.evidence.accuracy,
          mocked: input.evidence.mocked,
          source: input.evidence.source,
          deviceId: input.evidence.deviceId,
          capturedAt: input.evidence.capturedAt ? new Date(input.evidence.capturedAt) : null,
          segmentKm,
          segmentKmh,
        }),
      );

      await this.evaluateRules(input, segmentKm, segmentKmh);
    } catch (err) {
      this.logger.error(`recordPing failed for order ${input.orderId}: ${(err as Error).message}`);
    }
  }

  private async computeSegment(
    courierUserId: string,
    evidence: LocationEvidence,
  ): Promise<{ segmentKm: number | null; segmentKmh: number | null }> {
    const lastFixKey = `risk:lastfix:${courierUserId}`;
    const raw = await this.redis.client.get(lastFixKey);
    let segmentKm: number | null = null;
    let segmentKmh: number | null = null;
    if (raw) {
      const last = JSON.parse(raw) as LastFix;
      const km = haversineKm(last.lat, last.lng, evidence.latitude, evidence.longitude);
      const hours = (Date.now() - last.at) / 3_600_000;
      segmentKm = km;
      segmentKmh = hours > 0 ? km / hours : null;
    }
    const fix: LastFix = { lat: evidence.latitude, lng: evidence.longitude, at: Date.now() };
    // 1h TTL — a courier idle longer than that starts a fresh baseline rather
    // than comparing against a stale position from a previous shift.
    await this.redis.client.set(lastFixKey, JSON.stringify(fix), 'EX', 3600);
    return { segmentKm, segmentKmh };
  }

  private async evaluateRules(
    input: { orderId: string; courierUserId: string },
    segmentKm: number | null,
    segmentKmh: number | null,
  ): Promise<void> {
    const now = new Date();
    const week = isoWeekKey(now);

    if (segmentKmh != null && segmentKm != null) {
      const minSegmentKm = this.settings.getNumber(SETTING_KEYS.RISK_IMPOSSIBLE_MIN_SEGMENT_M, 1000) / 1000;
      const maxSpeedKmh = this.settings.getNumber(SETTING_KEYS.RISK_IMPOSSIBLE_SPEED_KMH, 120);
      if (segmentKm >= minSegmentKm && segmentKmh > maxSpeedKmh) {
        await this.flags.raise({
          rule: RiskRule.ImpossibleTravel,
          severity: RiskSeverity.Medium,
          subjectType: RiskSubjectType.User,
          subjectId: input.courierUserId,
          orderId: input.orderId,
          summary: `Kuryer ${Math.round(segmentKm)} km ni ${Math.round(segmentKmh)} km/soat tezlikda bosib o'tgan — imkonsiz tezlik`,
          details: { segmentKm, segmentKmh, orderId: input.orderId },
          dedupeKey: `${RiskRule.ImpossibleTravel}:${input.courierUserId}:${week}`,
        });
      }
    }
  }

  /** Retention — see risk_ping_retention_days. Runs once a day; a delete of a
   * day's worth of rows out of ~90 days is cheap even at this table's volume. */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeOldPings(): Promise<void> {
    const days = this.settings.getNumber(SETTING_KEYS.RISK_PING_RETENTION_DAYS, 90);
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const result = await this.pings.delete({ receivedAt: LessThan(cutoff) });
    if (result.affected) this.logger.log(`purgeOldPings: removed ${result.affected} pings older than ${days}d`);
  }

  async listForOrder(orderId: string): Promise<CourierLocationPing[]> {
    return this.pings.find({ where: { orderId }, order: { receivedAt: 'ASC' } });
  }

  async summaryForOrder(orderId: string): Promise<OrderPingSummary> {
    const rows = await this.listForOrder(orderId);
    if (rows.length === 0) return { pingCount: 0, totalKm: 0, durationMin: null, maxKmh: null, mockedCount: 0 };
    const totalKm = rows.reduce((sum, r) => sum + (r.segmentKm ?? 0), 0);
    const maxKmh = rows.reduce<number | null>((max, r) => (r.segmentKmh != null && (max == null || r.segmentKmh > max) ? r.segmentKmh : max), null);
    const mockedCount = rows.filter((r) => r.mocked === true).length;
    const durationMin = (rows[rows.length - 1].receivedAt.getTime() - rows[0].receivedAt.getTime()) / 60_000;
    return { pingCount: rows.length, totalKm, durationMin, maxKmh, mockedCount };
  }
}
