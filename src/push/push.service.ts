import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';

import { Notification } from '../notifications/entities/notification.entity';
import { DeviceToken } from './entities/device-token.entity';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Optional image URL shown in the notification (Android large icon / expanded). */
  imageUrl?: string;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Stores device push tokens and delivers notifications through the Expo Push
 * service. Works with no extra server credentials — Expo routes to FCM/APNs.
 * Sending failures are logged, never thrown, so a push problem can't break an
 * order flow. Every push to a registered user is also saved to their in-app
 * inbox ({@link Notification}); anonymous devices receive the push only.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @InjectRepository(DeviceToken)
    private readonly tokens: Repository<DeviceToken>,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {}

  /**
   * Register (or refresh) a device token. `userId` is null for an anonymous
   * device; passing a userId for an existing token LINKS that device to the
   * user — this is how a token registered before login gets attached on login.
   */
  async registerToken(userId: string | null, token: string, platform = 'android'): Promise<void> {
    const existing = await this.tokens.findOne({ where: { token } });
    if (existing) {
      // Never downgrade a linked token back to anonymous.
      const nextUserId = userId ?? existing.userId;
      if (existing.userId !== nextUserId || existing.platform !== platform) {
        existing.userId = nextUserId;
        existing.platform = platform;
        await this.tokens.save(existing);
      }
      return;
    }
    await this.tokens.save(this.tokens.create({ userId, token, platform }));
  }

  /** Remove a device token — only if it belongs to `userId` (no cross-account deletes). */
  async removeToken(userId: string, token: string): Promise<void> {
    await this.tokens.delete({ token, userId });
  }

  /** Link every still-anonymous token on this list to a user (called on login). */
  async linkTokensToUser(userId: string, tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.tokens
      .createQueryBuilder()
      .update(DeviceToken)
      .set({ userId })
      .where('token IN (:...tokens)', { tokens })
      .andWhere('userId IS NULL')
      .execute();
  }

  /** Fire-and-forget push to all of a user's devices (+ save to their inbox). */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    return this.sendToUsers([userId], payload);
  }

  async sendToUsers(userIds: string[], payload: PushPayload): Promise<void> {
    if (userIds.length === 0) return;
    try {
      await this.saveInbox(userIds, payload);
      const rows = await this.tokens.find({ where: { userId: In(userIds) } });
      await this.pushToTokens(rows.map((r) => r.token), payload);
    } catch (err) {
      // Callers fire this and forget (order/chat/alert flows) — never let a
      // DB hiccup here become an unhandled rejection that kills the process.
      this.logger.warn(`sendToUsers failed: ${(err as Error).message}`);
    }
  }

  /** Save one inbox row per registered recipient. */
  async saveInbox(userIds: string[], payload: PushPayload): Promise<void> {
    if (userIds.length === 0) return;
    const rawKind = payload.data?.kind;
    const kind = typeof rawKind === 'string' ? rawKind : 'general';
    const data = payload.imageUrl
      ? { ...payload.data ?? {}, imageUrl: payload.imageUrl }
      : payload.data ?? {};
    await this.notifications.save(
      userIds.map((userId) =>
        this.notifications.create({ userId, title: payload.title, body: payload.body, data, kind }),
      ),
    );
  }

  /** Tokens of devices NOT yet linked to a user (for anonymous broadcasts). */
  async anonymousTokens(): Promise<string[]> {
    const rows = await this.tokens.find({ where: { userId: IsNull() } });
    return rows.map((r) => r.token);
  }

  async tokensForUsers(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.tokens.find({ where: { userId: In(userIds) } });
    return rows.map((r) => r.token);
  }

  /** Low-level Expo send (chunked at 100). No inbox persistence. */
  async pushToTokens(tokens: string[], payload: PushPayload): Promise<void> {
    if (tokens.length === 0) return;
    const messages = tokens.map((to) => ({
      to,
      sound: 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      ...(payload.imageUrl ? { image: payload.imageUrl } : {}),
    }));
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      const chunkTokens = tokens.slice(i, i + 100);
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk),
        });
        if (!res.ok) {
          this.logger.warn(`Expo push HTTP ${res.status}: ${await res.text()}`);
          continue;
        }
        await this.pruneDeadTokens(chunkTokens, await res.json());
      } catch (err) {
        this.logger.warn(`Expo push failed: ${(err as Error).message}`);
      }
    }
  }

  /** Drop tokens Expo reports as permanently unregistered so we stop wasting sends on them. */
  private async pruneDeadTokens(chunkTokens: string[], body: unknown): Promise<void> {
    const tickets = (body as { data?: { details?: { error?: string } }[] } | null)?.data;
    if (!Array.isArray(tickets)) return;
    const dead = tickets
      .map((t, idx) => (t?.details?.error === 'DeviceNotRegistered' ? chunkTokens[idx] : null))
      .filter((t): t is string => t !== null);
    if (dead.length > 0) await this.tokens.delete({ token: In(dead) });
  }
}
