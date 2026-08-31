import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AuditLogService } from '../audit-log/audit-log.service';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { DeviceToken } from '../push/entities/device-token.entity';
import { SellerBalance } from '../payments/entities/seller-balance.entity';
import { SellerBankAccount } from '../sellers/entities/seller-bank-account.entity';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { RiskService } from '../risk/risk.service';
import { UserAddress } from './entities/user-address.entity';
import { UserFavoriteProduct } from './entities/user-favorite-product.entity';
import { UserFavoriteShop } from './entities/user-favorite-shop.entity';
import { User, UserStatus } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService - deleteAccount', () => {
  let service: UsersService;

  const mockUsersRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };
  const mockAddressesRepo = {};
  const mockFavShopsRepo = {
    find: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const mockFavProductsRepo = {
    find: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const mockShopStaffRepo = {
    count: jest.fn(),
  };
  const mockOrdersRepo = {};
  const mockAuditLogService = {
    log: jest.fn(),
  };
  const mockRiskService = {
    linkDevice: jest.fn(),
  };

  let mockEntityManager: {
    count: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };

  let mockDataSource: {
    transaction: jest.Mock;
  };

  beforeEach(async () => {
    mockEntityManager = {
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((entityClass, data) => Promise.resolve(data)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (cb) => cb(mockEntityManager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: mockUsersRepo },
        { provide: getRepositoryToken(UserAddress), useValue: mockAddressesRepo },
        { provide: getRepositoryToken(UserFavoriteShop), useValue: mockFavShopsRepo },
        { provide: getRepositoryToken(UserFavoriteProduct), useValue: mockFavProductsRepo },
        { provide: getRepositoryToken(ShopStaff), useValue: mockShopStaffRepo },
        { provide: getRepositoryToken(Order), useValue: mockOrdersRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: RiskService, useValue: mockRiskService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  it('throws NotFoundException if user is not found', async () => {
    mockUsersRepo.findOne.mockResolvedValue(null);

    await expect(service.deleteAccount('non-existent')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws BadRequestException if user is already deleted', async () => {
    mockUsersRepo.findOne.mockResolvedValue({
      id: 'u1',
      status: UserStatus.Deleted,
    });

    await expect(service.deleteAccount('u1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException if customer has active orders', async () => {
    mockUsersRepo.findOne.mockResolvedValue({
      id: 'u1',
      status: UserStatus.Active,
    });
    mockEntityManager.count.mockResolvedValueOnce(1); // activeCustomerOrders > 0

    await expect(service.deleteAccount('u1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException if seller has unpaid debt', async () => {
    mockUsersRepo.findOne.mockResolvedValue({
      id: 'u1',
      status: UserStatus.Active,
    });
    mockEntityManager.count
      .mockResolvedValueOnce(0) // customer orders
      .mockResolvedValueOnce(0); // active deliveries

    mockEntityManager.find
      .mockResolvedValueOnce([]) // staff
      .mockResolvedValueOnce([{ id: 'shop-1', name: 'Test Shop' }]); // owned shops

    mockEntityManager.findOne.mockResolvedValueOnce({
      sellerId: 'u1',
      availableBalance: '0',
      debtBalance: '50000',
    });

    await expect(service.deleteAccount('u1')).rejects.toThrow(
      /qarz mavjud/i,
    );
  });

  it('successfully anonymizes and deletes user when all checks pass', async () => {
    const user: Partial<User> = {
      id: '11111111-2222-3333-4444-555555555555',
      phone: '+998901234567',
      name: 'Ali Valiyev',
      firstName: 'Ali',
      lastName: 'Valiyev',
      email: 'ali@example.com',
      avatarUrl: 'https://example.com/avatar.png',
      status: UserStatus.Active,
      roles: ['customer'],
    };

    mockUsersRepo.findOne.mockResolvedValue(user);
    mockEntityManager.count.mockResolvedValue(0);
    mockEntityManager.find.mockResolvedValue([]);

    const res = await service.deleteAccount(user.id!, {
      reasonKey: 'bad_experience',
      reasonDetails: 'Yetkazib berish juda sekin',
    });

    expect(res.success).toBe(true);
    expect(user.status).toBe(UserStatus.Deleted);
    expect(user.name).toBe("O'chirilgan foydalanuvchi");
    expect(user.deletionReason).toBe('[bad_experience] Yetkazib berish juda sekin');
    expect(user.email).toBeNull();
    expect(user.avatarUrl).toBeNull();
    expect(user.phone).toContain('+998000000000_del_');
    expect(user.deletedAt).toBeInstanceOf(Date);
    expect(mockEntityManager.delete).toHaveBeenCalledWith(UserAddress, {
      userId: user.id,
    });
    expect(mockEntityManager.delete).toHaveBeenCalledWith(DeviceToken, {
      userId: user.id,
    });
  });
});
