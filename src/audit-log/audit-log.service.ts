import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { AdminUser } from '../admin-users/entities/admin-user.entity';
import { AdminAuditLog, AuditAction } from './entities/admin-audit-log.entity';

export interface AuditLogEntry {
  adminUserId: string;
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AdminAuditLog) private readonly logs: Repository<AdminAuditLog>,
    @InjectRepository(AdminUser) private readonly adminUsers: Repository<AdminUser>,
  ) {}

  /** Fire-and-forget from the caller's perspective — never blocks or fails the
   * admin action it's recording (a lost audit row is far less harmful than a
   * blocked balance adjustment). */
  async record(entry: AuditLogEntry): Promise<void> {
    try {
      await this.logs.save(
        this.logs.create({
          adminUserId: entry.adminUserId,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId ?? null,
          reason: entry.reason ?? null,
          metadata: entry.metadata ?? null,
        }),
      );
    } catch {
      // Best-effort — swallow so audit logging can never break the action it documents.
    }
  }

  async list(opts: {
    targetType?: string;
    action?: AuditAction;
    limit?: number;
    offset?: number;
  }): Promise<{
    items: (AdminAuditLog & {
      admin: { id: string; username: string; firstName: string; lastName: string; phone: string | null } | null;
    })[];
    total: number;
  }> {
    const where: Record<string, unknown> = {};
    if (opts.targetType) where.targetType = opts.targetType;
    if (opts.action) where.action = opts.action;

    const [items, total] = await this.logs.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: Math.min(opts.limit ?? 50, 100),
      skip: Math.max(opts.offset ?? 0, 0),
    });

    const adminIds = [...new Set(items.map((l) => l.adminUserId))];
    const admins = adminIds.length
      ? await this.adminUsers.find({
          where: { id: In(adminIds) },
          select: { id: true, username: true, firstName: true, lastName: true, phone: true },
        })
      : [];
    const byId = new Map(admins.map((a) => [a.id, a]));

    return {
      items: items.map((l) => ({ ...l, admin: byId.get(l.adminUserId) ?? null })),
      total,
    };
  }
}
