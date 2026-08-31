import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { PushService } from '../push/push.service';
import { User } from '../users/entities/user.entity';
import { Notification } from './entities/notification.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { TemplateDto, UpdateTemplateDto } from './dto/notification.dto';
import { toLocalizedText } from '../common/types/localized-text.type';

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

  listForUser(
    userId: string,
    opts: { unreadOnly?: boolean; limit?: number; offset?: number },
  ): Promise<Notification[]> {
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
    await this.notifications.update(
      { userId, isRead: false },
      { isRead: true },
    );
  }

  // ---- Admin broadcast ----------------------------------------------------

  /**
   * Send a notification to an audience. Registered recipients get an inbox row
   * + push; for "all", anonymous devices also receive the push (no inbox, since
   * they have no account yet — once they register, future pushes are saved).
   */
  async broadcast(
    input: BroadcastInput,
  ): Promise<{ registered: number; pushedTokens: number }> {
    const payload = {
      title: input.title,
      body: input.body,
      data: {
        kind: 'admin',
        ...(input.deepLink ? { deepLink: input.deepLink } : {}),
        ...(input.richBody ? { richBody: input.richBody } : {}),
        ...input.data,
      },
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
      const sellers = await this.users
        .createQueryBuilder('u')
        .where("u.roles ::text ILIKE '%seller%'")
        .select(['u.id'])
        .getMany();
      userIds = sellers.map((u) => u.id);
    } else if (input.audience === 'customers') {
      const customers = await this.users
        .createQueryBuilder('u')
        .where(
          "NOT (u.roles ::text ILIKE '%seller%' OR u.roles ::text ILIKE '%admin%')",
        )
        .select(['u.id'])
        .getMany();
      userIds = customers.map((u) => u.id);
    } else {
      userIds = (await this.users.find({ select: { id: true } })).map(
        (u) => u.id,
      );
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

  createTemplate(dto: TemplateDto): Promise<NotificationTemplate> {
    const title = toLocalizedText(
      dto.titleI18n || {
          uz: dto.titleUzLatn,
          kr: dto.titleUzCyrl,
          ru: dto.titleRu,
        } ||
        dto.title,
    );
    const body = toLocalizedText(
      dto.bodyI18n || {
          uz: dto.bodyUzLatn,
          kr: dto.bodyUzCyrl,
          ru: dto.bodyRu,
        } ||
        dto.body,
    );
    const t = this.templates.create({
      name: dto.name,
      title,
      body,
      richBody: dto.richBody,
      imageUrl: dto.imageUrl,
    });
    return this.templates.save(t);
  }

  async updateTemplate(
    id: string,
    dto: UpdateTemplateDto,
  ): Promise<NotificationTemplate> {
    const t = await this.templates.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Shablon topilmadi');
    if (dto.name !== undefined) t.name = dto.name;
    if (
      dto.title !== undefined ||
      dto.titleUzLatn !== undefined ||
      dto.titleUzCyrl !== undefined ||
      dto.titleRu !== undefined ||
      dto.titleI18n !== undefined
    ) {
      const cur =
        typeof t.title === 'object'
          ? t.title
          : { uz: t.title || '', kr: '', ru: '' };
      t.title = toLocalizedText(
        dto.titleI18n || {
          uz: dto.titleUzLatn ?? dto.title ?? cur?.uz,
          kr: dto.titleUzCyrl ?? cur?.kr,
          ru: dto.titleRu ?? cur?.ru,
        },
      );
    }
    if (
      dto.body !== undefined ||
      dto.bodyUzLatn !== undefined ||
      dto.bodyUzCyrl !== undefined ||
      dto.bodyRu !== undefined ||
      dto.bodyI18n !== undefined
    ) {
      const cur =
        typeof t.body === 'object'
          ? t.body
          : { uz: t.body || '', kr: '', ru: '' };
      t.body = toLocalizedText(
        dto.bodyI18n || {
          uz: dto.bodyUzLatn ?? dto.body ?? cur?.uz,
          kr: dto.bodyUzCyrl ?? cur?.kr,
          ru: dto.bodyRu ?? cur?.ru,
        },
      );
    }
    if (dto.richBody !== undefined) t.richBody = dto.richBody;
    if (dto.imageUrl !== undefined) t.imageUrl = dto.imageUrl;
    return this.templates.save(t);
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.templates.delete({ id });
  }
}
