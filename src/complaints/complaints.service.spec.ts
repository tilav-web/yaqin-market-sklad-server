import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Order, OrderStatus } from '../orders/entities/order.entity';
import { PushService } from '../push/push.service';
import { RiskService } from '../risk/risk.service';
import { SettingsService } from '../settings/settings.service';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { User } from '../users/entities/user.entity';
import { ComplaintsService } from './complaints.service';
import {
  ComplaintStatus,
  OrderComplaint,
} from './entities/order-complaint.entity';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    userId: 'customer-1',
    shopId: 'shop-1',
    shop: { ownerId: 'owner-1' },
    orderNumber: 'ABC12345',
    deliveredByUserId: null,
    status: OrderStatus.Delivered,
    timeline: [],
    ...overrides,
  } as unknown as Order;
}

describe('ComplaintsService', () => {
  let service: ComplaintsService;
  let complaints: jest.Mocked<Repository<OrderComplaint>>;
  let orders: jest.Mocked<Repository<Order>>;
  let settings: { getNumber: jest.Mock };

  beforeEach(async () => {
    settings = { getNumber: jest.fn().mockReturnValue(24) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComplaintsService,
        {
          provide: getRepositoryToken(OrderComplaint),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn((data: unknown) => data),
            create: jest.fn((data: unknown) => data),
            createQueryBuilder: jest.fn(() => ({
              orderBy: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              take: jest.fn().mockReturnThis(),
              skip: jest.fn().mockReturnThis(),
              getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
            })),
          },
        },
        {
          provide: getRepositoryToken(Order),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(ShopStaff),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(User),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(Shop),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        { provide: SettingsService, useValue: settings },
        { provide: PushService, useValue: { sendToUsers: jest.fn() } },
        { provide: RiskService, useValue: { onComplaintFiled: jest.fn() } },
      ],
    }).compile();

    service = module.get<ComplaintsService>(ComplaintsService);
    complaints = module.get(getRepositoryToken(OrderComplaint));
    orders = module.get(getRepositoryToken(Order));
  });

  afterEach(() => jest.clearAllMocks());

  describe('createComplaint — filing window + ownership', () => {
    it('buyurtma topilmasa NotFoundException', async () => {
      orders.findOne.mockResolvedValue(null);
      await expect(
        service.createComplaint('customer-1', 'order-1', { reason: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('boshqa mijozning buyurtmasiga shikoyat qila olmaydi', async () => {
      orders.findOne.mockResolvedValue(makeOrder({ userId: 'someone-else' }));
      await expect(
        service.createComplaint('customer-1', 'order-1', { reason: 'x' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('faqat yetkazilgan (delivered) buyurtmaga shikoyat qilish mumkin', async () => {
      orders.findOne.mockResolvedValue(
        makeOrder({ status: OrderStatus.Delivering }),
      );
      await expect(
        service.createComplaint('customer-1', 'order-1', { reason: 'x' }),
      ).rejects.toThrow('Faqat yetkazilgan buyurtmaga');
    });

    it("escrow oynasi (SETTLEMENT_HOURS) ichida bo'lsa qabul qilinadi", async () => {
      const deliveredAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
      orders.findOne.mockResolvedValue(
        makeOrder({
          timeline: [
            {
              status: OrderStatus.Delivered,
              at: deliveredAt.toISOString(),
              byUserId: null,
            },
          ],
        }),
      );
      complaints.findOne.mockResolvedValue(null);

      await expect(
        service.createComplaint('customer-1', 'order-1', {
          reason: 'Mahsulot sifatsiz',
        }),
      ).resolves.toMatchObject({
        status: ComplaintStatus.Open,
        orderId: 'order-1',
        customerId: 'customer-1',
      });
    });

    it('escrow oynasi (SETTLEMENT_HOURS) tugagandan keyin rad etadi', async () => {
      const deliveredAt = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago, window is 24h
      orders.findOne.mockResolvedValue(
        makeOrder({
          timeline: [
            {
              status: OrderStatus.Delivered,
              at: deliveredAt.toISOString(),
              byUserId: null,
            },
          ],
        }),
      );

      await expect(
        service.createComplaint('customer-1', 'order-1', { reason: 'x' }),
      ).rejects.toThrow(/24 soat ichida qabul qilinadi/);
    });

    it("SETTLEMENT_HOURS setting o'zgarsa oyna ham mos ravishda o'zgaradi", async () => {
      settings.getNumber.mockReturnValue(1); // 1-hour window
      const deliveredAt = new Date(Date.now() - 90 * 60 * 1000); // 1.5h ago — past a 1h window
      orders.findOne.mockResolvedValue(
        makeOrder({
          timeline: [
            {
              status: OrderStatus.Delivered,
              at: deliveredAt.toISOString(),
              byUserId: null,
            },
          ],
        }),
      );

      await expect(
        service.createComplaint('customer-1', 'order-1', { reason: 'x' }),
      ).rejects.toThrow(/1 soat ichida qabul qilinadi/);
    });

    it("hech qachon delivered bo'lmagan (timeline holda) buyurtmani rad etadi", async () => {
      // Defensive case: status says Delivered but the timeline has no
      // Delivered event (shouldn't normally happen, but must not crash/allow).
      orders.findOne.mockResolvedValue(makeOrder({ timeline: [] }));

      await expect(
        service.createComplaint('customer-1', 'order-1', { reason: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('bitta buyurtma uchun faqat bitta shikoyat (one-complaint-per-order)', async () => {
      const deliveredAt = new Date(Date.now() - 1000);
      orders.findOne.mockResolvedValue(
        makeOrder({
          timeline: [
            {
              status: OrderStatus.Delivered,
              at: deliveredAt.toISOString(),
              byUserId: null,
            },
          ],
        }),
      );
      complaints.findOne.mockResolvedValue({
        id: 'existing-complaint',
      } as OrderComplaint);

      await expect(
        service.createComplaint('customer-1', 'order-1', { reason: 'x' }),
      ).rejects.toThrow('allaqachon yuborilgan');
      expect(complaints.save).not.toHaveBeenCalled();
    });

    it('eng oxirgi Delivered voqeasidan hisoblaydi (masalan qayta yetkazilgan holatda)', async () => {
      const older = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(); // 30h ago — outside window alone
      const recent = new Date(Date.now() - 1000).toISOString(); // just now
      orders.findOne.mockResolvedValue(
        makeOrder({
          timeline: [
            { status: OrderStatus.Delivered, at: older, byUserId: null },
            { status: OrderStatus.Delivering, at: older, byUserId: null },
            { status: OrderStatus.Delivered, at: recent, byUserId: null },
          ],
        }),
      );
      complaints.findOne.mockResolvedValue(null);

      await expect(
        service.createComplaint('customer-1', 'order-1', { reason: 'x' }),
      ).resolves.toBeDefined();
    });
  });

  describe('openComplaintOrderIds — used by the settlement cron', () => {
    it("bo'sh massiv uchun DB ga so'rov yubormaydi", async () => {
      const result = await service.openComplaintOrderIds([]);
      expect(result).toEqual(new Set());
      expect(complaints.find).not.toHaveBeenCalled();
    });

    it('faqat OPEN holatdagi shikoyatlarni qaytaradi', async () => {
      complaints.find.mockResolvedValue([
        { orderId: 'order-1' } as OrderComplaint,
      ]);

      const result = await service.openComplaintOrderIds([
        'order-1',
        'order-2',
      ]);

      expect(result).toEqual(new Set(['order-1']));
      expect(complaints.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: ComplaintStatus.Open }),
        }),
      );
    });
  });

  describe('adminResolve', () => {
    it('shikoyat topilmasa NotFoundException', async () => {
      complaints.findOne.mockResolvedValue(null);
      await expect(
        service.adminResolve('c-1', 'admin-1', 'ok'),
      ).rejects.toThrow(NotFoundException);
    });

    it("allaqachon yopilgan shikoyatni qayta yopib bo'lmaydi", async () => {
      complaints.findOne.mockResolvedValue({
        id: 'c-1',
        status: ComplaintStatus.Resolved,
      } as OrderComplaint);
      await expect(
        service.adminResolve('c-1', 'admin-1', 'ok'),
      ).rejects.toThrow('allaqachon yopilgan');
    });

    it('ochiq shikoyatni muvaffaqiyatli yopadi', async () => {
      const complaint = {
        id: 'c-1',
        status: ComplaintStatus.Open,
      } as OrderComplaint;
      complaints.findOne.mockResolvedValue(complaint);

      const result = await service.adminResolve(
        'c-1',
        'admin-1',
        'Mijozga qaytarib berildi',
      );

      expect(result.status).toBe(ComplaintStatus.Resolved);
      expect(result.resolution).toBe('Mijozga qaytarib berildi');
      expect(result.resolvedByAdminId).toBe('admin-1');
      expect(result.resolvedAt).toBeInstanceOf(Date);
    });
  });
});
