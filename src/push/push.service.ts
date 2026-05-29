import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { DeviceToken } from './entities/device-token.entity';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Stores device push tokens and delivers notifications through the Expo Push
 * service. Works with no extra server credentials — Expo routes to FCM/APNs.
 * (Android delivery additionally requires an FCM key uploaded to EAS, done via
 * `eas credentials`.) Sending failures are logged, never thrown, so a push
 * problem can't break an order flow.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @InjectRepository(DeviceToken)
    private readonly tokens: Repository<DeviceToken>,
  ) {}

  async registerToken(userId: string, token: string, platform = 'android'): Promise<void> {
    const existing = await this.tokens.findOne({ where: { token } });
    if (existing) {
      if (existing.userId !== userId || existing.platform !== platform) {
        existing.userId = userId;
        existing.platform = platform;
        await this.tokens.save(existing);
      }
      return;
    }
    await this.tokens.save(this.tokens.create({ userId, token, platform }));
  }

  async removeToken(token: string): Promise<void> {
    await this.tokens.delete({ token });
  }

  /** Fire-and-forget push to all of a user's devices. */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    return this.sendToUsers([userId], payload);
  }

  async sendToUsers(userIds: string[], payload: PushPayload): Promise<void> {
    if (userIds.length === 0) return;
    const rows = await this.tokens.find({ where: { userId: In(userIds) } });
    if (rows.length === 0) return;

    const messages = rows.map((r) => ({
      to: r.token,
      sound: 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });
      if (!res.ok) {
        this.logger.warn(`Expo push HTTP ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      this.logger.warn(`Expo push failed: ${(err as Error).message}`);
    }
  }
}
