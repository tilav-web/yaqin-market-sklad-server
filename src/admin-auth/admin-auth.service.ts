import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { customAlphabet } from 'nanoid';

import { AdminUsersService } from '../admin-users/admin-users.service';
import { AdminUser } from '../admin-users/entities/admin-user.entity';
import type { EnvironmentVariables } from '../config/configuration';
import { RedisService } from '../redis/redis.service';
import { SmsService } from '../sms/sms.service';
import type { AdminJwtPayload } from './decorators/current-admin.decorator';
import { AdminChangePasswordDto } from './dto/change-password.dto';
import {
  AdminForgotPasswordRequestDto,
  AdminForgotPasswordResetDto,
} from './dto/forgot-password.dto';
import { AdminLoginDto, AdminRefreshTokenDto } from './dto/admin-login.dto';

const nano6 = customAlphabet('0123456789', 6);
const RESET_OTP_TTL_SEC = 5 * 60; // 5 daqiqa

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly adminUsers: AdminUsersService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly sms: SmsService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async login(dto: AdminLoginDto) {
    const admin = await this.adminUsers.findByUsername(dto.username);
    if (!admin) {
      throw new UnauthorizedException('Username yoki parol noto\'g\'ri');
    }

    if (!admin.isActive) {
      throw new UnauthorizedException('Hisobingiz nofaol qilingan. Superadminga murojaat qiling');
    }

    const isValid = await argon2.verify(admin.passwordHash, dto.password).catch(() => false);
    if (!isValid) {
      throw new UnauthorizedException('Username yoki parol noto\'g\'ri');
    }

    await this.adminUsers.updateLastLogin(admin.id);

    const tokens = this.generateTokens(admin);
    const { passwordHash: _, ...safeAdmin } = admin;

    return {
      admin: safeAdmin,
      tokens,
    };
  }

  async refreshToken(dto: AdminRefreshTokenDto) {
    try {
      const payload = this.jwt.verify<AdminJwtPayload>(dto.refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });

      if (payload.tokenType !== 'admin_refresh') {
        throw new UnauthorizedException('Yaroqsiz refresh token');
      }

      const admin = await this.adminUsers.findById(payload.sub);
      if (!admin || !admin.isActive) {
        throw new UnauthorizedException('Xodim topilmadi yoki nofaol qilingan');
      }

      const tokens = this.generateTokens(admin);
      return { tokens };
    } catch {
      throw new UnauthorizedException('Refresh token muddati tugagan yoki yaroqsiz');
    }
  }

  async requestPasswordResetOtp(dto: AdminForgotPasswordRequestDto) {
    const identifier = dto.identifier.trim();
    let admin = await this.adminUsers.findByUsername(identifier);
    if (!admin) {
      admin = await this.adminUsers.findByPhone(identifier);
    }

    if (!admin) {
      throw new BadRequestException('Ushbu ma\'lumot bo\'yicha xodim topilmadi');
    }

    if (!admin.phone) {
      throw new BadRequestException(
        'Ushbu xodim profiliga telefon raqami biriktirilmagan. Superadminga murojaat qiling',
      );
    }

    if (!admin.isActive) {
      throw new BadRequestException('Ushbu xodim hisobi nofaol qilingan');
    }

    const cooldownKey = `admin:reset:cooldown:${admin.id}`;
    const inCooldown = await this.redis.client.exists(cooldownKey);
    if (inCooldown) {
      const ttl = await this.redis.client.ttl(cooldownKey);
      throw new BadRequestException(`${ttl} soniyadan keyin qayta kod so'rashingiz mumkin`);
    }

    const fixed = this.config.get('FIXED_OTP_CODE', { infer: true });
    const code = fixed ? fixed : nano6();

    const key = `admin:reset:otp:${admin.id}`;
    await this.redis.client.setex(key, RESET_OTP_TTL_SEC, code);
    await this.redis.client.setex(cooldownKey, 60, '1');

    if (!fixed) {
      await this.sms.sendOtp(admin.phone, code);
    }

    this.logger.log(`Admin ${admin.username} uchun parolni tiklash kodi yuborildi`);

    return {
      success: true,
      message: `Tasdiqlash kodi ${this.maskPhone(admin.phone)} raqamiga yuborildi`,
      maskedPhone: this.maskPhone(admin.phone),
      ttlSec: RESET_OTP_TTL_SEC,
    };
  }

  async verifyPasswordReset(dto: AdminForgotPasswordResetDto) {
    const identifier = dto.identifier.trim();
    let admin = await this.adminUsers.findByUsername(identifier);
    if (!admin) {
      admin = await this.adminUsers.findByPhone(identifier);
    }

    if (!admin) {
      throw new BadRequestException('Xodim topilmadi');
    }

    const key = `admin:reset:otp:${admin.id}`;
    const storedCode = await this.redis.client.get(key);

    if (!storedCode || storedCode !== dto.code.trim()) {
      throw new BadRequestException('Tasdiqlash kodi noto\'g\'ri yoki muddati tugagan');
    }

    await this.adminUsers.resetPassword(admin.id, { newPassword: dto.newPassword });
    await this.redis.client.del(key);

    return {
      success: true,
      message: 'Parol muvaffaqiyatli yangilandi. Endi yangi parol bilan kirishingiz mumkin.',
    };
  }

  async changePassword(adminId: string, dto: AdminChangePasswordDto) {
    const admin = await this.adminUsers.findById(adminId);
    const isValid = await argon2.verify(admin.passwordHash, dto.oldPassword).catch(() => false);
    if (!isValid) {
      throw new BadRequestException('Eski parol noto\'g\'ri kiritildi');
    }

    await this.adminUsers.resetPassword(adminId, { newPassword: dto.newPassword });
    return {
      success: true,
      message: 'Parol muvaffaqiyatli o\'zgartirildi',
    };
  }

  private generateTokens(admin: AdminUser) {
    const accessPayload: AdminJwtPayload = {
      sub: admin.id,
      username: admin.username,
      role: admin.role,
      tokenType: 'admin_access',
    };

    const refreshPayload: AdminJwtPayload = {
      sub: admin.id,
      username: admin.username,
      role: admin.role,
      tokenType: 'admin_refresh',
    };

    const accessToken = this.jwt.sign(accessPayload, {
      secret: this.config.get('JWT_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }) ?? '12h',
    });

    const refreshToken = this.jwt.sign(refreshPayload, {
      secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_REFRESH_TTL', { infer: true }) ?? '30d',
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  private maskPhone(phone: string): string {
    const clean = phone.replace(/\D/g, '');
    if (clean.length === 12) {
      // +998 90 *** ** 67
      return `+${clean.slice(0, 3)} ${clean.slice(3, 5)} *** ** ${clean.slice(10)}`;
    }
    return phone;
  }
}
