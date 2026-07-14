import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { customAlphabet } from 'nanoid';

import type { EnvironmentVariables } from '../config/configuration';
import { RedisService } from '../redis/redis.service';
import { SmsService } from '../sms/sms.service';
import { UsersService } from '../users/users.service';
import type { JwtPayload } from './decorators/current-user.decorator';

const nano6 = customAlphabet('0123456789', 6);

interface OtpRecord {
  code: string;
  createdAt: number;
}

const OTP_TTL_SEC = 5 * 60;
const RESEND_COOLDOWN_SEC = 60;
const MAX_VERIFY_ATTEMPTS = 5;
const REQUEST_RATE_LIMIT_PER_HOUR = 5;
const REVOKED_REFRESH_PREFIX = 'revoked_refresh:';
const REVOKE_TTL_SEC = 31 * 24 * 60 * 60; // ≥ refresh token lifetime

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly sms: SmsService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async requestOtp(phone: string): Promise<{ resendAfterSec: number; ttlSec: number }> {
    const hourKey = `otp:hour:${phone}`;
    const hourCount = await this.redis.client.incr(hourKey);
    if (hourCount === 1) {
      await this.redis.client.expire(hourKey, 60 * 60);
    }
    if (hourCount > REQUEST_RATE_LIMIT_PER_HOUR) {
      throw new BadRequestException("Juda ko'p urinishlar. 1 soatdan keyin urinib ko'ring");
    }

    const cooldownKey = `otp:cooldown:${phone}`;
    const cooldownExists = await this.redis.client.exists(cooldownKey);
    if (cooldownExists) {
      const ttl = await this.redis.client.ttl(cooldownKey);
      throw new BadRequestException(`${ttl} soniyadan keyin qayta urinib ko'ring`);
    }

    // When FIXED_OTP_CODE is set, bypass SMS entirely — the code is known
    // (e.g. while Eskiz isn't wired up yet). Leave it empty to fall back to
    // random codes delivered over SMS.
    const fixed = this.config.get('FIXED_OTP_CODE', { infer: true });
    const code = fixed ? fixed : nano6();

    const record: OtpRecord = { code, createdAt: Date.now() };
    await this.redis.client.setex(`otp:${phone}`, OTP_TTL_SEC, JSON.stringify(record));
    await this.redis.client.setex(cooldownKey, RESEND_COOLDOWN_SEC, '1');

    if (!fixed) {
      await this.sms.sendOtp(phone, code);
    }

    return { resendAfterSec: RESEND_COOLDOWN_SEC, ttlSec: OTP_TTL_SEC };
  }

  async verifyOtp(phone: string, code: string) {
    const key = `otp:${phone}`;
    const raw = await this.redis.client.get(key);
    if (!raw) {
      throw new BadRequestException("Tasdiq kodi muddati o'tdi yoki yaratilmagan");
    }

    // Attempts live in their OWN key and are incremented via atomic INCR —
    // embedding the counter in the JSON blob (read → increment in JS → write
    // back) let concurrent verify calls all read the same stale count and
    // all pass the <=5 check, so parallel guesses could exceed the cap.
    const attemptsKey = `otp:attempts:${phone}`;
    const attempts = await this.redis.client.incr(attemptsKey);
    if (attempts === 1) {
      const ttlMs = await this.redis.client.pttl(key);
      if (ttlMs > 0) await this.redis.client.pexpire(attemptsKey, ttlMs);
    }

    if (attempts > MAX_VERIFY_ATTEMPTS) {
      await this.redis.client.del(key);
      await this.redis.client.del(attemptsKey);
      throw new BadRequestException("Juda ko'p urinishlar. Yangi kod so'rang");
    }

    const record = JSON.parse(raw) as OtpRecord;
    if (record.code !== code) {
      throw new BadRequestException("Tasdiq kodi noto'g'ri");
    }

    await this.redis.client.del(key);
    await this.redis.client.del(attemptsKey);

    const user = await this.users.upsertByPhone(phone);
    const roles = await this.users.computeRoles(user);
    const tokens = await this.issueTokens({ sub: user.id, phone: user.phone, roles });

    return {
      user: { id: user.id, phone: user.phone, name: user.name, avatarUrl: user.avatarUrl, roles },
      tokens,
    };
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload & { jti?: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Refresh token noto\'g\'ri yoki muddati o\'tgan');
    }
    // Reject tokens that were rotated out or logged out.
    if (payload.jti && (await this.redis.client.exists(`${REVOKED_REFRESH_PREFIX}${payload.jti}`))) {
      throw new UnauthorizedException('Sessiya tugatilgan — qaytadan kiring');
    }
    const user = await this.users.findById(payload.sub);
    if (!user || user.status === 'blocked') throw new UnauthorizedException();
    // Rotation: a refresh token is single-use — revoke it as we mint the next pair.
    if (payload.jti) {
      await this.redis.client.setex(`${REVOKED_REFRESH_PREFIX}${payload.jti}`, REVOKE_TTL_SEC, '1');
    }
    const roles = await this.users.computeRoles(user);
    return this.issueTokens({ sub: user.id, phone: user.phone, roles });
  }

  /** Revoke a refresh token (logout). Idempotent; ignores invalid tokens. */
  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload & { jti?: string }>(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
      if (payload.jti) {
        await this.redis.client.setex(`${REVOKED_REFRESH_PREFIX}${payload.jti}`, REVOKE_TTL_SEC, '1');
      }
    } catch {
      /* already invalid — nothing to revoke */
    }
  }

  private async issueTokens(payload: JwtPayload) {
    const accessTtl = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const refreshTtl = this.config.get('JWT_REFRESH_TTL', { infer: true });
    const accessToken = await this.jwt.signAsync({ ...payload }, {
      secret: this.config.get('JWT_SECRET', { infer: true }),
      expiresIn: accessTtl as never,
    });
    // Each refresh token carries a unique id so it can be individually revoked.
    const refreshToken = await this.jwt.signAsync({ ...payload, jti: randomUUID() }, {
      secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      expiresIn: refreshTtl as never,
    });
    return { accessToken, refreshToken };
  }
}
