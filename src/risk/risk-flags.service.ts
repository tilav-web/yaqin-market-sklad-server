import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { User } from '../users/entities/user.entity';
import { RiskFlag, RiskFlagStatus, RiskRule, RiskSeverity, RiskSubjectType } from './entities/risk-flag.entity';

export interface RaiseFlagInput {
  rule: RiskRule;
  severity: RiskSeverity;
  subjectType: RiskSubjectType;
  subjectId: string;
  orderId?: string | null;
  shopId?: string | null;
  deviceId?: string | null;
  summary: string;
  details?: Record<string, unknown> | null;
  /** Per-event rules pass an orderId-scoped key; per-subject rules pass an ISO-week-scoped one. */
  dedupeKey: string;
}

@Injectable()
export class RiskFlagsService {
  private readonly logger = new Logger(RiskFlagsService.name);

  constructor(
    @InjectRepository(RiskFlag) private readonly flags: Repository<RiskFlag>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Fire-and-forget, like AuditLogService.record() — never blocks or fails
   * the delivery/order flow it's watching. Deduped + counted via a raw
   * upsert: `status` is deliberately never touched here, so a dismissed flag
   * stays dismissed even if the same dedupeKey (this week) fires again.
   */
  async raise(input: RaiseFlagInput): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO "risk_flags"
           ("rule", "severity", "subjectType", "subjectId", "orderId", "shopId", "deviceId",
            "summary", "details", "dedupeKey")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT ("dedupeKey")
         DO UPDATE SET "occurrences" = "risk_flags"."occurrences" + 1,
                        "lastSeenAt" = now(),
                        "details" = EXCLUDED."details"`,
        [
          input.rule,
          input.severity,
          input.subjectType,
          input.subjectId,
          input.orderId ?? null,
          input.shopId ?? null,
          input.deviceId ?? null,
          input.summary,
          input.details ? JSON.stringify(input.details) : null,
          input.dedupeKey,
        ],
      );
    } catch (err) {
      this.logger.error(`raise(${input.rule}) failed: ${(err as Error).message}`);
    }
  }

  async list(opts: {
    status?: RiskFlagStatus;
    severity?: RiskSeverity;
    rule?: RiskRule;
    subjectType?: RiskSubjectType;
    subjectId?: string;
    orderId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    items: (RiskFlag & { subject: { id: string; name: string | null; phone: string } | null })[];
    total: number;
  }> {
    const where: Record<string, unknown> = {};
    if (opts.status) where.status = opts.status;
    if (opts.severity) where.severity = opts.severity;
    if (opts.rule) where.rule = opts.rule;
    if (opts.subjectType) where.subjectType = opts.subjectType;
    if (opts.subjectId) where.subjectId = opts.subjectId;
    if (opts.orderId) where.orderId = opts.orderId;

    const [items, total] = await this.flags.findAndCount({
      where,
      order: { lastSeenAt: 'DESC' },
      take: Math.min(opts.limit ?? 30, 100),
      skip: Math.max(opts.offset ?? 0, 0),
    });

    // Only User-subject flags resolve to a name/phone — Shop/Order/Device
    // subjects are shown by their raw id (the admin UI links out instead).
    const userIds = [...new Set(items.filter((f) => f.subjectType === RiskSubjectType.User).map((f) => f.subjectId))];
    const users = userIds.length
      ? await this.users.find({ where: { id: In(userIds) }, select: { id: true, name: true, phone: true } })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    return {
      items: items.map((f) => ({ ...f, subject: byId.get(f.subjectId) ?? null })),
      total,
    };
  }

  async openCount(): Promise<number> {
    return this.flags.count({ where: { status: RiskFlagStatus.Open } });
  }

  async review(
    id: string,
    status: RiskFlagStatus.Confirmed | RiskFlagStatus.Dismissed,
    adminUserId: string,
    note?: string,
  ): Promise<RiskFlag | null> {
    const flag = await this.flags.findOne({ where: { id } });
    if (!flag) return null;
    flag.status = status;
    flag.reviewedByAdminId = adminUserId;
    flag.reviewedAt = new Date();
    flag.reviewNote = note ?? null;
    return this.flags.save(flag);
  }
}
