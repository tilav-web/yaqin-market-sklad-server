import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';

import { AdminUsersService } from '../admin-users/admin-users.service';
import {
  AdminRole,
  AdminUser,
} from '../admin-users/entities/admin-user.entity';
import { RedisService } from '../redis/redis.service';
import { SmsService } from '../sms/sms.service';
import { AdminAuthService } from './admin-auth.service';

describe('AdminAuthService', () => {
  let service: AdminAuthService;
  let adminUsers: {
    findByUsername: jest.Mock;
    findByPhone: jest.Mock;
    findById: jest.Mock;
    updateLastLogin: jest.Mock;
    resetPassword: jest.Mock;
  };
  let jwt: { sign: jest.Mock; verify: jest.Mock };
  let redis: {
    client: {
      get: jest.Mock;
      setex: jest.Mock;
      del: jest.Mock;
      exists: jest.Mock;
      ttl: jest.Mock;
    };
  };
  let sms: { sendOtp: jest.Mock };

  beforeEach(async () => {
    adminUsers = {
      findByUsername: jest.fn(),
      findByPhone: jest.fn(),
      findById: jest.fn(),
      updateLastLogin: jest.fn().mockResolvedValue(undefined),
      resetPassword: jest.fn().mockResolvedValue(undefined),
    };
    jwt = {
      sign: jest.fn().mockReturnValue('mock_jwt_token'),
      verify: jest.fn(),
    };
    redis = {
      client: {
        get: jest.fn(),
        setex: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(1),
        exists: jest.fn().mockResolvedValue(0),
        ttl: jest.fn().mockResolvedValue(60),
      },
    };
    sms = {
      sendOtp: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAuthService,
        { provide: AdminUsersService, useValue: adminUsers },
        { provide: JwtService, useValue: jwt },
        { provide: RedisService, useValue: redis },
        { provide: SmsService, useValue: sms },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'JWT_SECRET') return 'test_secret';
              if (key === 'JWT_REFRESH_SECRET') return 'test_refresh_secret';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AdminAuthService>(AdminAuthService);
  });

  describe('login', () => {
    it('should throw UnauthorizedException if admin not found', async () => {
      adminUsers.findByUsername.mockResolvedValue(null);
      await expect(
        service.login({ username: 'nonexistent', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if admin is inactive', async () => {
      const mockAdmin = {
        id: '1',
        username: 'inactive_admin',
        passwordHash: 'some_hash',
        isActive: false,
      } as AdminUser;
      adminUsers.findByUsername.mockResolvedValue(mockAdmin);

      await expect(
        service.login({ username: 'inactive_admin', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should login successfully with valid password and return tokens', async () => {
      const passwordHash = await argon2.hash('Secret123!');
      const mockAdmin = {
        id: '1',
        username: 'superadmin',
        passwordHash,
        firstName: 'Super',
        lastName: 'Admin',
        role: AdminRole.SuperAdmin,
        isActive: true,
      } as AdminUser;

      adminUsers.findByUsername.mockResolvedValue(mockAdmin);

      const res = await service.login({
        username: 'superadmin',
        password: 'Secret123!',
      });
      expect(res.tokens.accessToken).toBe('mock_jwt_token');
      expect(res.admin.username).toBe('superadmin');
      expect(adminUsers.updateLastLogin).toHaveBeenCalledWith('1');
    });
  });

  describe('requestPasswordResetOtp', () => {
    it('should throw BadRequestException if admin has no phone', async () => {
      const mockAdmin = {
        id: '1',
        username: 'admin1',
        phone: null,
        isActive: true,
      } as AdminUser;
      adminUsers.findByUsername.mockResolvedValue(mockAdmin);

      await expect(
        service.requestPasswordResetOtp({ identifier: 'admin1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should send SMS OTP when admin with phone requests reset', async () => {
      const mockAdmin = {
        id: '1',
        username: 'admin1',
        phone: '+998901234567',
        isActive: true,
      } as AdminUser;
      adminUsers.findByUsername.mockResolvedValue(mockAdmin);

      const res = await service.requestPasswordResetOtp({
        identifier: 'admin1',
      });
      expect(res.success).toBe(true);
      expect(sms.sendOtp).toHaveBeenCalled();
      expect(redis.client.setex).toHaveBeenCalled();
    });
  });
});
