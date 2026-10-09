import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { customAlphabet } from 'nanoid';

import { OrderAdminService } from './services/order-admin.service';
import { OrderChatService } from './services/order-chat.service';
import { OrderLifecycleCronService } from './services/order-lifecycle-cron.service';
import { OrderReviewsService } from './services/order-reviews.service';
import { DataSource, In, Not, Repository } from 'typeorm';

import { AuditLogService } from '../audit-log/audit-log.service';
import { Role } from '../auth/role.enum';
import { ClickService } from '../click/click.service';
import { ComplaintsService } from '../complaints/complaints.service';
import { FiscalService } from '../fiscal/fiscal.service';
import {
  calcDeliveryFee,
  estimateEtaMinutes,
  haversineKm,
  pointInPolygon,
} from '../geo/geo.util';
import { LocationEvidenceDto, buildEvidence } from '../geo/location-evidence';
import {
  SellerTransaction,
  SellerTxType,
} from '../payments/entities/seller-transaction.entity';
import { PaymentsService } from '../payments/payments.service';
import { GlobalProduct } from '../products/entities/global-product.entity';
import { MovementType } from '../products/entities/inventory-movement.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import {
  consumeFifo,
  restockReturn,
  unitCostOf,
} from '../products/inventory.util';
import { PrimeService } from '../prime/prime.service';
import { PromotionsService } from '../promotions/promotions.service';
import { PushService } from '../push/push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RedisService } from '../redis/redis.service';
import { RiskService } from '../risk/risk.service';
import { SETTING_KEYS } from '../settings/entities/global-setting.entity';
import { SettingsService } from '../settings/settings.service';
import { Shop } from '../shops/entities/shop.entity';
import {
  ShopStaff,
  StaffPermission,
} from '../shops/entities/shop-staff.entity';
import { assertShopPermission } from '../shops/shop-access.util';
import { isDeliveryOpenNow, isShopOpenNow } from '../shops/shop-hours.util';
import { UserAddress } from '../users/entities/user-address.entity';
import { User } from '../users/entities/user.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { OrderItem } from './entities/order-item.entity';
import {
  Order,
  OrderChannel,
  OrderEvidenceKey,
  OrderStatus,
  OrderTimelineEvent,
  PaymentMethod,
  PaymentStatus,
  isTerminalOrderStatus,
  omitOrderEvidence,
} from './entities/order.entity';
import { Review, ReviewTarget } from './entities/review.entity';

const orderNumberGen = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

// A new order the shop doesn't accept within this window is auto-cancelled.
const AUTO_CANCEL_MS = 5 * 60 * 1000;

