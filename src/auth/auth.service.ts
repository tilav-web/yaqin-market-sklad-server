import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { customAlphabet } from 'nanoid';

import type { EnvironmentVariables } from '../config/configuration';
import { RedisService } from '../redis/redis.service';
import { SmsService } from '../sms/sms.service';
import { UsersService } from '../users/users.service';
import type { JwtPayload } from './decorators/current-user.decorator';

const nano6 = customAlphabet('0123456789', 6);

interface OtpRecord {
  code: string;
  attempts: number;
  createdAt: number;
}

const OTP_TTL_SEC = 5 * 60;
const RESEND_COOLDOWN_SEC = 60;
const MAX_VERIFY_ATTEMPTS = 5;
const REQUEST_RATE_LIMIT_PER_HOUR = 5;

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

    const fixed = this.config.get('FIXED_OTP_CODE', { infer: true });
    const env = this.config.get('NODE_ENV', { infer: true });
    const code = fixed && env !== 'production' ? fixed : nano6();

    const record: OtpRecord = { code, attempts: 0, createdAt: Date.now() };
    await this.redis.client.setex(`otp:${phone}`, OTP_TTL_SEC, JSON.stringify(record));
    await this.redis.client.setex(cooldownKey, RESEND_COOLDOWN_SEC, '1');

    await this.sms.sendOtp(phone, code);

    return { resendAfterSec: RESEND_COOLDOWN_SEC, ttlSec: OTP_TTL_SEC };
  }

  async verifyOtp(phone: string, code: string) {
    const key = `otp:${phone}`;
    const raw = await this.redis.client.get(key);
    if (!raw) {
      throw new BadRequestException("Tasdiq kodi muddati o'tdi yoki yaratilmagan");
    }

    const record = JSON.parse(raw) as OtpRecord;
    record.attempts += 1;

    if (record.attempts > MAX_VERIFY_ATTEMPTS) {
      await this.redis.client.del(key);
      throw new BadRequestException("Juda ko'p urinishlar. Yangi kod so'rang");
    }

    if (record.code !== code) {
      // Persist the incremented attempt count WITHOUT extending the code's
      // lifetime — keep the original expiry instead of restarting it.
      const ttlMs = await this.redis.client.pttl(key);
      if (ttlMs > 0) await this.redis.client.set(key, JSON.stringify(record), 'PX', ttlMs);
      else await this.redis.client.del(key);
      throw new BadRequestException("Tasdiq kodi noto'g'ri");
    }

    await this.redis.client.del(key);

    const user = await this.users.upsertByPhone(phone);
    const roles = await this.users.computeRoles(user);
    const tokens = await this.issueTokens({ sub: user.id, phone: user.phone, roles });

    return {
      user: { id: user.id, phone: user.phone, name: user.name, avatarUrl: user.avatarUrl, roles },
      tokens,
    };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
      const user = await this.users.findById(payload.sub);
      if (!user) throw new UnauthorizedException();
      const roles = await this.users.computeRoles(user);
      return this.issueTokens({ sub: user.id, phone: user.phone, roles });
    } catch {
      throw new UnauthorizedException('Refresh token noto\'g\'ri yoki muddati o\'tgan');
    }
  }

  private async issueTokens(payload: JwtPayload) {
    const accessTtl = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const refreshTtl = this.config.get('JWT_REFRESH_TTL', { infer: true });
    const accessToken = await this.jwt.signAsync({ ...payload }, {
      secret: this.config.get('JWT_SECRET', { infer: true }),
      expiresIn: accessTtl as never,
    });
    const refreshToken = await this.jwt.signAsync({ ...payload }, {
      secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      expiresIn: refreshTtl as never,
    });
    return { accessToken, refreshToken };
  }
}
