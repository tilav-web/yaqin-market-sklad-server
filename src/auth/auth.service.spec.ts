import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';

import type { EnvironmentVariables } from '../config/configuration';
import { RedisService } from '../redis/redis.service';
import { SmsService } from '../sms/sms.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { Role } from './role.enum';

const PHONE = '+998901234567';

// Bare-bones Redis client mock — AuthService only ever touches these methods.
const mockRedisClient = () => ({
  incr: jest.fn(),
  expire: jest.fn(),
  exists: jest.fn(),
  ttl: jest.fn(),
  setex: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  pttl: jest.fn(),
  pexpire: jest.fn(),
  set: jest.fn(),
});

const mockUsersService = () => ({
  upsertByPhone: jest.fn(),
  computeRoles: jest.fn(),
  findById: jest.fn(),
});

const mockSmsService = () => ({
  sendOtp: jest.fn(),
});

const mockJwtService = () => ({
  signAsync: jest.fn(),
  verifyAsync: jest.fn(),
});

/** Minimal ConfigService stand-in driven by a plain key→value map. */
function mockConfigService(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    FIXED_OTP_CODE: '',
    JWT_SECRET: 'test-jwt-secret',
    JWT_REFRESH_SECRET: 'test-jwt-refresh-secret',
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    ...overrides,
  };
  return { get: jest.fn((key: string) => defaults[key]) };
}

