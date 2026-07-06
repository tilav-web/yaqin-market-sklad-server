import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PushService } from '../push/push.service';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { User } from '../users/entities/user.entity';
import { Promotion } from './entities/promotion.entity';
import { PromotionsService } from './promotions.service';

/** Builds a Promotion row with sensible defaults, active + currently running. */
function makePromo(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: 'promo-1',
    shopId: 'shop-1',
    name: 'Test aksiya',
    type: 'product_discount',
    discountType: 'percent',
    discountValue: 10,
    targetProductId: null,
    targetProduct: null,
    targetCategoryId: null,
    targetCategory: null,
    freeDeliveryMinAmount: null,
    startAt: new Date(Date.now() - 1000),
    endAt: null,
    isActive: true,
    createdByUserId: 'user-1',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('PromotionsService', () => {
  let service: PromotionsService;
  let repo: jest.Mocked<Repository<Promotion>>;
  let shops: jest.Mocked<Repository<Shop>>;
  let staff: jest.Mocked<Repository<ShopStaff>>;

  function mockGetMany(promos: Promotion[]) {
    (repo.createQueryBuilder as jest.Mock).mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(promos),
    });
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromotionsService,
        {
          provide: getRepositoryToken(Promotion),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn((data: unknown) => data),
            save: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Shop),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(ShopStaff),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            createQueryBuilder: jest.fn(() => ({
              where: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([]),
            })),
          },
        },
        { provide: PushService, useValue: { sendToUsers: jest.fn(), sendToUser: jest.fn() } },
      ],
    }).compile();

    service = module.get<PromotionsService>(PromotionsService);
    repo = module.get(getRepositoryToken(Promotion));
    shops = module.get(getRepositoryToken(Shop));
    staff = module.get(getRepositoryToken(ShopStaff));
  });

  afterEach(() => jest.clearAllMocks());

  describe('findActiveForProduct — discount math', () => {
    it('foiz (percent) chegirmani to\'g\'ri hisoblaydi', async () => {
      mockGetMany([makePromo({ discountType: 'percent', discountValue: 20, targetProductId: 'variant-1' })]);

      const result = await service.findActiveForProduct('shop-1', 'variant-1', null, 10_000);

      expect(result.discountAmount).toBe(2000); // 20% of 10000
      expect(result.promotionId).toBe('promo-1');
    });

    it('qat\'iy (fixed) chegirmani to\'g\'ridan-to\'g\'ri qo\'llaydi', async () => {
      mockGetMany([makePromo({ discountType: 'fixed', discountValue: 1500, targetProductId: 'variant-1' })]);

      const result = await service.findActiveForProduct('shop-1', 'variant-1', null, 10_000);

      expect(result.discountAmount).toBe(1500);
    });

    it('fixed chegirma unitPrice dan oshsa, unitPrice bilan cheklanadi', async () => {
      mockGetMany([makePromo({ discountType: 'fixed', discountValue: 1500, targetProductId: 'variant-1' })]);

      const result = await service.findActiveForProduct('shop-1', 'variant-1', null, 1000);

      expect(result.discountAmount).toBe(1000); // clamped, never exceeds the price
    });

    it('percent chegirma ham unitPrice dan oshib ketmaydi (clamp)', async () => {
      // discountValue > 100 shouldn't be possible via validate(), but the
      // clamp must hold regardless of how the row got into the DB.
      mockGetMany([makePromo({ discountType: 'percent', discountValue: 150, targetProductId: 'variant-1' })]);

      const result = await service.findActiveForProduct('shop-1', 'variant-1', null, 1000);

      expect(result.discountAmount).toBe(1000);
    });

    it('discountType yoki discountValue bo\'lmasa aksiyani e\'tiborsiz qoldiradi', async () => {
      mockGetMany([makePromo({ discountType: null, discountValue: null, targetProductId: 'variant-1' })]);

      const result = await service.findActiveForProduct('shop-1', 'variant-1', null, 10_000);

      expect(result).toEqual({ discountAmount: 0, promotionId: null });
    });

    it('mos kelmagan mahsulot/kategoriya uchun aksiyani o\'tkazib yuboradi', async () => {
      mockGetMany([
        makePromo({ type: 'product_discount', targetProductId: 'other-variant', discountValue: 50 }),
        makePromo({
          id: 'promo-cat',
          type: 'category_discount',
          targetCategoryId: 'cat-x',
          discountValue: 50,
        }),
      ]);

      const result = await service.findActiveForProduct('shop-1', 'variant-1', 'cat-y', 10_000);

      expect(result).toEqual({ discountAmount: 0, promotionId: null });
    });

    it('hech qanday mos aksiya bo\'lmasa nol qaytaradi', async () => {
      mockGetMany([]);
      const result = await service.findActiveForProduct('shop-1', 'variant-1', null, 10_000);
      expect(result).toEqual({ discountAmount: 0, promotionId: null });
    });
  });

  describe('findActiveForProduct — "eng foydali (best) aksiya g\'olib bo\'ladi"', () => {
    it('eng katta chegirmani tanlaydi, ro\'yxatdagi tartibidan qat\'i nazar (katta aksiya oxirida)', async () => {
      mockGetMany([
        makePromo({ id: 'promo-fixed-small', discountType: 'fixed', discountValue: 800, targetProductId: 'variant-1' }),
        makePromo({ id: 'promo-percent-big', discountType: 'percent', discountValue: 10, targetProductId: 'variant-1' }),
      ]);

      const result = await service.findActiveForProduct('shop-1', 'variant-1', null, 10_000);

      // 10% of 10000 = 1000 > 800 fixed — must win even though it's listed last.
      expect(result.discountAmount).toBe(1000);
      expect(result.promotionId).toBe('promo-percent-big');
    });

    it('eng katta chegirmani tanlaydi, ro\'yxatdagi tartibidan qat\'i nazar (katta aksiya boshida)', async () => {
      mockGetMany([
        makePromo({ id: 'promo-percent-big', discountType: 'percent', discountValue: 10, targetProductId: 'variant-1' }),
        makePromo({ id: 'promo-fixed-small', discountType: 'fixed', discountValue: 800, targetProductId: 'variant-1' }),
      ]);

      const result = await service.findActiveForProduct('shop-1', 'variant-1', null, 10_000);

      expect(result.discountAmount).toBe(1000);
      expect(result.promotionId).toBe('promo-percent-big');
    });

    it('kategoriya va mahsulot aksiyalari orasidan ham eng kattasini tanlaydi', async () => {
      mockGetMany([
        makePromo({ id: 'promo-cat', type: 'category_discount', targetCategoryId: 'cat-1', discountType: 'fixed', discountValue: 500 }),
        makePromo({ id: 'promo-product', type: 'product_discount', targetProductId: 'variant-1', discountType: 'fixed', discountValue: 2000 }),
      ]);

      const result = await service.findActiveForProduct('shop-1', 'variant-1', 'cat-1', 10_000);

      expect(result.discountAmount).toBe(2000);
      expect(result.promotionId).toBe('promo-product');
    });
  });

  describe('findFreeDeliveryPromotion', () => {
    it('savat summasi minimal miqdordan katta/teng bo\'lsa bepul yetkazishni qaytaradi', async () => {
      mockGetMany([makePromo({ id: 'promo-free', type: 'free_delivery', discountType: null, freeDeliveryMinAmount: 100_000 })]);

      const result = await service.findFreeDeliveryPromotion('shop-1', 150_000);

      expect(result).toEqual({ free: true, promotionId: 'promo-free' });
    });

    it('savat summasi yetarli bo\'lmasa bepul yetkazishni bermaydi', async () => {
      mockGetMany([makePromo({ id: 'promo-free', type: 'free_delivery', freeDeliveryMinAmount: 100_000 })]);

      const result = await service.findFreeDeliveryPromotion('shop-1', 50_000);

      expect(result).toEqual({ free: false, promotionId: null });
    });

    it('mos aksiya bo\'lmasa false qaytaradi', async () => {
      mockGetMany([]);
      const result = await service.findFreeDeliveryPromotion('shop-1', 500_000);
      expect(result).toEqual({ free: false, promotionId: null });
    });
  });

  describe('create — validate()', () => {
    beforeEach(() => {
      shops.findOne.mockResolvedValue({ id: 'shop-1', ownerId: 'owner-1' } as Shop);
    });

    it('product_discount uchun discountType bo\'lmasa rad etadi', async () => {
      await expect(
        service.create('owner-1', 'shop-1', {
          name: 'X',
          type: 'product_discount',
          startAt: new Date().toISOString(),
        } as never),
      ).rejects.toThrow('discountType majburiy');
    });

    it('discountValue <= 0 bo\'lsa rad etadi', async () => {
      await expect(
        service.create('owner-1', 'shop-1', {
          name: 'X',
          type: 'product_discount',
          discountType: 'percent',
          discountValue: 0,
          startAt: new Date().toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('free_delivery uchun freeDeliveryMinAmount bo\'lmasa rad etadi', async () => {
      await expect(
        service.create('owner-1', 'shop-1', {
          name: 'X',
          type: 'free_delivery',
          startAt: new Date().toISOString(),
        } as never),
      ).rejects.toThrow('freeDeliveryMinAmount majburiy');
    });

    it('to\'g\'ri ma\'lumot bilan aksiya yaratadi', async () => {
      (repo.save as jest.Mock).mockImplementation(async (p) => ({ ...p, id: 'new-promo' }));
      shops.findOne.mockResolvedValue({ id: 'shop-1', ownerId: 'owner-1', name: 'Do\'kon' } as Shop);

      const result = await service.create('owner-1', 'shop-1', {
        name: 'Chegirma',
        type: 'product_discount',
        discountType: 'percent',
        discountValue: 15,
        targetProductId: 'variant-1',
        startAt: new Date().toISOString(),
      });

      expect(result.id).toBe('new-promo');
    });

    it('do\'kon egasi bo\'lmagan va ruxsatsiz xodim uchun ForbiddenException', async () => {
      shops.findOne.mockResolvedValue({ id: 'shop-1', ownerId: 'owner-1' } as Shop);
      staff.findOne.mockResolvedValue(null);

      await expect(
        service.create('intruder', 'shop-1', {
          name: 'X',
          type: 'product_discount',
          discountType: 'percent',
          discountValue: 10,
          startAt: new Date().toISOString(),
        }),
      ).rejects.toThrow();
    });
  });
});