// Nothing further will happen to an order in one of these — changing its
// payment method afterwards would be meaningless (or, for a paid order,
// impossible without an actual refund path).
const PAYMENT_METHOD_LOCKED_STATUSES: OrderStatus[] = [
  OrderStatus.Delivered,
  OrderStatus.Cancelled,
  OrderStatus.SellerNoResponse,
  OrderStatus.SellerRejected,
];

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly items: Repository<OrderItem>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
    @InjectRepository(UserAddress)
    private readonly addresses: Repository<UserAddress>,
    @InjectRepository(Review)
    private readonly reviews: Repository<Review>,
    @InjectRepository(ChatMessage)
    private readonly chat: Repository<ChatMessage>,
    @InjectRepository(ShopStaff)
    private readonly staff: Repository<ShopStaff>,
    @InjectRepository(GlobalProduct)
    private readonly globalProducts: Repository<GlobalProduct>,
    @InjectRepository(SellerTransaction)
    private readonly sellerTransactions: Repository<SellerTransaction>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly realtime: RealtimeGateway,
    private readonly redis: RedisService,
    private readonly push: PushService,
    private readonly payments: PaymentsService,
    private readonly prime: PrimeService,
    private readonly settings: SettingsService,
    private readonly promotions: PromotionsService,
    private readonly complaints: ComplaintsService,
    private readonly auditLog: AuditLogService,
    private readonly click: ClickService,
    private readonly fiscal: FiscalService,
    private readonly risk: RiskService,
    @Optional()
    private readonly reviewsService?: OrderReviewsService,
    @Optional()
    private readonly chatService?: OrderChatService,
    @Optional()
    private readonly adminService?: OrderAdminService,
    @Optional()
    private readonly lifecycleCronService?: OrderLifecycleCronService,
  ) {}

  private getReviewsService(): OrderReviewsService {
    return (
      this.reviewsService ??
      new OrderReviewsService(
        this.orders,
        this.reviews,
        this.shops,
        this.variants,
        this.dataSource,
        this.push,
        this.risk,
      )
    );
  }

  private getChatService(): OrderChatService {
    return (
      this.chatService ??
      new OrderChatService(
        this.orders,
        this.chat,
        this.staff,
        this.realtime,
        this.push,
      )
    );
  }

  private getAdminService(): OrderAdminService {
    return (
      this.adminService ?? new OrderAdminService(this.orders, this.auditLog)
    );
  }

  private getLifecycleCronService(): OrderLifecycleCronService {
    return (
      this.lifecycleCronService ??
      new OrderLifecycleCronService(
        this.orders,
        this.staff,
        this.dataSource,
        this.realtime,
        this.push,
        this.click,
      )
    );
  }

  private static readonly STATUS_LABEL: Record<OrderStatus, string> = {
    [OrderStatus.New]: 'Yangi',
    [OrderStatus.Accepted]: 'Qabul qilindi',
    [OrderStatus.Preparing]: "Yig'ilmoqda",
    [OrderStatus.Delivering]: 'Yetkazib berilmoqda',
    [OrderStatus.Delivered]: 'Yetkazildi',
    [OrderStatus.Cancelled]: 'Bekor qilindi',
    [OrderStatus.SellerNoResponse]: "Do'kon javob bermadi",
    [OrderStatus.SellerRejected]: "Do'kon rad etdi",
  };

  /** Build a variantId → productName map from a list of variants (single IN query). */
  private async variantNameMap(
    variants: ProductVariant[],
  ): Promise<Map<string, string>> {
    if (!variants.length) return new Map();
    const gpIds = [...new Set(variants.map((v) => v.globalProductId))];
    const gps = await this.globalProducts.findBy({ id: In(gpIds) });
    const gpMap = new Map(
      gps.map((gp) => [
        gp.id,
        typeof gp.name === 'object' ? gp.name?.uz || '' : (gp.name ?? ''),
      ]),
    );
    return new Map(
      variants.map((v) => [v.id, gpMap.get(v.globalProductId) ?? '']),
    );
  }

  /** Build a variantId → GlobalProduct.categoryId map (for category-scoped promotions). */
  private async variantCategoryMap(
    variants: ProductVariant[],
  ): Promise<Map<string, string | null>> {
    if (!variants.length) return new Map();
    const gpIds = [...new Set(variants.map((v) => v.globalProductId))];
    const gps = await this.globalProducts.findBy({ id: In(gpIds) });
    const gpMap = new Map(gps.map((gp) => [gp.id, gp.categoryId]));
    return new Map(
      variants.map((v) => [v.id, gpMap.get(v.globalProductId) ?? null]),
    );
  }

  /** Notify the customer and the shop's devices that an order changed. */
  private emitOrderEvent(
    event: 'order:new' | 'order:updated',
    order: Pick<Order, 'id' | 'userId' | 'shopId' | 'status' | 'orderNumber'>,
  ): void {
    const payload = {
      orderId: order.id,
      status: order.status,
      orderNumber: order.orderNumber,
      shopId: order.shopId,
    };
    if (order.userId) this.realtime.emitToUser(order.userId, event, payload);
    this.realtime.emitToShop(order.shopId, event, payload);
  }

  /**
   * Authorize a shop-side action on an order: the shop owner always passes;
   * otherwise the actor must be active staff of that shop holding `permission`.
   */
  private async assertShopCanManage(
    userId: string,
    order: Pick<Order, 'shopId'> & { shop: Pick<Shop, 'ownerId'> },
    permission: StaffPermission,
  ): Promise<void> {
    if (order.shop.ownerId === userId) return;
    const staff = await this.staff.findOne({
      where: { shopId: order.shopId, userId, isActive: true },
    });
    if (staff?.permissions.includes(permission)) return;
    throw new ForbiddenException("Bu amal uchun ruxsat yo'q");
  }

  /**
   * A staff member (not the owner) may only view an order if they hold
   * `orders.view_all`, or `orders.view_assigned` AND this order is assigned
   * to them specifically (e.g. the courier delivering it) — merely being an
   * active staff member of the shop (e.g. a warehouse-only "sklad" hire) is
   * not enough, even though they can act on it in other ways.
   */
  private staffCanViewOrder(
    staff: Pick<ShopStaff, 'id' | 'permissions'>,
    order: Pick<Order, 'assignedStaffId'>,
  ): boolean {
    if (staff.permissions.includes('orders.view_all')) return true;
    return (
      staff.permissions.includes('orders.view_assigned') &&
      order.assignedStaffId === staff.id
    );
  }

  /**
   * Authorize read access to an order for realtime/tracking endpoints: the
   * customer who placed it, the shop owner, or a staff member with the
   * matching view permission may view it. Mirrors the isParty check in {@link getOne}.
   */
  async assertOrderParty(userId: string, orderId: string): Promise<Order> {
    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: { shop: true },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const isParty = order.userId === userId || order.shop.ownerId === userId;
    if (!isParty) {
      const staff = await this.staff.findOne({
        where: { shopId: order.shopId, userId, isActive: true },
      });
      if (!staff || !this.staffCanViewOrder(staff, order))
        throw new ForbiddenException();
    }
    return order;
  }

  /** True if `userId` is the assigned staff (courier) currently handling this order. */
  async isAssignedCourier(userId: string, orderId: string): Promise<boolean> {
    const order = await this.orders.findOne({
      where: { id: orderId },
      select: { id: true, assignedStaffId: true },
    });
    if (!order?.assignedStaffId) return false;
    const staff = await this.staff.findOne({
      where: { id: order.assignedStaffId, userId, isActive: true },
    });
    return !!staff;
  }

  /** ShopStaff.id → User.id — resolves the courier a QR handshake/rating should attribute to. */
  private async resolveCourierUserId(
    assignedStaffId: string | null,
  ): Promise<string | null> {
    if (!assignedStaffId) return null;
    const staff = await this.staff.findOne({
      where: { id: assignedStaffId },
      select: { userId: true },
    });
    return staff?.userId ?? null;
  }

  /**
   * Customer: fetch (lazily issuing) the QR handshake token for a delivering
   * order. Narrow by design — `required` is only true when the assigned
   * courier already has an admin-CONFIRMED risk flag, so this is absent for
   * the overwhelming majority of deliveries.
   */
  async getHandshake(
    userId: string,
    orderId: string,
  ): Promise<{ required: boolean; token?: string }> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.userId !== userId) throw new ForbiddenException();
    if (order.status !== OrderStatus.Delivering) return { required: false };
    const courierUserId = await this.resolveCourierUserId(
      order.assignedStaffId,
    );
    const required = await this.risk.requiresHandshake(courierUserId);
    if (!required) return { required: false };
    const token = await this.risk.getOrIssueHandshakeToken(orderId);
    return { required: true, token };
  }

  /** Courier: verify a scanned QR handshake token before marking delivered — never blocks the delivery itself, only feeds the risk signal. */
  async verifyHandshake(
    userId: string,
    orderId: string,
    token: string,
  ): Promise<{ ok: boolean }> {
    if (!(await this.isAssignedCourier(userId, orderId)))
      throw new ForbiddenException();
    return { ok: await this.risk.verifyHandshake(orderId, token) };
  }

  /**
   * Called by the courier's mobile app — a foreground interval while the
   * order screen is open, or a background location task once the OS wakes
   * it up — to report their live position while delivering. Caches it in
   * Redis for 60s (so a REST latecomer via `GET .../courier-location` still
   * sees something fresh) and broadcasts it to everyone watching the order.
   */
  async updateCourierLocation(
    userId: string,
    orderId: string,
    lat: number,
    lng: number,
    evidenceCtx?: {
      evidence?: LocationEvidenceDto | null;
      deviceId?: string | null;
    },
  ): Promise<{
    orderId: string;
    lat: number;
    lng: number;
    etaMinutes: number | null;
    updatedAt: string;
  }> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.status !== OrderStatus.Delivering) {
      throw new BadRequestException(
        'Buyurtma hozir yetkazilmoqda holatida emas',
      );
    }
    if (!(await this.isAssignedCourier(userId, orderId)))
      throw new ForbiddenException();

    const etaMinutes = order.deliveryAddress
      ? estimateEtaMinutes(
          haversineKm(
            lat,
            lng,
            order.deliveryAddress.latitude,
            order.deliveryAddress.longitude,
          ),
        )
      : null;

    const payload = {
      orderId,
      lat,
      lng,
      etaMinutes,
      updatedAt: new Date().toISOString(),
    };
    // Live-tracking cache/broadcast — byte-identical to before evidence
    // capture existed, the customer map depends on this exact shape.
    await this.redis.client.set(
      `courier:location:${orderId}`,
      JSON.stringify(payload),
      'EX',
      60,
    );
    this.realtime.emitToOrder(orderId, 'courier:location', payload);

    // Durable anti-fraud trail — separate from the 60s cache above.
    const evidence = buildEvidence(
      evidenceCtx?.evidence ?? {
        latitude: lat,
        longitude: lng,
        source: 'background',
      },
      {
        deviceId: evidenceCtx?.deviceId ?? null,
        actorUserId: userId,
        actorRole: 'shop',
      },
    );
    if (evidence) {
      void this.risk.recordCourierPing({
        orderId,
        courierUserId: userId,
        shopId: order.shopId,
        evidence,
      });
    }

    return payload;
  }

  /**
   * All of a customer's currently-active orders (not yet delivered or
   * cancelled), each with its shop, delivery address, and last-known
   * courier location if one is available — powers the multi-order "live
   * tracking" map screen (a user with 2+ simultaneous orders sees every
   * courier at once, not just the one on the order they happen to have open).
   */
  async listActiveDeliveries(userId: string): Promise<
    Array<{
      orderId: string;
      orderNumber: string;
      status: OrderStatus;
      shopId: string;
      shopName: string;
      shopLat: number;
      shopLng: number;
      deliveryAddress: { lat: number; lng: number; address: string } | null;
      courierLocation: {
        lat: number;
        lng: number;
        etaMinutes: number | null;
        updatedAt: string;
      } | null;
    }>
  > {
    const activeStatuses = [
      OrderStatus.New,
      OrderStatus.Accepted,
      OrderStatus.Preparing,
      OrderStatus.Delivering,
    ];
    const orders = await this.orders.find({
      where: { userId, status: In(activeStatuses) },
      relations: { shop: true },
      order: { createdAt: 'DESC' },
    });

    return Promise.all(
      orders.map(async (order) => {
        const raw =
          order.status === OrderStatus.Delivering
            ? await this.redis.client.get(`courier:location:${order.id}`)
            : null;
        return {
          orderId: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          shopId: order.shopId,
          shopName: order.shop.name,
          shopLat: order.shop.latitude,
          shopLng: order.shop.longitude,
          deliveryAddress: order.deliveryAddress
            ? {
                lat: order.deliveryAddress.latitude,
                lng: order.deliveryAddress.longitude,
                address: order.deliveryAddress.address,
              }
            : null,
          courierLocation: raw
            ? (JSON.parse(raw) as {
                lat: number;
                lng: number;
                etaMinutes: number | null;
                updatedAt: string;
              })
            : null,
        };
      }),
    );
  }

  async create(
    userId: string,
    dto: {
      shopId: string;
      deliveryAddressId: string;
      items: { productVariantId: string; quantity: number }[];
      paymentMethod?: PaymentMethod;
      recipientPhone?: string;
      courierComment?: string;
      evidence?: LocationEvidenceDto;
    },
    deviceId?: string | null,
  ): Promise<Order> {
    const shop = await this.shops.findOne({
      where: { id: dto.shopId, isActive: true },
    });
    if (!shop) throw new NotFoundException("Do'kon topilmadi");
    if (shop.isDeliveryEnabled === false) {
      throw new BadRequestException(
        "Ushbu do'konda yetkazib berish xizmati mavjud emas. Mahsulotlarni faqat do'kondan xarid qilish mumkin.",
      );
    }
    if (!isShopOpenNow(shop)) {
      throw new BadRequestException(
        "Do'kon hozir yopiq — buyurtma qabul qilmaydi",
      );
    }
    if (!isDeliveryOpenNow(shop)) {
      throw new BadRequestException(
        "Do'konda ayni vaqtda yetkazib berish xizmati ishlamayapti",
      );
    }
    if (shop.blockedUserIds.includes(userId)) {
      throw new ForbiddenException(
        "Bu do'kon sizdan buyurtma qabul qila olmaydi",
      );
    }

    // Enforce single-shop active order constraint: a customer may only order
    // from another shop once their active order from a different shop is concluded.
    const activeOrderOtherShop = await this.orders.findOne({
      where: {
        userId,
        status: In([
          OrderStatus.New,
          OrderStatus.Accepted,
          OrderStatus.Preparing,
          OrderStatus.Delivering,
        ]),
        shopId: Not(dto.shopId),
      },
    });
    if (activeOrderOtherShop) {
      throw new BadRequestException(
        "Sizda boshqa do'kondan faol buyurtma mavjud. Avval uni yakunlang yoki kuting.",
      );
    }

    const address = await this.addresses.findOne({
      where: { id: dto.deliveryAddressId, userId },
    });
    if (!address) throw new NotFoundException('Manzil topilmadi');

    const distanceKm = haversineKm(
      address.latitude,
      address.longitude,
      shop.latitude,
      shop.longitude,
    );
    // A configured delivery polygon is authoritative over the circle radius
    // (mirrors products.service.ts's feedNearby reachability check) — a shop
    // with an irregular delivery area shouldn't be limited to a circle.
    const isReachable = shop.deliveryPolygon
      ? pointInPolygon(
          address.latitude,
          address.longitude,
          shop.deliveryPolygon,
        )
      : distanceKm <= shop.deliveryZone.maxKm;
    if (!isReachable) {
      throw new BadRequestException(
        "Manzil do'konning yetkazib berish zonasidan tashqarida",
      );
    }

    const variantIds = dto.items.map((i) => i.productVariantId);
    const variants = await this.variants.find({
      where: { id: In(variantIds), shopId: shop.id, isActive: true },
    });
    if (variants.length !== dto.items.length) {
      throw new BadRequestException('Bir yoki bir nechta mahsulot topilmadi');
    }

    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const nameMap = await this.variantNameMap(variants);
    const categoryMap = await this.variantCategoryMap(variants);
    // Fetch the shop's active promos ONCE — every cart line was re-querying
    // the same shop-wide promo list before (N+1 for an N-item cart).
    const shopPromos = await this.promotions.findActivePromosForShop(shop.id);
    let subTotal = 0;
    const lineItems: {
      variant: ProductVariant;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      promotionId: string | null;
      promotionDiscountAmount: number;
    }[] = [];
    for (const it of dto.items) {
      const v = variantMap.get(it.productVariantId);
      if (!v) throw new BadRequestException('Mahsulot topilmadi');
      if (v.stock < it.quantity) {
        throw new BadRequestException(
          `"${nameMap.get(v.id) ?? ''}" mahsulotidan ${v.stock} ta qoldi, ${it.quantity} ta so'ralgan`,
        );
      }
      const basePrice = v.discountPrice ?? v.price;
      // Promotions are computed dynamically at order time (never mutate
      // ProductVariant.discountPrice) and snapshotted onto the OrderItem.
      const promo = this.promotions.bestDiscountFor(
        shopPromos,
        v.id,
        categoryMap.get(v.id) ?? null,
        basePrice,
      );
      const unitPrice = Math.max(0, basePrice - promo.discountAmount);
      const lineTotal = unitPrice * it.quantity;
      subTotal += lineTotal;
      lineItems.push({
        variant: v,
        quantity: it.quantity,
        unitPrice,
        lineTotal,
        promotionId: promo.promotionId,
        promotionDiscountAmount: promo.discountAmount * it.quantity,
      });
    }

    if (subTotal < shop.minOrderPrice) {
      throw new BadRequestException(
        `Minimal buyurtma narxi: ${shop.minOrderPrice} so'm`,
      );
    }

    // Platforma-darajali minimal buyurtma (unit economics himoyasi): juda
    // kichik buyurtmada Click ekvayring + SMS + payout xarajatlari
    // komissiyadan oshib ketadi — har bir shunday buyurtma platformaga zarar.
    // Do'kon o'z minimumini bundan yuqori qo'yishi mumkin (yuqoridagi check).
    const platformMin = this.settings.getNumber(
      SETTING_KEYS.MIN_ORDER_TOTAL,
      0,
    );
    if (platformMin > 0 && subTotal < platformMin) {
      throw new BadRequestException(
        `Minimal buyurtma summasi: ${platformMin} so'm`,
      );
    }

    // Free-delivery polygon is authoritative over the circle-based freeKm too
    // (mirrors products.service.ts's feedNearby fee calc) — a customer inside
    // the configured free-delivery polygon must not be charged a fee.
    const isFreeByPolygon =
      shop.freeDeliveryPolygon != null &&
      pointInPolygon(
        address.latitude,
        address.longitude,
        shop.freeDeliveryPolygon,
      );
    let deliveryFee = isFreeByPolygon
      ? 0
      : calcDeliveryFee({
          distanceKm,
          freeKm: shop.deliveryZone.freeKm,
          pricingType: shop.deliveryZone.pricingType,
          pricePerStep: shop.deliveryZone.pricePerStep,
        });
    // Shop-level free_delivery promotion against the cart subtotal.
    const freeDelivery = await this.promotions.findFreeDeliveryPromotion(
      shop.id,
      subTotal,
    );
    if (freeDelivery.free) deliveryFee = 0;

    // Snapshot the commission rate NOW (seller's active Prime rate, or the
    // current global default) — settlement must use this, not whatever rate
    // happens to be active on delivery day (SPEC §10.1: not retroactive).
    const defaultCommissionRate = this.settings.getNumber(
      SETTING_KEYS.COMMISSION_RATE_DEFAULT,
    );
    const commissionRateSnapshot = await this.prime.getCommissionRate(
      shop.ownerId,
      defaultCommissionRate,
    );

    const lowAlerts: { name: string; stock: number }[] = [];
    const created = await this.dataSource.transaction(async (manager) => {
      const order = manager.create(Order, {
        userId,
        shopId: shop.id,
        deliveryAddressId: address.id,
        // Immutable copy — the saved address may be edited/deleted later.
        deliveryAddress: {
          label: address.label,
          address: address.address,
          latitude: address.latitude,
          longitude: address.longitude,
          entrance: address.entrance,
          floor: address.floor,
          apartment: address.apartment,
          intercom: address.intercom,
        },
        orderEvidence: buildEvidence(dto.evidence, {
          deviceId: deviceId ?? null,
          actorUserId: userId,
          actorRole: 'customer',
        }),
        orderNumber: orderNumberGen(),
        subTotal,
        deliveryFee,
        total: subTotal + deliveryFee,
        distanceKm,
        status: OrderStatus.New,
        paymentMethod: dto.paymentMethod ?? PaymentMethod.Cash,
        paymentStatus:
          (dto.paymentMethod ?? PaymentMethod.Cash) ===
          PaymentMethod.ClickOnline
            ? PaymentStatus.Pending
            : PaymentStatus.NotRequired,
        commissionRateSnapshot,
        recipientPhone: dto.recipientPhone ?? null,
        courierComment: dto.courierComment ?? null,
        timeline: [
          {
            status: OrderStatus.New,
            at: new Date().toISOString(),
            byUserId: userId,
          },
        ],
      });
      const savedOrder = await manager.save(order);

      // Lock variants in a fixed (id-ascending) order, not cart order — two
      // orders sharing the same products but submitted with items in a
      // different sequence could otherwise each hold one lock while waiting
      // on the other's, deadlocking. A consistent global lock order rules
      // that out regardless of how any given cart was assembled.
      const sortedLineItems = [...lineItems].sort((a, b) =>
        a.variant.id.localeCompare(b.variant.id),
      );
      for (const li of sortedLineItems) {
        // Re-read the row WITH a write lock inside the transaction and re-check
        // stock — this serialises concurrent orders and prevents overselling
        // (the earlier check was outside the transaction).
        const locked = await manager.findOne(ProductVariant, {
          where: { id: li.variant.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked) throw new BadRequestException('Mahsulot topilmadi');
        if (locked.stock < li.quantity) {
          throw new BadRequestException(
            `"${nameMap.get(locked.id) ?? ''}" mahsulotidan ${locked.stock} ta qoldi`,
          );
        }
        const beforeStock = locked.stock;
        // Drain oldest FIFO batches first; the returned cost of goods lets us
        // compute this order's profit later.
        const pName = nameMap.get(locked.id) ?? '';
        const { costOfGoods } = await consumeFifo(manager, {
          variant: locked,
          quantity: li.quantity,
          type: MovementType.Sold,
          orderId: savedOrder.id,
          displayName: pName,
          reason: 'Sotildi',
        });
        // Alert the shop only when this sale pushes the item to/below its
        // low-stock threshold for the first time.
        if (
          beforeStock > locked.lowStockThreshold &&
          locked.stock <= locked.lowStockThreshold
        ) {
          lowAlerts.push({ name: pName, stock: locked.stock });
        }
        const item = manager.create(OrderItem, {
          orderId: savedOrder.id,
          productVariantId: locked.id,
          productName: pName,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          lineTotal: li.lineTotal,
          costOfGoods,
          appliedPromotionId: li.promotionId,
          promotionDiscountAmount: li.promotionDiscountAmount,
        });
        await manager.save(item);
      }

      return manager.findOne(Order, {
        where: { id: savedOrder.id },
        relations: { items: true },
      }) as Promise<Order>;
    });
    this.emitOrderEvent('order:new', created);
    void this.notifyNewOrder(shop, created);
    if (lowAlerts.length > 0) void this.notifyLowStock(shop, lowAlerts);
    return created;
  }

  /** Tell the shop owner + staff which items just hit their low-stock line. */
  private async notifyLowStock(
    shop: Pick<Shop, 'id' | 'ownerId'>,
    lowAlerts: { name: string; stock: number }[],
  ): Promise<void> {
    const staff = await this.staff.find({
      where: { shopId: shop.id, isActive: true },
    });
    const recipients = [
      ...new Set([shop.ownerId, ...staff.map((s) => s.userId)]),
    ];
    const body =
      lowAlerts.length === 1
        ? `${lowAlerts[0].name} — ${lowAlerts[0].stock} ta qoldi`
        : `${lowAlerts.length} ta mahsulot kam qoldi: ${lowAlerts.map((a) => a.name).join(', ')}`;
    await this.push.sendToUsers(recipients, {
      title: 'Mahsulot kam qoldi',
      body,
      data: { kind: 'stock:low', shopId: shop.id },
    });
  }

  /**
   * In-store ("counter") sale: the seller or a permitted cashier scans/picks
   * products and rings them up on the spot. Recorded as an anonymous, already
   * "delivered" cash order with no delivery — stock is drawn down via FIFO so
   * inventory and the profit report stay accurate.
   */
  async createInStoreSale(
    userId: string,
    shopId: string,
    items: { productVariantId: string; quantity: number }[],
  ): Promise<Order> {
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException("Do'kon topilmadi");
    if (shop.ownerId !== userId) {
      const staff = await this.staff.findOne({
        where: { shopId, userId, isActive: true },
      });
      if (!staff?.permissions.includes('sales.instore')) {
        throw new ForbiddenException("Do'konda sotish uchun ruxsat yo'q");
      }
    }
    if (!items.length)
      throw new BadRequestException('Hech qanday mahsulot tanlanmadi');

    const variants = await this.variants.find({
      where: {
        id: In(items.map((i) => i.productVariantId)),
        shopId,
        isActive: true,
      },
    });
    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const nameMap = await this.variantNameMap(variants);
    let subTotal = 0;
    const lineItems: {
      variant: ProductVariant;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
    }[] = [];
    for (const it of items) {
      const v = variantMap.get(it.productVariantId);
      if (!v) throw new BadRequestException('Mahsulot topilmadi');
      if (v.stock < it.quantity) {
        throw new BadRequestException(
          `"${nameMap.get(v.id) ?? ''}" qoldig'i yetarli emas (${v.stock} ta)`,
        );
      }
      const unitPrice = v.discountPrice ?? v.price;
      const lineTotal = unitPrice * it.quantity;
      subTotal += lineTotal;
      lineItems.push({
        variant: v,
        quantity: it.quantity,
        unitPrice,
        lineTotal,
      });
    }

    const now = new Date().toISOString();
    return this.dataSource
      .transaction(async (manager) => {
        const order = manager.create(Order, {
          userId: null,
          shopId,
          deliveryAddressId: null,
          channel: OrderChannel.InStore,
          orderNumber: orderNumberGen(),
          subTotal,
          deliveryFee: 0,
          total: subTotal,
          distanceKm: 0,
          status: OrderStatus.Delivered,
          paymentMethod: PaymentMethod.Cash,
          timeline: [
            { status: OrderStatus.New, at: now, byUserId: userId },
            {
              status: OrderStatus.Delivered,
              at: now,
              byUserId: userId,
              note: "Do'konda sotildi",
            },
          ],
        });
        const savedOrder = await manager.save(order);
        for (const li of lineItems) {
          const locked = await manager.findOne(ProductVariant, {
            where: { id: li.variant.id },
            lock: { mode: 'pessimistic_write' },
          });
          const liName = nameMap.get(li.variant.id) ?? '';
          if (!locked || locked.stock < li.quantity) {
            throw new BadRequestException(`"${liName}" qoldig'i yetarli emas`);
          }
          const { costOfGoods } = await consumeFifo(manager, {
            variant: locked,
            quantity: li.quantity,
            type: MovementType.Sold,
            orderId: savedOrder.id,
            userId,
            displayName: liName,
            reason: "Do'konda sotildi",
          });
          await manager.save(
            manager.create(OrderItem, {
              orderId: savedOrder.id,
              productVariantId: li.variant.id,
              productName: liName,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              lineTotal: li.lineTotal,
              costOfGoods,
            }),
          );
        }
        return manager.findOneOrFail(Order, {
          where: { id: savedOrder.id },
          // taxCategory ham qaytadi — POS sotuvdan keyin markirovkali tovar
          // bo'lsa skanerlash oqimiga yo'naltirish uchun.
          relations: {
            items: { productVariant: { globalProduct: { taxCategory: true } } },
          },
        });
      })
      .then((order) => {
        // Do'konda naqd sotildi — pul shu zahoti olindi, chek ham shu zahoti.
        void this.fiscal.createSaleReceipt(order.id);
        return order;
      });
  }

  /** Push a new-order alert to the shop owner and every active staff member. */
  private async notifyNewOrder(
    shop: Pick<Shop, 'id' | 'ownerId' | 'photos'>,
    order: Pick<Order, 'id' | 'orderNumber' | 'total'>,
  ): Promise<void> {
    const staff = await this.staff.find({
      where: { shopId: shop.id, isActive: true },
    });
    const recipients = [
      ...new Set([shop.ownerId, ...staff.map((s) => s.userId)]),
    ];
    await this.push.sendToUsers(recipients, {
      title: 'Yangi buyurtma',
      body: `#${order.orderNumber} — ${order.total.toLocaleString()} so'm`,
      data: {
        orderId: order.id,
        kind: 'order:new',
        shopId: shop.id,
        forSeller: true,
      },
      imageUrl: shop.photos?.[0],
    });
  }

  async listForUser(userId: string): Promise<Omit<Order, OrderEvidenceKey>[]> {
    const orders = await this.orders.find({
      where: { userId },
      relations: { items: true, shop: true },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return orders.map(omitOrderEvidence);
  }

  async listForShop(
    actorUserId: string,
    shopId: string,
    status?: OrderStatus,
  ): Promise<Omit<Order, OrderEvidenceKey>[]> {
    // Owner or any staff who can view orders (full or assigned).
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException("Do'kon topilmadi");
    let effectiveStatus = status;
    let assignedToStaffId: string | null = null;
    if (shop.ownerId !== actorUserId) {
      const member = await this.staff.findOne({
        where: { shopId, userId: actorUserId, isActive: true },
      });
      const canViewAll = member?.permissions?.includes('orders.view_all');
      const canViewAssigned = member?.permissions?.includes(
        'orders.view_assigned',
      );
      if (!canViewAll && !canViewAssigned) {
        throw new ForbiddenException("Buyurtmalarni ko'rishga ruxsat yo'q");
      }
      // Couriers (assigned-only) see only the orders assigned to them that are at
      // the delivery stage — not new/unaccepted orders.
      if (!canViewAll) {
        effectiveStatus = OrderStatus.Delivering;
        assignedToStaffId = member?.id ?? '∅';
      }
    }
    const qb = this.dataSource
      .createQueryBuilder(Order, 'o')
      .leftJoinAndSelect('o.items', 'items')
      .leftJoinAndSelect('items.productVariant', 'pv')
      // Photos live on GlobalProduct, not ProductVariant — join through so
      // the seller app can show a product image per order line.
      .leftJoinAndSelect('pv.globalProduct', 'gp')
      .leftJoinAndSelect('o.user', 'usr')
      .where('o.shopId = :shopId', { shopId });
    if (effectiveStatus)
      qb.andWhere('o.status = :status', { status: effectiveStatus });
    if (assignedToStaffId)
      qb.andWhere('o.assignedStaffId = :asid', { asid: assignedToStaffId });
    const orders = await qb.orderBy('o.createdAt', 'DESC').take(200).getMany();
    return orders.map(omitOrderEvidence);
  }

  /** Assign (or unassign) an order to a staff member — e.g. a delivery courier. */
  async assignOrder(
    actorUserId: string,
    shopId: string,
    orderId: string,
    staffId: string | null,
  ): Promise<Omit<Order, OrderEvidenceKey>> {
    const order = await this.orders.findOne({
      where: { id: orderId, shopId },
      relations: { shop: true },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    await this.assertShopCanManage(actorUserId, order, 'orders.update_status');
    if (staffId) {
      const member = await this.staff.findOne({
        where: { id: staffId, shopId, isActive: true },
      });
      if (!member) throw new BadRequestException('Xodim topilmadi');
      order.assignedStaffId = staffId;
      void this.push.sendToUser(member.userId, {
        title: 'Sizga buyurtma biriktirildi',
        body: `#${order.orderNumber} — yetkazib berish uchun`,
        data: { kind: 'order:assigned', orderId: order.id, shopId },
      });
    } else {
      order.assignedStaffId = null;
    }
    return omitOrderEvidence(await this.orders.save(order));
  }

  async getOne(
    userId: string,
    orderId: string,
  ): Promise<
    Omit<Order, OrderEvidenceKey> & {
      reviewedVariantIds: string[];
      courierReviewed: boolean;
      shopReviewed: boolean;
      requiresHandshake: boolean;
      complaint: {
        status: string;
        reason: string;
        createdAt: Date;
        resolvedAt: Date | null;
      } | null;
      refund: { amount: number; at: Date } | null;
    }
  > {
    const order = await this.orders.findOne({
      where: { id: orderId },
      // Photos live on GlobalProduct, not ProductVariant (each shop's variant
      // is just price/stock) — load through to it so the app can show a
      // product image per order line.
      relations: {
        // taxCategory ham yuklanadi — mobil seller UI markirovka talab
        // qilinadigan qatorlarni (markingRequired) shu orqali biladi.
        items: { productVariant: { globalProduct: { taxCategory: true } } },
        shop: true,
        user: true,
      },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const isParty = order.userId === userId || order.shop.ownerId === userId;
    if (!isParty) {
      // Staff need the matching view permission — not just active membership
      // (e.g. a warehouse-only hire has no business reading customer PII).
      const staff = await this.staff.findOne({
        where: { shopId: order.shopId, userId, isActive: true },
      });
      if (!staff || !this.staffCanViewOrder(staff, order))
        throw new ForbiddenException();
    }
    const [myReviews, myPartyReviews] = order.userId
      ? await Promise.all([
          this.reviews.find({
            where: {
              orderId,
              userId: order.userId,
              target: ReviewTarget.Product,
            },
            select: { productVariantId: true },
          }),
          this.reviews.find({
            where: {
              orderId,
              userId: order.userId,
              target: In([ReviewTarget.Courier, ReviewTarget.Shop]),
            },
            select: { target: true },
          }),
        ])
      : [[], []];

    // Surface dispute + refund state so the customer (and shop side) can see
    // whether an order is under complaint or has already been refunded —
    // both already tracked in the DB but never returned before now.
    const complaint = await this.complaints.getForOrder(orderId);
    const refundTx = await this.sellerTransactions.findOne({
      where: { orderId, type: SellerTxType.RefundDebit },
    });
    // Plain boolean, not the token itself — safe for both customer and shop
    // reads. Lets the seller app decide whether to open the QR scanner
    // without a second round-trip.
    const requiresHandshake =
      order.status === OrderStatus.Delivering
        ? await this.risk.requiresHandshake(
            await this.resolveCourierUserId(order.assignedStaffId),
          )
        : false;

    return {
      ...omitOrderEvidence(order),
      reviewedVariantIds: myReviews.map((r) => r.productVariantId as string),
      courierReviewed: myPartyReviews.some(
        (r) => r.target === ReviewTarget.Courier,
      ),
      shopReviewed: myPartyReviews.some((r) => r.target === ReviewTarget.Shop),
      requiresHandshake,
      complaint: complaint
        ? {
            status: complaint.status,
            reason: complaint.reason,
            createdAt: complaint.createdAt,
            resolvedAt: complaint.resolvedAt,
          }
        : null,
      refund: refundTx
        ? { amount: parseFloat(refundTx.amount), at: refundTx.createdAt }
        : null,
    };
  }

  async updateStatus(
    actorUserId: string,
    orderId: string,
    nextStatus: OrderStatus,
    note?: string,
    evidenceCtx?: {
      evidence?: LocationEvidenceDto | null;
      deviceId?: string | null;
    },
  ): Promise<Omit<Order, OrderEvidenceKey>> {
    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: { shop: true },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');

    const isCustomer = order.userId === actorUserId;
    const evidence = buildEvidence(evidenceCtx?.evidence, {
      deviceId: evidenceCtx?.deviceId ?? null,
      actorUserId,
      actorRole: isCustomer ? 'customer' : 'shop',
    });

    const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.New]: [
        OrderStatus.Accepted,
        OrderStatus.Cancelled,
        OrderStatus.SellerRejected,
      ],
      [OrderStatus.Accepted]: [OrderStatus.Preparing, OrderStatus.Cancelled],
      [OrderStatus.Preparing]: [OrderStatus.Delivering, OrderStatus.Cancelled],
      [OrderStatus.Delivering]: [OrderStatus.Delivered, OrderStatus.Cancelled],
      [OrderStatus.Delivered]: [],
      [OrderStatus.Cancelled]: [],
      [OrderStatus.SellerNoResponse]: [],
      [OrderStatus.SellerRejected]: [],
    };

    if (!allowedTransitions[order.status].includes(nextStatus)) {
      throw new BadRequestException(
        `Status ${order.status} -> ${nextStatus} mumkin emas`,
      );
    }

    // Shop-side transitions are allowed for the owner OR active staff holding
    // the matching permission (kassir accepts, courier delivers, etc.).
    if (nextStatus === OrderStatus.Accepted) {
      await this.assertShopCanManage(actorUserId, order, 'orders.accept');
    } else if (
      [OrderStatus.Preparing, OrderStatus.Delivering].includes(nextStatus)
    ) {
      await this.assertShopCanManage(
        actorUserId,
        order,
        'orders.update_status',
      );
    } else if (nextStatus === OrderStatus.Delivered) {
      // The customer confirms receipt; the shop side (owner/courier) may also.
      if (!isCustomer)
        await this.assertShopCanManage(
          actorUserId,
          order,
          'orders.update_status',
        );
    } else if (nextStatus === OrderStatus.Cancelled) {
      if (isCustomer) {
        // The customer may cancel while the shop hasn't dispatched it yet,
        // but not once a courier is already en route (delivering).
        const customerCancellableFrom: OrderStatus[] = [
          OrderStatus.New,
          OrderStatus.Accepted,
          OrderStatus.Preparing,
        ];
        if (!customerCancellableFrom.includes(order.status)) {
          throw new BadRequestException(
            "Yetkazib berish boshlangandan keyin buyurtmani bekor qilib bo'lmaydi",
          );
        }
        // A paid online order can be self-service cancelled only while the
        // shop hasn't accepted it — the money goes straight back to the card
        // via payment/reversal (hooked after the transition below). Once the
        // shop has started working on it, route to support instead.
        if (
          order.paymentMethod === PaymentMethod.ClickOnline &&
          order.paymentStatus === PaymentStatus.Paid &&
          order.status !== OrderStatus.New
        ) {
          throw new BadRequestException(
            "Buyurtma allaqachon to'langan va do'kon qabul qilgan — bekor qilish uchun qo'llab-quvvatlash xizmatiga murojaat qiling",
          );
        }
      } else {
        await this.assertShopCanManage(actorUserId, order, 'orders.cancel');
      }
    } else if (nextStatus === OrderStatus.SellerRejected) {
      // Distinct from a customer-initiated Cancelled: this is the shop
      // explicitly declining a not-yet-accepted order, which triggers the
      // customer-side "try another store" suggestion flow — a customer can
      // never set this on their own order (they'd just Cancel it instead).
      if (isCustomer) throw new ForbiddenException();
      await this.assertShopCanManage(actorUserId, order, 'orders.cancel');
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      // Re-read WITH a write lock and re-check the transition — the check
      // above ran against a possibly-stale read. Without this, two
      // concurrent calls (double-tap, retry, or racing the 5-min auto-cancel
      // cron) could both pass the earlier check and both cancel/restock the
      // same order.
      const locked = await manager.findOne(Order, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Buyurtma topilmadi');
      if (!allowedTransitions[locked.status].includes(nextStatus)) {
        throw new BadRequestException(
          `Status ${locked.status} -> ${nextStatus} mumkin emas`,
        );
      }

      locked.status = nextStatus;
      const event: OrderTimelineEvent = {
        status: nextStatus,
        at: new Date().toISOString(),
        byUserId: actorUserId,
        note,
      };
      locked.timeline = [...locked.timeline, event];
      // Location-evidence layer (anti-fraud) — recorded, not enforced. See
      // server/src/geo/location-evidence.ts and the risk module (later phase).
      if (nextStatus === OrderStatus.Delivering) {
        locked.dispatchedEvidence = evidence;
      } else if (nextStatus === OrderStatus.Delivered) {
        locked.deliveredEvidence = evidence;
        // Only when the shop side confirmed — a customer self-confirm isn't
        // a courier action and must never be attributed as one.
        if (!isCustomer) locked.deliveredByUserId = actorUserId;
      }
      if (
        nextStatus === OrderStatus.Cancelled ||
        nextStatus === OrderStatus.SellerRejected
      ) {
        locked.cancellationReason =
          note ??
          (nextStatus === OrderStatus.SellerRejected
            ? "Do'kon buyurtmani rad etdi"
            : null);
        await this.restockOrder(manager, locked.id);
      }
      return manager.save(locked);
    });

    // Hook financial settlement when order is delivered
    if (nextStatus === OrderStatus.Delivered) {
      void this.settleDeliveredOrder(order).catch((err) =>
        this.logger.error(
          `Payment settlement failed for order ${order.id}: ${err.message}`,
        ),
      );
      // Fiskal chek: naqd buyurtmada pul shu paytda olinadi. Onlaynda chek
      // to'lov webhookida chiqqan — createSaleReceipt idempotent, shuning
      // uchun bu chaqiruv webhook paytida yiqilgan chekni ham qoplaydi.
      void this.fiscal.createSaleReceipt(order.id);
    }

    // Anti-fraud location-evidence rules — fire-and-forget, never affects the order flow.
    if (nextStatus === OrderStatus.Delivering) {
      void this.risk.onOrderDispatched({
        orderId: saved.id,
        shop: {
          latitude: order.shop.latitude,
          longitude: order.shop.longitude,
        },
        evidence,
      });
    } else if (nextStatus === OrderStatus.Delivered) {
      void this.risk.onOrderDelivered({
        orderId: saved.id,
        deliveryAddress: saved.deliveryAddress
          ? {
              latitude: saved.deliveryAddress.latitude,
              longitude: saved.deliveryAddress.longitude,
            }
          : null,
        deliveredByUserId: saved.deliveredByUserId,
        evidence,
      });
    }

    // A captured Click payment must follow its order out the door: any
    // cancel/reject of a paid order triggers an automatic reversal. Fire and
    // forget — the cancel response shouldn't wait on Click, and
    // retryPendingRefunds() re-runs any attempt that fails here.
    if (
      (nextStatus === OrderStatus.Cancelled ||
        nextStatus === OrderStatus.SellerRejected) &&
      order.paymentMethod === PaymentMethod.ClickOnline &&
      order.paymentStatus === PaymentStatus.Paid
    ) {
      void this.click
        .refundPaidOrder(order.id)
        .then((refunded) => {
          if (refunded && order.userId) {
            void this.push.sendToUser(order.userId, {
              title: `Buyurtma #${order.orderNumber}`,
              body: "To'lovingiz qaytarildi — pul kartangizga 1-3 ish kunida tushadi",
              data: { orderId: order.id, kind: 'order:refunded' },
            });
          }
        })
        .catch((err) =>
          this.logger.error(
            `Refund failed for order ${order.id}: ${err.message}`,
          ),
        );
    }

    this.emitOrderEvent('order:updated', saved);
    // Notify the customer when the shop advances the order; notify the shop
    // when the customer confirms delivery or cancels.
    // Shop-side actor (owner OR staff) → notify the customer; customer confirming
    // → notify the shop owner.
    const target = !isCustomer ? saved.userId : order.shop.ownerId;
    const shopPhoto = order.shop.photos?.[0];
    // SellerRejected gets its own notification `kind` (rather than the
    // generic `order:updated`) so the mobile app knows to surface the
    // "try another store" suggestion flow when the customer taps it.
    const kind =
      nextStatus === OrderStatus.SellerRejected
        ? 'order:seller_rejected'
        : 'order:updated';
    if (target)
      void this.push.sendToUser(target, {
        title: `Buyurtma #${saved.orderNumber}`,
        body: OrdersService.STATUS_LABEL[saved.status],
        data: {
          orderId: saved.id,
          kind,
          ...(!isCustomer ? { shopId: order.shopId, forSeller: false } : {}),
        },
        imageUrl: shopPhoto,
      });
    // `saved` is what we just wrote evidence INTO — strip it before it goes
    // back over the wire to whichever party (customer or shop) called this.
    return omitOrderEvidence(saved);
  }

  /**
   * Customer: switch how a not-yet-paid order gets paid — cash <-> card.
   * Locked once Click confirms payment (there's no automated way to undo a
   * captured charge, same reasoning as the paid-order-immune auto-cancel in
   * autoCancelStaleNewOrders) or once the order is otherwise dead.
   */
  async changePaymentMethod(
    userId: string,
    orderId: string,
    method: PaymentMethod,
  ): Promise<Order> {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(Order, {
        where: { id: orderId, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException('Buyurtma topilmadi');
      if (PAYMENT_METHOD_LOCKED_STATUSES.includes(order.status)) {
        throw new BadRequestException(
          "Bu buyurtma uchun to'lov turini o'zgartirib bo'lmaydi",
        );
      }
      if (order.paymentStatus === PaymentStatus.Paid) {
        throw new BadRequestException(
          "Buyurtma allaqachon to'langan — to'lov turini o'zgartirib bo'lmaydi",
        );
      }
      if (order.paymentMethod === method) return order;

      order.paymentMethod = method;
      order.paymentStatus =
        method === PaymentMethod.Cash
          ? PaymentStatus.NotRequired
          : PaymentStatus.Pending;
      return manager.save(order);
    });
  }

  /**
   * Customer: give the silent shop another 5-minute acceptance window on a
   * PAID order instead of cancelling for a refund. Restarts the no-response
   * clock (reRequestedAt) and re-arms the one-time urgent alert, plus pings
   * the shop immediately. Only meaningful for paid orders — unpaid ones are
   * auto-closed by autoCancelStaleNewOrders at the 5-minute mark anyway.
   */
  async reRequestOrder(userId: string, orderId: string): Promise<Order> {
    const order = await this.orders.findOne({
      where: { id: orderId, userId },
      relations: { shop: true },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.status !== OrderStatus.New) {
      throw new BadRequestException("Buyurtma allaqachon ko'rib chiqilgan");
    }
    if (
      order.paymentMethod !== PaymentMethod.ClickOnline ||
      order.paymentStatus !== PaymentStatus.Paid
    ) {
      throw new BadRequestException(
        "Qayta so'rov faqat to'langan buyurtmalar uchun",
      );
    }
    const anchor = order.reRequestedAt ?? order.createdAt;
    if (Date.now() - anchor.getTime() < AUTO_CANCEL_MS) {
      throw new BadRequestException(
        "Do'konga hali javob berish uchun vaqt berilgan — biroz kuting",
      );
    }

    order.reRequestedAt = new Date();
    order.paidUnacceptedAlertSentAt = null;
    order.timeline = [
      ...order.timeline,
      {
        status: OrderStatus.New,
        at: new Date().toISOString(),
        byUserId: userId,
        note: 'customer-re-request',
      },
    ];
    const saved = await this.orders.save(order);

    const staff = await this.staff.find({
      where: { shopId: order.shopId, isActive: true },
    });
    const recipients = [
      ...new Set([order.shop.ownerId, ...staff.map((s) => s.userId)]),
    ];
    void this.push.sendToUsers(recipients, {
      title: '⚠️ Mijoz javob kutmoqda',
      body: `#${order.orderNumber} — to'langan buyurtma uchun mijoz qayta so'rov yubordi. Zudlik bilan qabul qiling!`,
      data: {
        orderId: order.id,
        kind: 'order:paid_unaccepted',
        shopId: order.shopId,
        forSeller: true,
      },
    });
    this.emitOrderEvent('order:updated', saved);
    return saved;
  }

  private async settleDeliveredOrder(
    order: Pick<
      Order,
      | 'id'
      | 'shop'
      | 'total'
      | 'paymentMethod'
      | 'commissionRateSnapshot'
      | 'commissionExempt'
    >,
  ): Promise<void> {
    const sellerId = order.shop.ownerId;
    // Use the rate captured at order-creation time — never recompute from
    // whatever's active now (SPEC §10.1: rate changes aren't retroactive).
    // Falls back to the current rate only for orders placed before this
    // snapshot column existed.
    let commissionRate = order.commissionRateSnapshot;
    if (commissionRate == null) {
      const defaultRate = this.settings.getNumber(
        SETTING_KEYS.COMMISSION_RATE_DEFAULT,
      );
      commissionRate = await this.prime.getCommissionRate(
        sellerId,
        defaultRate,
      );
    }
    // Admin `exempt` flag overrides everything else — 0% regardless of
    // whatever rate was snapshotted (SPEC §10.3).
    if (order.commissionExempt) commissionRate = 0;

    if (order.paymentMethod === PaymentMethod.Cash) {
      await this.payments.recordCashOrderDelivery({
        sellerId,
        orderId: order.id,
        orderTotal: order.total,
        commissionRate,
      });
    } else {
      await this.payments.recordOnlineOrderDelivery({
        sellerId,
        orderId: order.id,
        orderTotal: order.total,
        commissionRate,
      });
    }
  }

  /**
   * Business rule #5: a `new` order the shop hasn't accepted within 5 minutes
   * moves to SellerNoResponse — stock is returned and the customer is
   * notified. This is NOT the same as Cancelled: the customer didn't do
   * anything wrong, so the notification/order screen offers "try another
   * store" suggestions instead of just reporting a dead end. Runs every
   * minute.
   *
   * Paid Click orders follow a gentler track: at 5 minutes both sides get
   * alerted (shop: "accept now!", customer: "wait / re-request / cancel for
   * a refund" — see alertStalePaidOrders), and only after
   * PAID_AUTO_CANCEL_MS of continued silence does
   * autoRefundAbandonedPaidOrders force-close them with an automatic
   * payment/reversal.
   */
  async autoCancelStaleNewOrders(): Promise<void> {
    return this.getLifecycleCronService().autoCancelStaleNewOrders();
  }

  async retryPendingRefunds(): Promise<void> {
    return this.getLifecycleCronService().retryPendingRefunds();
  }

  private async restockOrder(
    manager: import('typeorm').EntityManager,
    orderId: string,
  ) {
    const items = await manager.find(OrderItem, { where: { orderId } });
    if (items.length === 0) return;
    // Fixed (id-ascending) lock order — see the matching comment in create()
    // for why (avoids a deadlock between two orders sharing variants).
    const sortedItems = [...items].sort((a, b) =>
      a.productVariantId.localeCompare(b.productVariantId),
    );
    for (const item of sortedItems) {
      // Locked individually (FindManyOptions has no `lock`) so this can't
      // lost-update against another concurrent stock change on the same variant.
      const variant = await manager.findOne(ProductVariant, {
        where: { id: item.productVariantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!variant) continue;
      const restockQty = item.quantity - item.returnedQuantity;
      if (restockQty <= 0) continue;
      // Unit cost = remaining cost of goods spread over the still-sold units.
      const unitCost = unitCostOf(item.costOfGoods, restockQty);
      await restockReturn(manager, {
        variant,
        quantity: restockQty,
        unitCost,
        orderId,
        reason: 'Bekor qilindi',
      });
      // All remaining units go back → the line's cost of goods becomes 0.
      item.costOfGoods = 0;
      item.returnedQuantity = item.quantity;
      await manager.save(item);
    }
  }

  async partialReturn(
    userId: string,
    orderId: string,
    returns: { orderItemId: string; quantity: number }[],
    reason?: string,
  ): Promise<Order> {
    const preCheck = await this.orders.findOne({
      where: { id: orderId },
      relations: { shop: true },
    });
    if (!preCheck) throw new NotFoundException('Buyurtma topilmadi');
    // Returns are marked by the shop side (seller/courier) at hand-off, before
    // the customer pays cash — not by the customer.
    await this.assertShopCanManage(userId, preCheck, 'orders.update_status');

    await this.dataSource.transaction(async (manager) => {
      // Re-read WITH a write lock and re-check status inside the transaction
      // — two concurrent partialReturn calls (or one racing a cancel) must
      // not both act on the same stale item quantities.
      const order = await manager.findOne(Order, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException('Buyurtma topilmadi');
      if (order.status !== OrderStatus.Delivering) {
        throw new BadRequestException(
          'Faqat yetkazib berilayotganda qaytarish mumkin',
        );
      }
      const items = await manager.find(OrderItem, { where: { orderId } });

      // Resolve + validate every return line first, then lock variants in a
      // FIXED (id-ascending) order — not the caller-submitted order — so
      // this can't deadlock against another transaction locking the same
      // variants in a different sequence (same reasoning as create()/restockOrder).
      const resolved = returns.map((r) => {
        const item = items.find((i) => i.id === r.orderItemId);
        if (!item) throw new NotFoundException('Buyurtma elementi topilmadi');
        return { r, item };
      });
      resolved.sort((a, b) =>
        a.item.productVariantId.localeCompare(b.item.productVariantId),
      );

      let totalReturnAmount = 0;
      for (const { r, item } of resolved) {
        const remaining = item.quantity - item.returnedQuantity;
        if (r.quantity > remaining) {
          throw new BadRequestException(
            `"${item.productName}" da faqat ${remaining} ta qaytarish mumkin`,
          );
        }
        // Cost per still-sold unit (cost of goods over the units not yet returned).
        const unitCost = unitCostOf(item.costOfGoods, remaining);
        item.returnedQuantity += r.quantity;
        // Returned units are no longer sold — drop their cost from the line.
        item.costOfGoods = Math.max(
          0,
          item.costOfGoods - unitCost * r.quantity,
        );
        await manager.save(item);

        // Locked so this can't lost-update against another concurrent stock
        // change on the same variant (same reasoning as restockOrder).
        const variant = await manager.findOne(ProductVariant, {
          where: { id: item.productVariantId },
          lock: { mode: 'pessimistic_write' },
        });
        if (variant) {
          await restockReturn(manager, {
            variant,
            quantity: r.quantity,
            unitCost,
            orderId,
            userId,
            reason: reason ?? 'Customer qaytardi',
          });
        }
        totalReturnAmount += item.unitPrice * r.quantity;
      }

      order.total = Math.max(0, order.total - totalReturnAmount);
      order.subTotal = Math.max(0, order.subTotal - totalReturnAmount);
      const event: OrderTimelineEvent = {
        status: order.status,
        at: new Date().toISOString(),
        byUserId: userId,
        note: `Qaytarish: ${reason ?? ''}`.trim(),
      };
      order.timeline = [...order.timeline, event];
      await manager.save(order);
    });

    const result = await this.orders.findOneOrFail({
      where: { id: orderId },
      relations: { items: true, shop: true },
    });
    this.emitOrderEvent('order:updated', result);
    // To'lab bo'lingan (onlayn) buyurtmada sotuv cheki allaqachon chiqqan —
    // qaytarilgan qatorlar uchun qisman refund chek kerak. Naqdda sotuv cheki
    // hali yo'q (u Delivered'da, kamaytirilgan miqdorlar bilan chiqadi) —
    // createRefundReceipt sotuv cheki bo'lmasa o'zi hech narsa qilmaydi.
    void this.fiscal.createRefundReceipt(orderId, returns);
    // Remind the customer to (optionally) add a return reason.
    if (result.userId)
      void this.push.sendToUser(result.userId, {
        title: `Buyurtma #${result.orderNumber}`,
        body: "Ba'zi mahsulotlar qaytarildi. Xohlasangiz sabab qoldiring.",
        data: { orderId: result.id, kind: 'order:returned' },
      });
    return result;
  }

  /**
   * Customer adds (or edits) an optional free-text reason for the returned
   * items in their order. Not required — just captured if offered.
   */
  /**
   * Seller tomoni: markirovkali (Asl belgisi) tovarlarning Data Matrix
   * kodlarini saqlash — yig'uvchi/kuryer mobil ilovada skanerlaydi.
   * Kodlar fiskal chek qatoriga kiradi; agar order bo'yicha incomplete chek
   * bo'lsa (masalan onlayn to'lov chekida marking yetishmagan) avtomatik
   * qayta quriladi.
   */
  async setMarkingCodes(
    userId: string,
    orderId: string,
    items: { orderItemId: string; codes: string[] }[],
  ): Promise<Order> {
    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: { shop: true },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    await this.assertShopCanManage(userId, order, 'orders.update_status');
    if (isTerminalOrderStatus(order.status)) {
      throw new BadRequestException(
        "Yakunlangan buyurtmaga kod kiritib bo'lmaydi",
      );
    }

    const orderItems = await this.items.find({ where: { orderId } });
    for (const { orderItemId, codes } of items) {
      const item = orderItems.find((i) => i.id === orderItemId);
      if (!item) throw new NotFoundException('Buyurtma elementi topilmadi');
      // Takror skanerlangan kodlar tushiriladi; donadan ortiq kod saqlanmaydi.
      item.markingCodes = [
        ...new Set(codes.map((c) => c.trim()).filter(Boolean)),
      ].slice(0, item.quantity);
      await this.items.save(item);
    }
    void this.fiscal.rebuildIncompleteSaleForOrder(orderId);
    return this.orders.findOneOrFail({
      where: { id: orderId },
      relations: { items: true },
    });
  }

  async setReturnReason(
    userId: string,
    orderId: string,
    reason: string,
  ): Promise<Order> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.userId !== userId) throw new ForbiddenException();
    order.returnReason = reason.trim() || null;
    return this.orders.save(order);
  }

  /** Customer rates products from a delivered order (delegated to OrderReviewsService). */
  async createReviews(
    userId: string,
    orderId: string,
    items: { productVariantId: string; stars: number; text?: string }[],
  ): Promise<{ reviewedVariantIds: string[] }> {
    return this.getReviewsService().createReviews(userId, orderId, items);
  }

  /** Customer rates the courier who confirmed delivery (delegated to OrderReviewsService). */
  async rateCourier(
    userId: string,
    orderId: string,
    stars: number,
    text?: string,
  ): Promise<void> {
    return this.getReviewsService().rateCourier(userId, orderId, stars, text);
  }

  /** Customer rates the shop/delivery experience (delegated to OrderReviewsService). */
  async rateShop(
    userId: string,
    orderId: string,
    stars: number,
    text?: string,
  ): Promise<void> {
    return this.getReviewsService().rateShop(userId, orderId, stars, text);
  }

  /** In-order chat message listing (delegated to OrderChatService). */
  async listMessages(userId: string, orderId: string): Promise<ChatMessage[]> {
    return this.getChatService().listMessages(userId, orderId);
  }

  /** Send in-order chat message (delegated to OrderChatService). */
  async sendMessage(
    userId: string,
    orderId: string,
    text: string,
  ): Promise<ChatMessage> {
    return this.getChatService().sendMessage(userId, orderId, text);
  }

  /** Reminds customers to rate delivered orders (delegated to OrderReviewsService). */
  async sendReviewReminders(): Promise<void> {
    return this.getReviewsService().sendReviewReminders();
  }

  // ─── Yetkazib berish marshruti (SPEC.md §27) ──────────────────────────────

  /**
   * Nearest-neighbor greedy delivery route for a shop's currently-delivering
   * orders: starting at the shop, repeatedly hop to the nearest unvisited
   * stop. Gated by 'orders.view_assigned' (owner always passes; the
   * yetkazib_beruvchi/courier preset already includes this permission) so a
   * courier can view the route for orders they're delivering. Reuses the
   * existing haversineKm util — no separate distance calc.
   */
  async getDeliveryRoute(
    actorUserId: string,
    shopId: string,
  ): Promise<{
    shopLocation: { lat: number; lng: number };
    stops: Array<{
      orderId: string;
      orderNumber: string;
      sequence: number;
      address: string;
      lat: number;
      lng: number;
      customerPhone: string | null;
      total: number;
      distanceFromPreviousKm: number;
    }>;
  }> {
    const shop = await assertShopPermission(
      this.shops,
      this.staff,
      actorUserId,
      shopId,
      'orders.view_assigned',
    );

    const deliveringOrders = await this.orders.find({
      where: { shopId, status: OrderStatus.Delivering },
      relations: { user: true },
    });

    const unvisited = deliveringOrders
      .filter((o) => o.deliveryAddress)
      .map((o) => ({
        orderId: o.id,
        orderNumber: o.orderNumber,
        address: o.deliveryAddress!.address,
        lat: o.deliveryAddress!.latitude,
        lng: o.deliveryAddress!.longitude,
        customerPhone: o.user?.phone ?? null,
        total: o.total,
      }));

    let currentLat = shop.latitude;
    let currentLng = shop.longitude;
    const stops: Array<
      (typeof unvisited)[number] & {
        sequence: number;
        distanceFromPreviousKm: number;
      }
    > = [];

    while (unvisited.length > 0) {
      let nearestIdx = 0;
      let nearestKm = Infinity;
      for (let i = 0; i < unvisited.length; i++) {
        const d = haversineKm(
          currentLat,
          currentLng,
          unvisited[i].lat,
          unvisited[i].lng,
        );
        if (d < nearestKm) {
          nearestKm = d;
          nearestIdx = i;
        }
      }
      const [next] = unvisited.splice(nearestIdx, 1);
      stops.push({
        ...next,
        sequence: stops.length + 1,
        distanceFromPreviousKm: Math.round(nearestKm * 100) / 100,
      });
      currentLat = next.lat;
      currentLng = next.lng;
    }

    return {
      shopLocation: { lat: shop.latitude, lng: shop.longitude },
      stops,
    };
  }

  // ─── Admin: platforma bo'ylab buyurtmalarni ko'rish (delegated to OrderAdminService) ──────

  async adminListOrders(opts: {
    search?: string;
    status?: OrderStatus;
    channel?: OrderChannel;
    paymentMethod?: PaymentMethod;
    paymentStatus?: PaymentStatus;
    shopId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: Order[]; total: number }> {
    return this.getAdminService().adminListOrders(opts);
  }

  async adminExportOrders(opts: {
    search?: string;
    status?: OrderStatus;
    channel?: OrderChannel;
    paymentMethod?: PaymentMethod;
    paymentStatus?: PaymentStatus;
    shopId?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<Buffer> {
    return this.getAdminService().adminExportOrders(opts);
  }

  async adminListReviews(opts: {
    target?: ReviewTarget;
    maxStars?: number;
    limit?: number;
    offset?: number;
  }) {
    return this.getReviewsService().adminListReviews(opts);
  }

  async adminGetOrder(id: string): Promise<Order> {
    return this.getAdminService().adminGetOrder(id);
  }

  async adminSetCommissionExempt(
    id: string,
    exempt: boolean,
    adminUserId: string,
  ): Promise<Order> {
    return this.getAdminService().adminSetCommissionExempt(
      id,
      exempt,
      adminUserId,
    );
  }

  /**
   * Xaridor yoki do'kon egasi uchun buyurtma fiskal chekini olish.
   */
  async getFiscalReceipt(
    userId: string,
    userRoles: Role[] | string[] | undefined,
    orderId: string,
  ) {
    return this.fiscal.getReceiptForOrder(orderId, userId, userRoles);
  }
}