describe('AuthService', () => {
  let service: AuthService;
  let redis: ReturnType<typeof mockRedisClient>;
  let users: ReturnType<typeof mockUsersService>;
  let sms: ReturnType<typeof mockSmsService>;
  let jwt: ReturnType<typeof mockJwtService>;
  let config: ReturnType<typeof mockConfigService>;

  async function buildModule(configOverrides: Record<string, unknown> = {}) {
    redis = mockRedisClient();
    users = mockUsersService();
    sms = mockSmsService();
    jwt = mockJwtService();
    config = mockConfigService(configOverrides);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: SmsService, useValue: sms },
        { provide: RedisService, useValue: { client: redis } },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  }

  beforeEach(async () => {
    await buildModule();
  });

  afterEach(() => jest.clearAllMocks());

  describe('requestOtp', () => {
    it('birinchi so\'rovda hour-key ni 1 soatga expire qiladi', async () => {
      redis.incr.mockResolvedValue(1);
      redis.exists.mockResolvedValue(0);

      const result = await service.requestOtp(PHONE);

      expect(redis.expire).toHaveBeenCalledWith(`otp:hour:${PHONE}`, 60 * 60);
      expect(result).toEqual({ resendAfterSec: 60, ttlSec: 5 * 60 });
    });

    it('keyingi so\'rovlarda hour-key ni qayta expire qilmaydi', async () => {
      redis.incr.mockResolvedValue(2);
      redis.exists.mockResolvedValue(0);

      await service.requestOtp(PHONE);

      expect(redis.expire).not.toHaveBeenCalled();
    });

    it('1 soatda 5 tadan ko\'p so\'rov bo\'lsa rad etadi (rate limit)', async () => {
      redis.incr.mockResolvedValue(6);
      redis.exists.mockResolvedValue(0);

      await expect(service.requestOtp(PHONE)).rejects.toThrow(BadRequestException);
      await expect(service.requestOtp(PHONE)).rejects.toThrow("1 soatdan keyin");
      // Must reject before ever touching the cooldown key or sending an SMS.
      expect(redis.exists).not.toHaveBeenCalled();
    });

    it('aniq 5-so\'rov hali ruxsat etiladi (chegara qiymat)', async () => {
      redis.incr.mockResolvedValue(5);
      redis.exists.mockResolvedValue(0);

      await expect(service.requestOtp(PHONE)).resolves.toBeDefined();
    });

    it('resend-cooldown ichida bo\'lsa qolgan sekundlarni ko\'rsatib rad etadi', async () => {
      redis.incr.mockResolvedValue(1);
      redis.exists.mockResolvedValue(1);
      redis.ttl.mockResolvedValue(37);

      await expect(service.requestOtp(PHONE)).rejects.toThrow('37 soniyadan keyin');
    });

    it('FIXED_OTP_CODE o\'rnatilganda shu kodni ishlatadi va SMS yubormaydi', async () => {
      await buildModule({ FIXED_OTP_CODE: '111111' });
      redis.incr.mockResolvedValue(1);
      redis.exists.mockResolvedValue(0);

      await service.requestOtp(PHONE);

      const [, , payload] = redis.setex.mock.calls.find(([key]) => key === `otp:${PHONE}`)!;
      const record = JSON.parse(payload as string);
      expect(record.code).toBe('111111');
      expect(sms.sendOtp).not.toHaveBeenCalled();
    });

    it('FIXED_OTP_CODE bo\'sh bo\'lsa tasodifiy kod yaratadi va SMS orqali yuboradi', async () => {
      redis.incr.mockResolvedValue(1);
      redis.exists.mockResolvedValue(0);

      await service.requestOtp(PHONE);

      const [, , payload] = redis.setex.mock.calls.find(([key]) => key === `otp:${PHONE}`)!;
      const record = JSON.parse(payload as string);
      expect(record.code).toMatch(/^\d{6}$/);
      expect(sms.sendOtp).toHaveBeenCalledWith(PHONE, record.code);
    });

    it('otp va cooldown kalitlarini to\'g\'ri TTL bilan yozadi', async () => {
      redis.incr.mockResolvedValue(1);
      redis.exists.mockResolvedValue(0);

      await service.requestOtp(PHONE);

      expect(redis.setex).toHaveBeenCalledWith(`otp:${PHONE}`, 5 * 60, expect.any(String));
      expect(redis.setex).toHaveBeenCalledWith(`otp:cooldown:${PHONE}`, 60, '1');
    });
  });

  describe('verifyOtp', () => {
    it('kod topilmasa (muddati o\'tgan) xato tashlaydi', async () => {
      redis.get.mockResolvedValue(null);

      await expect(service.verifyOtp(PHONE, '111111')).rejects.toThrow(
        "Tasdiq kodi muddati o'tdi yoki yaratilmagan",
      );
    });

    it('5 martadan ko\'p noto\'g\'ri urinishdan keyin kodni o\'chirib rad etadi', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ code: '111111', createdAt: Date.now() }));
      redis.incr.mockResolvedValue(6); // atomic counter already past the cap

      await expect(service.verifyOtp(PHONE, '000000')).rejects.toThrow("Juda ko'p urinishlar");
      expect(redis.del).toHaveBeenCalledWith(`otp:${PHONE}`);
      expect(redis.del).toHaveBeenCalledWith(`otp:attempts:${PHONE}`);
    });

    it('birinchi noto\'g\'ri urinishda attempts kaliti otp bilan bir xil muddatga o\'rnatiladi', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ code: '111111', createdAt: Date.now() }));
      redis.incr.mockResolvedValue(1); // first attempt via atomic INCR
      redis.pttl.mockResolvedValue(120_000);

      await expect(service.verifyOtp(PHONE, '000000')).rejects.toThrow("Tasdiq kodi noto'g'ri");

      expect(redis.pexpire).toHaveBeenCalledWith(`otp:attempts:${PHONE}`, 120_000);
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('keyingi noto\'g\'ri urinishlarda attempts muddatini qayta o\'rnatmaydi', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ code: '111111', createdAt: Date.now() }));
      redis.incr.mockResolvedValue(2); // not the first attempt

      await expect(service.verifyOtp(PHONE, '000000')).rejects.toThrow("Tasdiq kodi noto'g'ri");

      expect(redis.pexpire).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('to\'g\'ri kod bilan token juftligini qaytaradi', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ code: '111111', createdAt: Date.now() }));
      redis.incr.mockResolvedValue(1);
      const user = { id: 'user-1', phone: PHONE, name: null, avatarUrl: null };
      users.upsertByPhone.mockResolvedValue(user);
      users.computeRoles.mockResolvedValue([Role.Customer]);
      jwt.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');

      const result = await service.verifyOtp(PHONE, '111111');

      expect(redis.del).toHaveBeenCalledWith(`otp:${PHONE}`);
      expect(result.user).toEqual({
        id: 'user-1',
        phone: PHONE,
        name: null,
        avatarUrl: null,
        roles: [Role.Customer],
      });
      expect(result.tokens).toEqual({ accessToken: 'access-token', refreshToken: 'refresh-token' });
    });

    it('FIXED_OTP_CODE rejimida ham verify to\'g\'ri ishlaydi', async () => {
      await buildModule({ FIXED_OTP_CODE: '111111' });
      redis.incr.mockResolvedValue(1);
      redis.exists.mockResolvedValue(0);
      await service.requestOtp(PHONE);
      const [, , payload] = redis.setex.mock.calls.find(([key]) => key === `otp:${PHONE}`)!;
      redis.get.mockResolvedValue(payload);

      const user = { id: 'user-1', phone: PHONE, name: null, avatarUrl: null };
      users.upsertByPhone.mockResolvedValue(user);
      users.computeRoles.mockResolvedValue([Role.Customer]);
      jwt.signAsync.mockResolvedValueOnce('access-token').mockResolvedValueOnce('refresh-token');

      await expect(service.verifyOtp(PHONE, '111111')).resolves.toMatchObject({
        tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' },
      });
    });
  });

  describe('issueTokens (via verifyOtp)', () => {
    it('access tokenni JWT_SECRET va 15 daqiqalik TTL bilan chiqaradi', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ code: '111111', attempts: 0, createdAt: Date.now() }));
      users.upsertByPhone.mockResolvedValue({ id: 'user-1', phone: PHONE, name: null, avatarUrl: null });
      users.computeRoles.mockResolvedValue([Role.Customer]);
      jwt.signAsync.mockResolvedValue('token');

      await service.verifyOtp(PHONE, '111111');

      expect(jwt.signAsync).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ sub: 'user-1', phone: PHONE }),
        expect.objectContaining({ secret: 'test-jwt-secret', expiresIn: '15m' }),
      );
    });

    it('refresh tokenni JWT_REFRESH_SECRET, 30 kunlik TTL va noyob jti bilan chiqaradi', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ code: '111111', attempts: 0, createdAt: Date.now() }));
      users.upsertByPhone.mockResolvedValue({ id: 'user-1', phone: PHONE, name: null, avatarUrl: null });
      users.computeRoles.mockResolvedValue([Role.Customer]);
      jwt.signAsync.mockResolvedValue('token');

      await service.verifyOtp(PHONE, '111111');

      expect(jwt.signAsync).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ sub: 'user-1', phone: PHONE, jti: expect.any(String) }),
        expect.objectContaining({ secret: 'test-jwt-refresh-secret', expiresIn: '30d' }),
      );
    });
  });

  describe('refresh', () => {
    it('yaroqsiz/tugagan refresh token bo\'lsa UnauthorizedException tashlaydi', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('bekor qilingan (revoked) jti bilan rad etadi', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', phone: PHONE, roles: [Role.Customer], jti: 'jti-1' });
      redis.exists.mockResolvedValue(1);

      await expect(service.refresh('rotated-token')).rejects.toThrow('Sessiya tugatilgan');
    });

    it('foydalanuvchi topilmasa yoki bloklangan bo\'lsa rad etadi', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', phone: PHONE, roles: [Role.Customer], jti: 'jti-1' });
      redis.exists.mockResolvedValue(0);
      users.findById.mockResolvedValue(null);

      await expect(service.refresh('token')).rejects.toThrow(UnauthorizedException);
    });

    it('muvaffaqiyatli refresh: eski jtini bekor qiladi va yangi juftlik chiqaradi', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', phone: PHONE, roles: [Role.Customer], jti: 'old-jti' });
      redis.exists.mockResolvedValue(0);
      users.findById.mockResolvedValue({ id: 'user-1', phone: PHONE, status: 'active' });
      users.computeRoles.mockResolvedValue([Role.Customer]);
      jwt.signAsync.mockResolvedValueOnce('new-access').mockResolvedValueOnce('new-refresh');

      const result = await service.refresh('token');

      expect(redis.setex).toHaveBeenCalledWith(
        'revoked_refresh:old-jti',
        31 * 24 * 60 * 60,
        '1',
      );
      expect(result).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    });
  });

  describe('logout', () => {
    it('yaroqli tokenni bekor qiladi (revoke)', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', phone: PHONE, roles: [Role.Customer], jti: 'jti-1' });

      await service.logout('token');

      expect(redis.setex).toHaveBeenCalledWith('revoked_refresh:jti-1', 31 * 24 * 60 * 60, '1');
    });

    it('yaroqsiz tokenni sekin/idempotent tarzda e\'tiborsiz qoldiradi', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('invalid'));

      await expect(service.logout('garbage')).resolves.toBeUndefined();
      expect(redis.setex).not.toHaveBeenCalled();
    });
  });
});
