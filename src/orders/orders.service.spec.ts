import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, In, Repository, SelectQueryBuilder } from 'typeorm';

import { AuditLogService } from '../audit-log/audit-log.service';
import { ClickService } from '../click/click.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ComplaintsService } from '../complaints/complaints.service';
import { RedisService } from '../redis/redis.service';
import { SellerTransaction } from '../payments/entities/seller-transaction.entity';
import { PaymentsService } from '../payments/payments.service';
import { GlobalProduct } from '../products/entities/global-product.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { PrimeService } from '../prime/prime.service';
import { PromotionsService } from '../promotions/promotions.service';
import { PushService } from '../push/push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SettingsService } from '../settings/settings.service';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { UserAddress } from '../users/entities/user-address.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order, OrderStatus, PaymentMethod, PaymentStatus } from './entities/order.entity';
import { Review } from './entities/review.entity';
import { OrdersService } from './orders.service';

const SHOP_ID = 'shop-1';
const OWNER_ID = 'owner-1';
const USER_ID = 'user-1';

/** Always-open (every day, all hours) working schedule — avoids test flakiness around the real clock. */
const ALWAYS_OPEN_HOURS = Array.from({ length: 7 }, (_, d) => ({
  dayOfWeek: d as 0 | 1 | 2 | 3 | 4 | 5 | 6,
  openTime: '00:00',
  closeTime: '23:59',
  isOpen: true,
}));

function makeShop(overrides: Partial<Shop> = {}): Shop {
  return {
    id: SHOP_ID,
    ownerId: OWNER_ID,
    isActive: true,
    latitude: 41.0,
    longitude: 69.0,
    isOpenManual: true,
    workingHours: ALWAYS_OPEN_HOURS,
    holidays: [],
    minOrderPrice: 0,
    deliveryZone: { maxKm: 5, freeKm: 1, pricingType: 'flat', pricePerStep: 10_000 },
    deliveryPolygon: null,
    freeDeliveryPolygon: null,
    blockedUserIds: [],
    photos: [],
    ...overrides,
  } as unknown as Shop;
}

function makeAddress(overrides: Partial<UserAddress> = {}): UserAddress {
  return {
    id: 'addr-1',
    userId: USER_ID,
    label: 'Uy',
    address: 'Test ko\'cha 1',
    latitude: 41.001,
    longitude: 69.001, // ~0.1km from the shop — inside a 5km/1km-free zone
    notes: null,
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as UserAddress;
}

function makeVariant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'variant-1',
    shopId: SHOP_ID,
    globalProductId: 'gp-1',
    price: 10_000,
    discountPrice: null,
    stock: 100,
    lowStockThreshold: 5,
    criticalThreshold: null,
    expiryDate: null,
    ratingAverage: 0,
    ratingCount: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ProductVariant;
}

/**
 * A stand-in EntityManager for `dataSource.transaction(cb)`. Tracks the
 * Order record created/saved through `create()`'s transaction (by object
 * identity) so the final `manager.findOne(Order, ...)` refetch — what the
 * service method actually returns — reflects the real subTotal/deliveryFee/
 * total/items computed earlier in the method, rather than an arbitrary stub.
 */
function mockEntityManager(variantsById: Record<string, ProductVariant>) {
  let orderRecord: Record<string, unknown> | null = null;
  const itemRecords: Record<string, unknown>[] = [];
  let idCounter = 0;
  const genId = () => `mock-id-${++idCounter}`;

  const em = {
    create: jest.fn((Entity: unknown, data: object) => {
      const obj = { ...data };
      if (Entity === Order) orderRecord = obj;
      if (Entity === OrderItem) itemRecords.push(obj);
      return obj;
    }),
    save: jest.fn(async (a: unknown, b?: unknown) => {
      const isTwoArg = b !== undefined;
      const data = (isTwoArg ? b : a) as Record<string, unknown>;
      const withId = { ...data, id: data.id ?? genId() };
      if (!isTwoArg && data === orderRecord) orderRecord = withId;
      return withId;
    }),
    // Return type is widened on purpose: individual tests override this with
    // `mockImplementation` to hand back other entities (a whole Order, for
    // instance), and the narrow type TypeScript infers from this default body
    // would reject every one of those.
    findOne: jest.fn(
      async (Entity: unknown, opts: { where: { id?: string } }): Promise<unknown> => {
        if (Entity === ProductVariant) return variantsById[opts.where.id as string] ?? null;
        if (Entity === Order) return orderRecord ? { ...orderRecord, items: itemRecords } : null;
        return null;
      },
    ),
    // StockBatch lookups inside consumeFifo — no batches, falls back to 0 cost.
    // Widened like `findOne` above: tests override it to return order items.
    find: jest.fn(async (_Entity?: unknown): Promise<unknown[]> => []),
    update: jest.fn(),
  };
  return em;
}

