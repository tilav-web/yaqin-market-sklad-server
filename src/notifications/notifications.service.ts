import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { PushService } from '../push/push.service';
import { User } from '../users/entities/user.entity';
import { Notification } from './entities/notification.entity';
import { NotificationTemplate } from './entities/notification-template.entity';

export type Audience = 'all' | 'sellers' | 'customers' | 'specific';

export interface BroadcastInput {
  title: string;
  body: string;
  richBody?: string;
  data?: Record<string, unknown>;
  audience: Audience;
  userIds?: string[];
  phones?: string[];
  imageUrl?: string;
  deepLink?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(NotificationTemplate)
    private readonly templates: Repository<NotificationTemplate>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly push: PushService,
  ) {}

  // ---- User inbox ---------------------------------------------------------

  listForUser(userId: string, opts: { unreadOnly?: boolean; limit?: number; offset?: number }): Promise<Notification[]> {
    const where = opts.unreadOnly ? { userId, isRead: false } : { userId };
    return this.notifications.find({
      where,
      order: { createdAt: 'DESC' },
      take: Math.min(opts.limit ?? 50, 100),
      skip: Math.max(opts.offset ?? 0, 0),
    });
  }

  unreadCount(userId: string): Promise<number> {
    return this.notifications.count({ where: { userId, isRead: false } });
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.notifications.update({ id, userId }, { isRead: true });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notifications.update({ userId, isRead: false }, { isRead: true });
  }

  // ---- Admin broadcast ----------------------------------------------------

  /**
   * Send a notification to an audience. Registered recipients get an inbox row
   * + push; for "all", anonymous devices also receive the push (no inbox, since
   * they have no account yet — once they register, future pushes are saved).
   */
  async broadcast(input: BroadcastInput): Promise<{ registered: number; pushedTokens: number }> {
    const payload = {
      title: input.title,
      body: input.body,
      data: { kind: 'admin', ...(input.deepLink ? { deepLink: input.deepLink } : {}), ...(input.richBody ? { richBody: input.richBody } : {}), ...input.data },
      imageUrl: input.imageUrl,
    };

    let userIds: string[];
    if (input.audience === 'specific') {
      userIds = [...(input.userIds ?? [])];
      if (input.phones?.length) {
        const byPhone = await this.users.find({
          where: { phone: In(input.phones.map((p) => p.trim())) },
          select: { id: true },
        });
        userIds.push(...byPhone.map((u) => u.id));
      }
      userIds = [...new Set(userIds)];
    } else if (input.audience === 'sellers') {
      userIds = (await this.users.find({ where: { isSellerApproved: true }, select: { id: true } })).map((u) => u.id);
    } else if (input.audience === 'customers') {
      userIds = (await this.users.find({ where: { isSellerApproved: false, isAdmin: false }, select: { id: true } })).map((u) => u.id);
    } else {
      userIds = (await this.users.find({ select: { id: true } })).map((u) => u.id);
    }

    await this.push.saveInbox(userIds, payload);

    // Collect tokens: the targeted users' devices, plus anonymous ones for "all".
    const tokens = new Set(await this.push.tokensForUsers(userIds));
    if (input.audience === 'all') {
      for (const t of await this.push.anonymousTokens()) tokens.add(t);
    }
    const tokenList = [...tokens];
    // The inbox rows above are a single bulk insert — fast even for a large
    // audience. Sending to Expo is chunked at 100 HTTP calls each, which for a
    // large broadcast can take many seconds; run it in the background so the
    // admin's request doesn't hang waiting for it (pushToTokens never throws).
    void this.push.pushToTokens(tokenList, payload);

    return { registered: userIds.length, pushedTokens: tokenList.length };
  }

  // ---- Templates ----------------------------------------------------------

  listTemplates(): Promise<NotificationTemplate[]> {
    return this.templates.find({ order: { createdAt: 'DESC' } });
  }

  createTemplate(dto: { name: string; title: string; body: string; richBody?: string; imageUrl?: string }): Promise<NotificationTemplate> {
    return this.templates.save(this.templates.create(dto));
  }

  async updateTemplate(id: string, dto: { name?: string; title?: string; body?: string; richBody?: string; imageUrl?: string }): Promise<NotificationTemplate> {
    const t = await this.templates.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Shablon topilmadi');
    Object.assign(t, dto);
    return this.templates.save(t);
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.templates.delete({ id });
  }
}
