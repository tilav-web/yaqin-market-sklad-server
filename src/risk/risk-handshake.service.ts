import { randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RedisService } from '../redis/redis.service';
import { SETTING_KEYS } from '../settings/entities/global-setting.entity';
import { SettingsService } from '../settings/settings.service';
import {
  RiskFlag,
  RiskFlagStatus,
  RiskSubjectType,
} from './entities/risk-flag.entity';

const TOKEN_TTL_SEC = 3 * 60 * 60; // an order rarely stays "delivering" longer than this

/**
 * QR handshake — the LAST line of defense, and deliberately the narrowest:
 * only couriers with an admin-CONFIRMED risk flag ever see it, so ~99% of
 * deliveries never touch this at all. Direction is customer-shows,
 * courier-scans (mirrors staff.tsx's QR-invite pattern and the Uzum
 * pickup-point convention) — the courier's phone is the only device
 * guaranteed online/charged/unlocked at the doorstep.
 */
@Injectable()
export class RiskHandshakeService {
  constructor(
    @InjectRepository(RiskFlag) private readonly flags: Repository<RiskFlag>,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
  ) {}

  async requiresHandshake(courierUserId: string | null): Promise<boolean> {
    if (!courierUserId) return false;
    if (
      this.settings.getNumber(SETTING_KEYS.RISK_QR_HANDSHAKE_ENABLED, 1) === 0
    )
      return false;
    const count = await this.flags.count({
      where: {
        subjectType: RiskSubjectType.User,
        subjectId: courierUserId,
        status: RiskFlagStatus.Confirmed,
      },
    });
    return count > 0;
  }

  /** Get-or-create the one-time token for this order's handshake. */
  async getOrIssueToken(orderId: string): Promise<string> {
    const key = `handshake:${orderId}`;
    const existing = await this.redis.client.get(key);
    if (existing) return existing;
    const token = randomBytes(16).toString('hex');
    await this.redis.client.set(key, token, 'EX', TOKEN_TTL_SEC);
    return token;
  }

  /** One-time: the token is deleted on successful verification. */
  async verify(orderId: string, token: string): Promise<boolean> {
    const key = `handshake:${orderId}`;
    const stored = await this.redis.client.get(key);
    if (!stored || stored !== token) return false;
    await this.redis.client.del(key);
    await this.redis.client.set(
      `handshake:verified:${orderId}`,
      '1',
      'EX',
      TOKEN_TTL_SEC,
    );
    return true;
  }

  wasVerified(orderId: string): Promise<number> {
    return this.redis.client.exists(`handshake:verified:${orderId}`);
  }
}