describe('OrdersService', () => {
  let service: OrdersService;
  let orders: jest.Mocked<Repository<Order>>;
  let shops: jest.Mocked<Repository<Shop>>;
  let variants: jest.Mocked<Repository<ProductVariant>>;
  let addresses: jest.Mocked<Repository<UserAddress>>;
  let staff: jest.Mocked<Repository<ShopStaff>>;
  let globalProducts: jest.Mocked<Repository<GlobalProduct>>;
  let reviews: jest.Mocked<Repository<Review>>;
  let sellerTransactions: jest.Mocked<Repository<SellerTransaction>>;
  let dataSource: { transaction: jest.Mock; createQueryBuilder: jest.Mock };
  let realtime: { emitToUser: jest.Mock; emitToShop: jest.Mock };
  let push: { sendToUser: jest.Mock; sendToUsers: jest.Mock };
  let payments: { recordCashOrderDelivery: jest.Mock; recordOnlineOrderDelivery: jest.Mock };
  let prime: { getCommissionRate: jest.Mock };
  let settings: { getNumber: jest.Mock };
  let promotions: { findActivePromosForShop: jest.Mock; bestDiscountFor: jest.Mock; findFreeDeliveryPromotion: jest.Mock };
  let complaints: { getForOrder: jest.Mock; openComplaintOrderIds: jest.Mock };
  let auditLog: { record: jest.Mock };
  let click: { refundPaidOrder: jest.Mock };
  let fiscal: {
    createSaleReceipt: jest.Mock;
    createRefundReceipt: jest.Mock;
    rebuildIncompleteSaleForOrder: jest.Mock;
  };

  const buildRepoMock = () => ({
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    findBy: jest.fn().mockResolvedValue([]),
    save: jest.fn(),
    create: jest.fn((data: unknown) => data),
    update: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    })),
  });

  beforeEach(async () => {
    dataSource = { transaction: jest.fn(), createQueryBuilder: jest.fn() };
    realtime = { emitToUser: jest.fn(), emitToShop: jest.fn() };
    push = { sendToUser: jest.fn(), sendToUsers: jest.fn() };
    payments = { recordCashOrderDelivery: jest.fn(), recordOnlineOrderDelivery: jest.fn() };
    prime = { getCommissionRate: jest.fn().mockResolvedValue(12) };
    settings = { getNumber: jest.fn().mockReturnValue(12) };
    promotions = {
      findActivePromosForShop: jest.fn().mockResolvedValue([]),
      bestDiscountFor: jest.fn().mockReturnValue({ discountAmount: 0, promotionId: null }),
      findFreeDeliveryPromotion: jest.fn().mockResolvedValue({ free: false, promotionId: null }),
    };
    complaints = { getForOrder: jest.fn(), openComplaintOrderIds: jest.fn() };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    click = { refundPaidOrder: jest.fn().mockResolvedValue(true) };
    // Receipts are dispatched fire-and-forget from the order flow — the tests
    // here assert on the order, not on what the OFD received.
    fiscal = {
      createSaleReceipt: jest.fn().mockResolvedValue(undefined),
      createRefundReceipt: jest.fn().mockResolvedValue(undefined),
      rebuildIncompleteSaleForOrder: jest.fn().mockResolvedValue(undefined),
    };
    const redis = { client: { set: jest.fn().mockResolvedValue('OK'), get: jest.fn().mockResolvedValue(null) } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useFactory: buildRepoMock },
        { provide: getRepositoryToken(OrderItem), useFactory: buildRepoMock },
        { provide: getRepositoryToken(Shop), useFactory: buildRepoMock },
        { provide: getRepositoryToken(ProductVariant), useFactory: buildRepoMock },
        { provide: getRepositoryToken(UserAddress), useFactory: buildRepoMock },
        { provide: getRepositoryToken(Review), useFactory: buildRepoMock },
        { provide: getRepositoryToken(ChatMessage), useFactory: buildRepoMock },
        { provide: getRepositoryToken(ShopStaff), useFactory: buildRepoMock },
        { provide: getRepositoryToken(GlobalProduct), useFactory: buildRepoMock },
        { provide: getRepositoryToken(SellerTransaction), useFactory: buildRepoMock },
        { provide: DataSource, useValue: dataSource },
        { provide: RealtimeGateway, useValue: realtime },
        { provide: PushService, useValue: push },
        { provide: PaymentsService, useValue: payments },
        { provide: PrimeService, useValue: prime },
        { provide: SettingsService, useValue: settings },
        { provide: PromotionsService, useValue: promotions },
        { provide: ComplaintsService, useValue: complaints },
        { provide: AuditLogService, useValue: auditLog },
        { provide: ClickService, useValue: click },
        { provide: FiscalService, useValue: fiscal },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    orders = module.get(getRepositoryToken(Order));
    shops = module.get(getRepositoryToken(Shop));
    variants = module.get(getRepositoryToken(ProductVariant));
    addresses = module.get(getRepositoryToken(UserAddress));
    staff = module.get(getRepositoryToken(ShopStaff));
    globalProducts = module.get(getRepositoryToken(GlobalProduct));
    reviews = module.get(getRepositoryToken(Review));
    sellerTransactions = module.get(getRepositoryToken(SellerTransaction));

    // Common defaults shared by most `create()` tests.
    globalProducts.findBy.mockResolvedValue([{ id: 'gp-1', name: 'Test mahsulot', categoryId: 'cat-1' }] as never);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create — pre-checkout guards', () => {
    const dto = {
      shopId: SHOP_ID,
      deliveryAddressId: 'addr-1',
      items: [{ productVariantId: 'variant-1', quantity: 2 }],
    };

    it('do\'kon topilmasa yoki aktiv bo\'lmasa NotFoundException', async () => {
      shops.findOne.mockResolvedValue(null);
      await expect(service.create(USER_ID, dto)).rejects.toThrow(NotFoundException);
    });

    it('do\'kon hozir yopiq bo\'lsa BadRequestException (ish vaqti gate)', async () => {
      shops.findOne.mockResolvedValue(makeShop({ isOpenManual: false }));
      await expect(service.create(USER_ID, dto)).rejects.toThrow('hozir yopiq');
    });

    it('foydalanuvchi shu do\'kon tomonidan bloklangan bo\'lsa ForbiddenException', async () => {
      shops.findOne.mockResolvedValue(makeShop({ blockedUserIds: [USER_ID] }));
      await expect(service.create(USER_ID, dto)).rejects.toThrow(ForbiddenException);
    });

    it('manzil topilmasa NotFoundException', async () => {
      shops.findOne.mockResolvedValue(makeShop());
      addresses.findOne.mockResolvedValue(null);
      await expect(service.create(USER_ID, dto)).rejects.toThrow(NotFoundException);
    });

    it('manzil yetkazib berish zonasidan tashqarida bo\'lsa rad etadi', async () => {
      shops.findOne.mockResolvedValue(makeShop({ deliveryZone: { maxKm: 5, freeKm: 1, pricingType: 'flat', pricePerStep: 5000 } }));
      addresses.findOne.mockResolvedValue(makeAddress({ latitude: 42.0, longitude: 70.0 })); // ~140km away
      await expect(service.create(USER_ID, dto)).rejects.toThrow("zonasidan tashqarida");
    });

    it('deliveryPolygon berilgan bo\'lsa, doiradan tashqarida ham "ichkarida" hisoblanadi', async () => {
      // Address is ~140km from the shop (way past maxKm=5) but inside the
      // configured delivery polygon — the polygon must be authoritative
      // over the circle radius (regression: b9fd09b).
      const polygon = {
        type: 'Polygon' as const,
        coordinates: [[[69, 41], [70, 41], [70, 42], [69, 42], [69, 41]]] as [number, number][][],
      };
      shops.findOne.mockResolvedValue(makeShop({ deliveryPolygon: polygon }));
      addresses.findOne.mockResolvedValue(makeAddress({ latitude: 41.5, longitude: 69.5 }));
      variants.find.mockResolvedValue([]); // deliberately mismatched so we get a *different*, later error

      // If the zone check had rejected it, we'd see "zonasidan tashqarida" —
      // instead we reach the next check (variant count mismatch), proving
      // reachability passed.
      await expect(service.create(USER_ID, dto)).rejects.toThrow('Bir yoki bir nechta mahsulot topilmadi');
    });

    it('so\'ralgan variantlar soni topilganlardan farq qilsa rad etadi', async () => {
      shops.findOne.mockResolvedValue(makeShop());
      addresses.findOne.mockResolvedValue(makeAddress());
      variants.find.mockResolvedValue([]);
      await expect(service.create(USER_ID, dto)).rejects.toThrow('Bir yoki bir nechta mahsulot topilmadi');
    });

    it('mahsulot qoldig\'i yetarli bo\'lmasa rad etadi', async () => {
      shops.findOne.mockResolvedValue(makeShop());
      addresses.findOne.mockResolvedValue(makeAddress());
      variants.find.mockResolvedValue([makeVariant({ stock: 1 })]);
      await expect(service.create(USER_ID, dto)).rejects.toThrow(/ta qoldi/);
    });

    it('savat summasi minimal buyurtma narxidan kam bo\'lsa rad etadi (mini-order minimum)', async () => {
      // 2 × 10000 = 20000 subtotal, but the shop requires 50000 minimum.
      shops.findOne.mockResolvedValue(makeShop({ minOrderPrice: 50_000 }));
      addresses.findOne.mockResolvedValue(makeAddress());
      variants.find.mockResolvedValue([makeVariant()]);

      await expect(service.create(USER_ID, dto)).rejects.toThrow('Minimal buyurtma narxi: 50000');
    });
  });

  describe('create — delivery fee calculation', () => {
    const dto = {
      shopId: SHOP_ID,
      deliveryAddressId: 'addr-1',
      items: [{ productVariantId: 'variant-1', quantity: 2 }],
    };

    it('freeKm ichida bo\'lsa yetkazish bepul, umumiy summa subtotalga teng', async () => {
      const shop = makeShop(); // freeKm: 1, address ~0.1km away
      const address = makeAddress();
      const variant = makeVariant();
      shops.findOne.mockResolvedValue(shop);
      addresses.findOne.mockResolvedValue(address);
      variants.find.mockResolvedValue([variant]);
      const em = mockEntityManager({ [variant.id]: variant });
      dataSource.transaction.mockImplementation((cb) => cb(em));

      const created = await service.create(USER_ID, dto);

      expect(created.subTotal).toBe(20_000); // 2 × 10000
      expect(created.deliveryFee).toBe(0);
      expect(created.total).toBe(20_000);
    });

    it('freeKm dan tashqarida narxlash turiga mos yetkazish to\'lovini hisoblaydi (flat)', async () => {
      const shop = makeShop({
        deliveryZone: { maxKm: 10, freeKm: 1, pricingType: 'flat', pricePerStep: 7000 },
      });
      const address = makeAddress({ latitude: 41.03, longitude: 69.0 }); // ~3.3km away — beyond freeKm
      const variant = makeVariant();
      shops.findOne.mockResolvedValue(shop);
      addresses.findOne.mockResolvedValue(address);
      variants.find.mockResolvedValue([variant]);
      const em = mockEntityManager({ [variant.id]: variant });
      dataSource.transaction.mockImplementation((cb) => cb(em));

      const created = await service.create(USER_ID, dto);

      expect(created.deliveryFee).toBe(7000);
      expect(created.total).toBe(created.subTotal + 7000);
    });

    it('freeDeliveryPolygon ichida bo\'lsa masofadan qat\'i nazar yetkazish bepul', async () => {
      const polygon = {
        type: 'Polygon' as const,
        coordinates: [[[69, 41], [70, 41], [70, 42], [69, 42], [69, 41]]] as [number, number][][],
      };
      const shop = makeShop({
        deliveryZone: { maxKm: 200, freeKm: 1, pricingType: 'flat', pricePerStep: 9000 },
        freeDeliveryPolygon: polygon,
      });
      const address = makeAddress({ latitude: 41.5, longitude: 69.5 }); // far, but inside the free polygon
      const variant = makeVariant();
      shops.findOne.mockResolvedValue(shop);
      addresses.findOne.mockResolvedValue(address);
      variants.find.mockResolvedValue([variant]);
      const em = mockEntityManager({ [variant.id]: variant });
      dataSource.transaction.mockImplementation((cb) => cb(em));

      const created = await service.create(USER_ID, dto);

      expect(created.deliveryFee).toBe(0);
    });

    it('shop-darajadagi free_delivery aksiyasi savat yetarli bo\'lsa to\'lovni bekor qiladi', async () => {
      const shop = makeShop({
        deliveryZone: { maxKm: 10, freeKm: 0, pricingType: 'flat', pricePerStep: 9000 },
      });
      const address = makeAddress({ latitude: 41.03, longitude: 69.0 });
      const variant = makeVariant();
      shops.findOne.mockResolvedValue(shop);
      addresses.findOne.mockResolvedValue(address);
      variants.find.mockResolvedValue([variant]);
      promotions.findFreeDeliveryPromotion.mockResolvedValue({ free: true, promotionId: 'promo-free' });
      const em = mockEntityManager({ [variant.id]: variant });
      dataSource.transaction.mockImplementation((cb) => cb(em));

      const created = await service.create(USER_ID, dto);

      expect(created.deliveryFee).toBe(0);
    });

    it('promotions.bestDiscountFor dan qaytgan chegirmani birlik narxiga qo\'llaydi', async () => {
      const shop = makeShop();
      const address = makeAddress();
      const variant = makeVariant({ price: 10_000 });
      shops.findOne.mockResolvedValue(shop);
      addresses.findOne.mockResolvedValue(address);
      variants.find.mockResolvedValue([variant]);
      promotions.bestDiscountFor.mockReturnValue({ discountAmount: 2000, promotionId: 'promo-1' });
      const em = mockEntityManager({ [variant.id]: variant });
      dataSource.transaction.mockImplementation((cb) => cb(em));

      const created = await service.create(USER_ID, dto);

      // unitPrice = 10000 - 2000 = 8000, × 2 qty = 16000
      expect(created.subTotal).toBe(16_000);
      const item = (created.items as unknown as { unitPrice: number; promotionDiscountAmount: number; appliedPromotionId: string }[])[0];
      expect(item.unitPrice).toBe(8000);
      expect(item.promotionDiscountAmount).toBe(4000); // 2000 × 2 qty
      expect(item.appliedPromotionId).toBe('promo-1');
    });
  });

  describe('updateStatus — transitions', () => {
    function makeOrder(overrides: Partial<Order> = {}): Order {
      return {
        id: 'order-1',
        userId: USER_ID,
        shopId: SHOP_ID,
        shop: makeShop(),
        status: OrderStatus.New,
        timeline: [],
        orderNumber: 'ABC12345',
        total: 20_000,
        paymentMethod: PaymentMethod.Cash,
        ...overrides,
      } as unknown as Order;
    }

    it('ruxsat etilmagan status o\'tishini rad etadi', async () => {
      orders.findOne.mockResolvedValue(makeOrder({ status: OrderStatus.New }));
      await expect(service.updateStatus(OWNER_ID, 'order-1', OrderStatus.Delivered)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('mijoz yetkazib berish boshlangandan keyin (delivering) bekor qila olmaydi', async () => {
      orders.findOne.mockResolvedValue(makeOrder({ status: OrderStatus.Delivering }));
      await expect(
        service.updateStatus(USER_ID, 'order-1', OrderStatus.Cancelled),
      ).rejects.toThrow('boshlangandan keyin buyurtmani bekor qilib bo\'lmaydi');
    });

    it('mijoz to\'langan buyurtmani do\'kon qabul qilgach bekor qila olmaydi (support)', async () => {
      orders.findOne.mockResolvedValue(makeOrder({
        status: OrderStatus.Accepted,
        paymentMethod: PaymentMethod.ClickOnline,
        paymentStatus: PaymentStatus.Paid,
      }));
      await expect(
        service.updateStatus(USER_ID, 'order-1', OrderStatus.Cancelled),
      ).rejects.toThrow('qo\'llab-quvvatlash');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('mijoz to\'langan NEW buyurtmani bekor qilsa avto-refund chaqiriladi', async () => {
      const order = makeOrder({
        status: OrderStatus.New,
        paymentMethod: PaymentMethod.ClickOnline,
        paymentStatus: PaymentStatus.Paid,
      });
      orders.findOne.mockResolvedValue(order);
      const em = mockEntityManager({});
      em.findOne.mockImplementation(async (Entity: unknown) => (Entity === Order ? order : null));
      dataSource.transaction.mockImplementation((cb) => cb(em));

      const result = await service.updateStatus(USER_ID, 'order-1', OrderStatus.Cancelled);

      expect(result.status).toBe(OrderStatus.Cancelled);
      expect(click.refundPaidOrder).toHaveBeenCalledWith('order-1');
    });

    it.each([OrderStatus.New, OrderStatus.Accepted, OrderStatus.Preparing])(
      'mijoz %s holatida hali bekor qila oladi',
      async (status) => {
        const order = makeOrder({ status });
        orders.findOne.mockResolvedValue(order);
        const em = mockEntityManager({});
        // updateStatus re-reads the order under lock inside the transaction.
        em.findOne.mockImplementation(async (Entity: unknown) => (Entity === Order ? order : null));
        dataSource.transaction.mockImplementation((cb) => cb(em));

        const result = await service.updateStatus(USER_ID, 'order-1', OrderStatus.Cancelled);

        expect(result.status).toBe(OrderStatus.Cancelled);
      },
    );

    it('do\'kon egasi yetkazib berish boshlangandan keyin ham bekor qila oladi (mijozdan farqli)', async () => {
      const order = makeOrder({ status: OrderStatus.Delivering });
      orders.findOne.mockResolvedValue(order);
      const em = mockEntityManager({});
      em.findOne.mockImplementation(async (Entity: unknown) => (Entity === Order ? order : null));
      dataSource.transaction.mockImplementation((cb) => cb(em));

      const result = await service.updateStatus(OWNER_ID, 'order-1', OrderStatus.Cancelled);

      expect(result.status).toBe(OrderStatus.Cancelled);
    });

    it('ruxsatsiz xodim orders.accept huquqisiz qabul qila olmaydi', async () => {
      const order = makeOrder({ status: OrderStatus.New });
      orders.findOne.mockResolvedValue(order);
      staff.findOne.mockResolvedValue(null);

      await expect(service.updateStatus('random-staff', 'order-1', OrderStatus.Accepted)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('Delivered holatiga o\'tganda to\'lov hisob-kitobini ishga tushiradi', async () => {
      const order = makeOrder({ status: OrderStatus.Delivering, paymentMethod: PaymentMethod.Cash });
      orders.findOne.mockResolvedValue(order);
      const em = mockEntityManager({});
      em.findOne.mockImplementation(async (Entity: unknown) => (Entity === Order ? order : null));
      dataSource.transaction.mockImplementation((cb) => cb(em));

      await service.updateStatus(USER_ID, 'order-1', OrderStatus.Delivered);
      // settleDeliveredOrder is fire-and-forget (`void ...catch(...)`) — flush microtasks.
      await new Promise(process.nextTick);

      expect(payments.recordCashOrderDelivery).toHaveBeenCalledWith(
        expect.objectContaining({ sellerId: OWNER_ID, orderId: 'order-1', orderTotal: 20_000 }),
      );
    });

    it('kuryerga berishda (delivering) lokatsiya dalili bazaga yoziladi, lekin javobda qaytarilmaydi', async () => {
      const order = makeOrder({ status: OrderStatus.Preparing });
      orders.findOne.mockResolvedValue(order);
      const em = mockEntityManager({});
      em.findOne.mockImplementation(async (Entity: unknown) => (Entity === Order ? order : null));
      dataSource.transaction.mockImplementation((cb) => cb(em));

      const result = await service.updateStatus(OWNER_ID, 'order-1', OrderStatus.Delivering, undefined, {
        evidence: { latitude: 41.0, longitude: 69.0, accuracy: 12, source: 'foreground' },
        deviceId: 'device-1',
      });

      expect(em.save).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatchedEvidence: expect.objectContaining({
            latitude: 41.0,
            longitude: 69.0,
            deviceId: 'device-1',
            actorRole: 'shop',
          }),
        }),
      );
      expect(result).not.toHaveProperty('dispatchedEvidence');
    });

    it('do\'kon tomoni "Yetkazildi" bosganda deliveredEvidence + deliveredByUserId bazaga yoziladi (javobda emas)', async () => {
      const order = makeOrder({ status: OrderStatus.Delivering });
      orders.findOne.mockResolvedValue(order);
      const em = mockEntityManager({});
      em.findOne.mockImplementation(async (Entity: unknown) => (Entity === Order ? order : null));
      dataSource.transaction.mockImplementation((cb) => cb(em));

      const result = await service.updateStatus(OWNER_ID, 'order-1', OrderStatus.Delivered, undefined, {
        evidence: { latitude: 41.01, longitude: 69.01, mocked: false, source: 'foreground' },
      });

      expect(em.save).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveredByUserId: OWNER_ID,
          deliveredEvidence: expect.objectContaining({ latitude: 41.01, longitude: 69.01 }),
        }),
      );
      expect(result).not.toHaveProperty('deliveredEvidence');
      expect(result).not.toHaveProperty('orderEvidence');
    });

    it('mijoz o\'zi "Yetkazib oldim" desa deliveredByUserId kuryerga tegishli qilib yozilmaydi', async () => {
      const order = makeOrder({ status: OrderStatus.Delivering, userId: USER_ID });
      orders.findOne.mockResolvedValue(order);
      const em = mockEntityManager({});
      em.findOne.mockImplementation(async (Entity: unknown) => (Entity === Order ? order : null));
      dataSource.transaction.mockImplementation((cb) => cb(em));

      await service.updateStatus(USER_ID, 'order-1', OrderStatus.Delivered);

      expect(em.save).toHaveBeenCalledWith(
        expect.not.objectContaining({ deliveredByUserId: USER_ID }),
      );
    });
  });

  describe('getOne — location-evidence leakage', () => {
    it('mijozga/do\'konga hech qachon lokatsiya dalilini qaytarmaydi', async () => {
      const order = {
        id: 'order-1',
        userId: USER_ID,
        shopId: SHOP_ID,
        shop: makeShop(),
        status: OrderStatus.Delivered,
        items: [],
        orderEvidence: { latitude: 1, longitude: 2 },
        dispatchedEvidence: { latitude: 3, longitude: 4 },
        deliveredEvidence: { latitude: 5, longitude: 6 },
      } as unknown as Order;
      orders.findOne.mockResolvedValue(order);
      reviews.find.mockResolvedValue([]);
      complaints.getForOrder.mockResolvedValue(null);
      sellerTransactions.findOne.mockResolvedValue(null);

      const result = await service.getOne(USER_ID, 'order-1');

      expect(result).not.toHaveProperty('orderEvidence');
      expect(result).not.toHaveProperty('dispatchedEvidence');
      expect(result).not.toHaveProperty('deliveredEvidence');
    });
  });

  describe('autoCancelStaleNewOrders (cron)', () => {
    it('eskirgan buyurtma bo\'lmasa hech narsa qilmaydi', async () => {
      orders.find.mockResolvedValue([]);
      await service.autoCancelStaleNewOrders();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('5 daqiqadan eski "new" buyurtmani avtomatik bekor qiladi va mijozga xabar beradi', async () => {
      const stale = {
        id: 'order-1',
        userId: USER_ID,
        shopId: SHOP_ID,
        orderNumber: 'ABC1',
        status: OrderStatus.New,
        timeline: [],
      } as unknown as Order;
      // First call: stale non-paid orders to auto-cancel. Second call (inside
      // alertStalePaidOrders): stale PAID orders to nudge — none here.
      orders.find.mockResolvedValueOnce([stale]).mockResolvedValue([]);
      const em = mockEntityManager({});
      // The cron re-reads the order under lock — return a fresh "still new" copy.
      em.findOne.mockImplementation(async (Entity: unknown) => {
        if (Entity === Order) return { ...stale, timeline: [] };
        return null;
      });
      dataSource.transaction.mockImplementation((cb) => cb(em));

      await service.autoCancelStaleNewOrders();

      expect(push.sendToUser).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ data: expect.objectContaining({ kind: 'order:seller_no_response' }) }),
      );
      expect(realtime.emitToShop).toHaveBeenCalled();
    });

    it('tekshiruv bilan qulflash orasida qabul qilingan bo\'lsa bekor qilmaydi', async () => {
      const stale = {
        id: 'order-1',
        userId: USER_ID,
        shopId: SHOP_ID,
        orderNumber: 'ABC1',
        status: OrderStatus.New,
      } as Order;
      orders.find.mockResolvedValueOnce([stale]).mockResolvedValue([]);
      const em = mockEntityManager({});
      // Between the scan and the lock, the shop accepted it.
      em.findOne.mockImplementation(async (Entity: unknown) => {
        if (Entity === Order) return { id: 'order-1', status: OrderStatus.Accepted };
        return null;
      });
      dataSource.transaction.mockImplementation((cb) => cb(em));

      await service.autoCancelStaleNewOrders();

      expect(push.sendToUser).not.toHaveBeenCalled();
    });

    it('to\'langan (Click) buyurtmani avtomatik bekor qilmaydi — do\'konga ogohlantirish yuboradi', async () => {
      const stalePaid = {
        id: 'order-2',
        userId: USER_ID,
        shopId: SHOP_ID,
        shop: makeShop(),
        orderNumber: 'PAID1',
        status: OrderStatus.New,
        orderId: 'order-2',
        paymentMethod: PaymentMethod.ClickOnline,
        paymentStatus: PaymentStatus.Paid,
      } as unknown as Order;
      // Non-paid stale orders — none. Stale PAID orders come through the
      // query-builder path (COALESCE anchor): first getMany feeds
      // alertStalePaidOrders, the second (autoRefundAbandonedPaidOrders) is empty.
      orders.find.mockResolvedValue([]);
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValueOnce([stalePaid]).mockResolvedValue([]),
      };
      // Only the four builder methods this code path touches are stubbed —
      // the cast avoids having to fake the whole SelectQueryBuilder surface.
      orders.createQueryBuilder.mockReturnValue(qb as unknown as SelectQueryBuilder<Order>);
      staff.find.mockResolvedValue([]);

      await service.autoCancelStaleNewOrders();

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(push.sendToUsers).toHaveBeenCalledWith(
        [OWNER_ID],
        expect.objectContaining({ data: expect.objectContaining({ kind: 'order:paid_unaccepted' }) }),
      );
      expect(orders.update).toHaveBeenCalledWith(
        { id: In(['order-2']) },
        expect.objectContaining({ paidUnacceptedAlertSentAt: expect.any(Date) }),
      );
    });
  });

  describe('partialReturn', () => {
    function makeDeliveringOrder(overrides: Partial<Order> = {}): Order {
      return {
        id: 'order-1',
        userId: USER_ID,
        shopId: SHOP_ID,
        shop: makeShop(),
        status: OrderStatus.Delivering,
        subTotal: 20_000,
        total: 20_000,
        orderNumber: 'ABC1',
        timeline: [],
        items: [
          {
            id: 'item-1',
            orderId: 'order-1',
            productVariantId: 'variant-1',
            productName: 'Mahsulot',
            quantity: 2,
            unitPrice: 10_000,
            lineTotal: 20_000,
            returnedQuantity: 0,
            costOfGoods: 12_000, // 6000/unit
            appliedPromotionId: null,
            promotionDiscountAmount: 0,
          },
        ],
        ...overrides,
      } as unknown as Order;
    }

    it('faqat "delivering" holatida qaytarish mumkin', async () => {
      const order = makeDeliveringOrder({ status: OrderStatus.Delivered });
      orders.findOne.mockResolvedValue(order);
      const em = mockEntityManager({});
      // The status check runs on the fresh, locked read inside the transaction.
      em.findOne.mockImplementation(async (Entity: unknown) => (Entity === Order ? order : null));
      dataSource.transaction.mockImplementation((cb) => cb(em));
      await expect(
        service.partialReturn(OWNER_ID, 'order-1', [{ orderItemId: 'item-1', quantity: 1 }]),
      ).rejects.toThrow('Faqat yetkazib berilayotganda');
    });

    it('ruxsatsiz foydalanuvchi qaytara olmaydi', async () => {
      orders.findOne.mockResolvedValue(makeDeliveringOrder());
      staff.findOne.mockResolvedValue(null);
      await expect(
        service.partialReturn('intruder', 'order-1', [{ orderItemId: 'item-1', quantity: 1 }]),
      ).rejects.toThrow(ForbiddenException);
    });

    it('qolganidan ko\'p miqdorni qaytarishga urinishni rad etadi', async () => {
      const order = makeDeliveringOrder();
      orders.findOne.mockResolvedValue(order);
      const em = mockEntityManager({});
      // partialReturn re-reads the order under lock and its items inside the transaction.
      em.findOne.mockImplementation(async (Entity: unknown) => (Entity === Order ? order : null));
      em.find.mockImplementation(async (Entity: unknown) => (Entity === OrderItem ? order.items : []));
      dataSource.transaction.mockImplementation((cb) => cb(em));
      await expect(
        service.partialReturn(OWNER_ID, 'order-1', [{ orderItemId: 'item-1', quantity: 5 }]),
      ).rejects.toThrow(/faqat 2 ta qaytarish mumkin/);
    });

    it('qisman qaytarishda order.total/subTotal va item holatini to\'g\'ri qayta hisoblaydi', async () => {
      const order = makeDeliveringOrder();
      orders.findOne.mockResolvedValue(order);
      orders.findOneOrFail.mockResolvedValue(order);
      const variant = makeVariant();
      const em = mockEntityManager({ [variant.id]: variant });
      em.findOne.mockImplementation(async (Entity: unknown) => {
        if (Entity === Order) return order;
        if (Entity === ProductVariant) return variant;
        return null;
      });
      em.find.mockImplementation(async (Entity: unknown) => (Entity === OrderItem ? order.items : []));
      dataSource.transaction.mockImplementation((cb) => cb(em));

      const result = await service.partialReturn(OWNER_ID, 'order-1', [{ orderItemId: 'item-1', quantity: 1 }], 'Nosoz');

      // 1 unit returned at unitPrice 10000 → total/subTotal drop by 10000.
      expect(result.total).toBe(10_000);
      expect(result.subTotal).toBe(10_000);
      const item = order.items[0];
      expect(item.returnedQuantity).toBe(1);
      // unitCostOf(12000, remaining=2) = 6000/unit; costOfGoods -= 6000 × 1 → 6000 left.
      expect(item.costOfGoods).toBe(6000);
    });

    it('barcha qoldiqni qaytarganda umumiy summa 0 dan pastga tushmaydi', async () => {
      const order = makeDeliveringOrder();
      orders.findOne.mockResolvedValue(order);
      orders.findOneOrFail.mockResolvedValue(order);
      const variant = makeVariant();
      const em = mockEntityManager({ [variant.id]: variant });
      em.findOne.mockImplementation(async (Entity: unknown) => {
        if (Entity === Order) return order;
        if (Entity === ProductVariant) return variant;
        return null;
      });
      em.find.mockImplementation(async (Entity: unknown) => (Entity === OrderItem ? order.items : []));
      dataSource.transaction.mockImplementation((cb) => cb(em));

      const result = await service.partialReturn(OWNER_ID, 'order-1', [{ orderItemId: 'item-1', quantity: 2 }]);

      expect(result.total).toBe(0);
      expect(result.subTotal).toBe(0);
      expect(order.items[0].costOfGoods).toBe(0);
    });
  });
});
