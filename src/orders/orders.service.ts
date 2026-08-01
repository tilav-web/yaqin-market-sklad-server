import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { customAlphabet } from 'nanoid';
import { Between, DataSource, In, IsNull, LessThan, Not, Repository } from 'typeorm';

import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/entities/admin-audit-log.entity';
import { ClickService } from '../click/click.service';
import { ComplaintsService } from '../complaints/complaints.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { buildXlsxBuffer } from '../common/xlsx.util';
import { calcDeliveryFee, estimateEtaMinutes, haversineKm, pointInPolygon } from '../geo/geo.util';
import { SellerTransaction, SellerTxType } from '../payments/entities/seller-transaction.entity';
import { PaymentsService } from '../payments/payments.service';
import { GlobalProduct } from '../products/entities/global-product.entity';
import { MovementType } from '../products/entities/inventory-movement.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { consumeFifo, restockReturn, unitCostOf } from '../products/inventory.util';
import { PrimeService } from '../prime/prime.service';
import { PromotionsService } from '../promotions/promotions.service';
import { PushService } from '../push/push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RedisService } from '../redis/redis.service';
import { SETTING_KEYS } from '../settings/entities/global-setting.entity';
import { SettingsService } from '../settings/settings.service';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff, StaffPermission } from '../shops/entities/shop-staff.entity';
import { assertShopPermission } from '../shops/shop-access.util';
import { isShopOpenNow } from '../shops/shop-hours.util';
import { UserAddress } from '../users/entities/user-address.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order, OrderChannel, OrderStatus, OrderTimelineEvent, PaymentMethod, PaymentStatus, isTerminalOrderStatus } from './entities/order.entity';
import { Review } from './entities/review.entity';

const orderNumberGen = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

// A new order the shop doesn't accept within this window is auto-cancelled.
const AUTO_CANCEL_MS = 5 * 60 * 1000;

// A PAID order the shop keeps ignoring past this (counted from the last
// customer re-request, if any) is force-closed and auto-refunded — a paying
// customer who walked away from the app must never stay in limbo.
const PAID_AUTO_CANCEL_MS = 30 * 60 * 1000;

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
  ) {}

  private static readonly STATUS_LABEL: Record<OrderStatus, string> = {
    [OrderStatus.New]: 'Yangi',
    [OrderStatus.Accepted]: 'Qabul qilindi',
    [OrderStatus.Preparing]: 'Yig\'ilmoqda',
    [OrderStatus.Delivering]: 'Yetkazib berilmoqda',
    [OrderStatus.Delivered]: 'Yetkazildi',
    [OrderStatus.Cancelled]: 'Bekor qilindi',
    [OrderStatus.SellerNoResponse]: "Do'kon javob bermadi",
    [OrderStatus.SellerRejected]: "Do'kon rad etdi",
  };

  /** Build a variantId → productName map from a list of variants (single IN query). */
  private async variantNameMap(variants: ProductVariant[]): Promise<Map<string, string>> {
    if (!variants.length) return new Map();
    const gpIds = [...new Set(variants.map((v) => v.globalProductId))];
    const gps = await this.globalProducts.findBy({ id: In(gpIds) });
    const gpMap = new Map(gps.map((gp) => [gp.id, gp.name]));
    return new Map(variants.map((v) => [v.id, gpMap.get(v.globalProductId) ?? '']));
  }

  /** Build a variantId → GlobalProduct.categoryId map (for category-scoped promotions). */
  private async variantCategoryMap(variants: ProductVariant[]): Promise<Map<string, string | null>> {
    if (!variants.length) return new Map();
    const gpIds = [...new Set(variants.map((v) => v.globalProductId))];
    const gps = await this.globalProducts.findBy({ id: In(gpIds) });
    const gpMap = new Map(gps.map((gp) => [gp.id, gp.categoryId]));
    return new Map(variants.map((v) => [v.id, gpMap.get(v.globalProductId) ?? null]));
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
    throw new ForbiddenException('Bu amal uchun ruxsat yo\'q');
  }

  /**
   * A staff member (not the owner) may only view an order if they hold
   * `orders.view_all`, or `orders.view_assigned` AND this order is assigned
   * to them specifically (e.g. the courier delivering it) — merely being an
   * active staff member of the shop (e.g. a warehouse-only "sklad" hire) is
   * not enough, even though they can act on it in other ways.
   */
  private staffCanViewOrder(staff: Pick<ShopStaff, 'id' | 'permissions'>, order: Pick<Order, 'assignedStaffId'>): boolean {
    if (staff.permissions.includes('orders.view_all')) return true;
    return staff.permissions.includes('orders.view_assigned') && order.assignedStaffId === staff.id;
  }

  /**
   * Authorize read access to an order for realtime/tracking endpoints: the
   * customer who placed it, the shop owner, or a staff member with the
   * matching view permission may view it. Mirrors the isParty check in {@link getOne}.
   */
  async assertOrderParty(userId: string, orderId: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id: orderId }, relations: { shop: true } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const isParty = order.userId === userId || order.shop.ownerId === userId;
    if (!isParty) {
      const staff = await this.staff.findOne({
        where: { shopId: order.shopId, userId, isActive: true },
      });
      if (!staff || !this.staffCanViewOrder(staff, order)) throw new ForbiddenException();
    }
    return order;
  }

  /** True if `userId` is the assigned staff (courier) currently handling this order. */
  async isAssignedCourier(userId: string, orderId: string): Promise<boolean> {
    const order = await this.orders.findOne({ where: { id: orderId }, select: { id: true, assignedStaffId: true } });
    if (!order?.assignedStaffId) return false;
    const staff = await this.staff.findOne({
      where: { id: order.assignedStaffId, userId, isActive: true },
    });
    return !!staff;
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
  ): Promise<{ orderId: string; lat: number; lng: number; etaMinutes: number | null; updatedAt: string }> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.status !== OrderStatus.Delivering) {
      throw new BadRequestException('Buyurtma hozir yetkazilmoqda holatida emas');
    }
    if (!(await this.isAssignedCourier(userId, orderId))) throw new ForbiddenException();

    const etaMinutes = order.deliveryAddress
      ? estimateEtaMinutes(haversineKm(lat, lng, order.deliveryAddress.latitude, order.deliveryAddress.longitude))
      : null;

    const payload = { orderId, lat, lng, etaMinutes, updatedAt: new Date().toISOString() };
    await this.redis.client.set(`courier:location:${orderId}`, JSON.stringify(payload), 'EX', 60);
    this.realtime.emitToOrder(orderId, 'courier:location', payload);
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
      courierLocation: { lat: number; lng: number; etaMinutes: number | null; updatedAt: string } | null;
    }>
  > {
    const activeStatuses = [OrderStatus.New, OrderStatus.Accepted, OrderStatus.Preparing, OrderStatus.Delivering];
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
            ? (JSON.parse(raw) as { lat: number; lng: number; etaMinutes: number | null; updatedAt: string })
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
    },
  ): Promise<Order> {
    const shop = await this.shops.findOne({ where: { id: dto.shopId, isActive: true } });
    if (!shop) throw new NotFoundException('Do\'kon topilmadi');
    if (!isShopOpenNow(shop)) {
      throw new BadRequestException('Do\'kon hozir yopiq — buyurtma qabul qilmaydi');
    }
    if (shop.blockedUserIds.includes(userId)) {
      throw new ForbiddenException('Bu do\'kon sizdan buyurtma qabul qila olmaydi');
    }

    const address = await this.addresses.findOne({ where: { id: dto.deliveryAddressId, userId } });
    if (!address) throw new NotFoundException('Manzil topilmadi');

    const distanceKm = haversineKm(address.latitude, address.longitude, shop.latitude, shop.longitude);
    // A configured delivery polygon is authoritative over the circle radius
    // (mirrors products.service.ts's feedNearby reachability check) — a shop
    // with an irregular delivery area shouldn't be limited to a circle.
    const isReachable = shop.deliveryPolygon
      ? pointInPolygon(address.latitude, address.longitude, shop.deliveryPolygon)
      : distanceKm <= shop.deliveryZone.maxKm;
    if (!isReachable) {
      throw new BadRequestException("Manzil do'konning yetkazib berish zonasidan tashqarida");
    }

    const variantIds = dto.items.map((i) => i.productVariantId);
    const variants = await this.variants.find({ where: { id: In(variantIds), shopId: shop.id, isActive: true } });
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
        throw new BadRequestException(`"${nameMap.get(v.id) ?? ''}" mahsulotidan ${v.stock} ta qoldi, ${it.quantity} ta so'ralgan`);
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
      throw new BadRequestException(`Minimal buyurtma narxi: ${shop.minOrderPrice} so'm`);
    }

    // Platforma-darajali minimal buyurtma (unit economics himoyasi): juda
    // kichik buyurtmada Click ekvayring + SMS + payout xarajatlari
    // komissiyadan oshib ketadi — har bir shunday buyurtma platformaga zarar.
    // Do'kon o'z minimumini bundan yuqori qo'yishi mumkin (yuqoridagi check).
    const platformMin = this.settings.getNumber(SETTING_KEYS.MIN_ORDER_TOTAL, 0);
    if (platformMin > 0 && subTotal < platformMin) {
      throw new BadRequestException(`Minimal buyurtma summasi: ${platformMin} so'm`);
    }

    // Free-delivery polygon is authoritative over the circle-based freeKm too
    // (mirrors products.service.ts's feedNearby fee calc) — a customer inside
    // the configured free-delivery polygon must not be charged a fee.
    const isFreeByPolygon =
      shop.freeDeliveryPolygon != null &&
      pointInPolygon(address.latitude, address.longitude, shop.freeDeliveryPolygon);
    let deliveryFee = isFreeByPolygon
      ? 0
      : calcDeliveryFee({
          distanceKm,
          freeKm: shop.deliveryZone.freeKm,
          pricingType: shop.deliveryZone.pricingType,
          pricePerStep: shop.deliveryZone.pricePerStep,
        });
    // Shop-level free_delivery promotion against the cart subtotal.
    const freeDelivery = await this.promotions.findFreeDeliveryPromotion(shop.id, subTotal);
    if (freeDelivery.free) deliveryFee = 0;

    // Snapshot the commission rate NOW (seller's active Prime rate, or the
    // current global default) — settlement must use this, not whatever rate
    // happens to be active on delivery day (SPEC §10.1: not retroactive).
    const defaultCommissionRate = this.settings.getNumber(SETTING_KEYS.COMMISSION_RATE_DEFAULT);
    const commissionRateSnapshot = await this.prime.getCommissionRate(shop.ownerId, defaultCommissionRate);

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
        orderNumber: orderNumberGen(),
        subTotal,
        deliveryFee,
        total: subTotal + deliveryFee,
        distanceKm,
        status: OrderStatus.New,
        paymentMethod: dto.paymentMethod ?? PaymentMethod.Cash,
        paymentStatus: (dto.paymentMethod ?? PaymentMethod.Cash) === PaymentMethod.ClickOnline
          ? PaymentStatus.Pending
          : PaymentStatus.NotRequired,
        commissionRateSnapshot,
        recipientPhone: dto.recipientPhone ?? null,
        courierComment: dto.courierComment ?? null,
        timeline: [{ status: OrderStatus.New, at: new Date().toISOString(), byUserId: userId }],
      });
      const savedOrder = await manager.save(order);

      // Lock variants in a fixed (id-ascending) order, not cart order — two
      // orders sharing the same products but submitted with items in a
      // different sequence could otherwise each hold one lock while waiting
      // on the other's, deadlocking. A consistent global lock order rules
      // that out regardless of how any given cart was assembled.
      const sortedLineItems = [...lineItems].sort((a, b) => a.variant.id.localeCompare(b.variant.id));
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
          throw new BadRequestException(`"${nameMap.get(locked.id) ?? ''}" mahsulotidan ${locked.stock} ta qoldi`);
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
        if (beforeStock > locked.lowStockThreshold && locked.stock <= locked.lowStockThreshold) {
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

      return manager.findOne(Order, { where: { id: savedOrder.id }, relations: { items: true } }) as Promise<Order>;
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
    const staff = await this.staff.find({ where: { shopId: shop.id, isActive: true } });
    const recipients = [...new Set([shop.ownerId, ...staff.map((s) => s.userId)])];
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
    if (!shop) throw new NotFoundException('Do\'kon topilmadi');
    if (shop.ownerId !== userId) {
      const staff = await this.staff.findOne({ where: { shopId, userId, isActive: true } });
      if (!staff?.permissions.includes('sales.instore')) {
        throw new ForbiddenException('Do\'konda sotish uchun ruxsat yo\'q');
      }
    }
    if (!items.length) throw new BadRequestException('Hech qanday mahsulot tanlanmadi');

    const variants = await this.variants.find({
      where: { id: In(items.map((i) => i.productVariantId)), shopId, isActive: true },
    });
    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const nameMap = await this.variantNameMap(variants);
    let subTotal = 0;
    const lineItems: { variant: ProductVariant; quantity: number; unitPrice: number; lineTotal: number }[] = [];
    for (const it of items) {
      const v = variantMap.get(it.productVariantId);
      if (!v) throw new BadRequestException('Mahsulot topilmadi');
      if (v.stock < it.quantity) {
        throw new BadRequestException(`"${nameMap.get(v.id) ?? ''}" qoldig'i yetarli emas (${v.stock} ta)`);
      }
      const unitPrice = v.discountPrice ?? v.price;
      const lineTotal = unitPrice * it.quantity;
      subTotal += lineTotal;
      lineItems.push({ variant: v, quantity: it.quantity, unitPrice, lineTotal });
    }

    const now = new Date().toISOString();
    return this.dataSource.transaction(async (manager) => {
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
          { status: OrderStatus.Delivered, at: now, byUserId: userId, note: 'Do\'konda sotildi' },
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
          reason: 'Do\'konda sotildi',
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
        relations: { items: { productVariant: { globalProduct: { taxCategory: true } } } },
      });
    }).then((order) => {
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
    const staff = await this.staff.find({ where: { shopId: shop.id, isActive: true } });
    const recipients = [...new Set([shop.ownerId, ...staff.map((s) => s.userId)])];
    await this.push.sendToUsers(recipients, {
      title: 'Yangi buyurtma',
      body: `#${order.orderNumber} — ${order.total.toLocaleString()} so'm`,
      data: { orderId: order.id, kind: 'order:new', shopId: shop.id, forSeller: true },
      imageUrl: shop.photos?.[0],
    });
  }

  listForUser(userId: string): Promise<Order[]> {
    return this.orders.find({
      where: { userId },
      relations: { items: true, shop: true },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async listForShop(actorUserId: string, shopId: string, status?: OrderStatus): Promise<Order[]> {
    // Owner or any staff who can view orders (full or assigned).
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Do\'kon topilmadi');
    let effectiveStatus = status;
    let assignedToStaffId: string | null = null;
    if (shop.ownerId !== actorUserId) {
      const member = await this.staff.findOne({ where: { shopId, userId: actorUserId, isActive: true } });
      const canViewAll = member?.permissions?.includes('orders.view_all');
      const canViewAssigned = member?.permissions?.includes('orders.view_assigned');
      if (!canViewAll && !canViewAssigned) {
        throw new ForbiddenException('Buyurtmalarni ko\'rishga ruxsat yo\'q');
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
    if (effectiveStatus) qb.andWhere('o.status = :status', { status: effectiveStatus });
    if (assignedToStaffId) qb.andWhere('o.assignedStaffId = :asid', { asid: assignedToStaffId });
    return qb.orderBy('o.createdAt', 'DESC').take(200).getMany();
  }

  /** Assign (or unassign) an order to a staff member — e.g. a delivery courier. */
  async assignOrder(
    actorUserId: string,
    shopId: string,
    orderId: string,
    staffId: string | null,
  ): Promise<Order> {
    const order = await this.orders.findOne({ where: { id: orderId, shopId }, relations: { shop: true } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    await this.assertShopCanManage(actorUserId, order, 'orders.update_status');
    if (staffId) {
      const member = await this.staff.findOne({ where: { id: staffId, shopId, isActive: true } });
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
    return this.orders.save(order);
  }

  async getOne(
    userId: string,
    orderId: string,
  ): Promise<
    Order & {
      reviewedVariantIds: string[];
      complaint: { status: string; reason: string; createdAt: Date; resolvedAt: Date | null } | null;
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
      if (!staff || !this.staffCanViewOrder(staff, order)) throw new ForbiddenException();
    }
    const myReviews = order.userId
      ? await this.reviews.find({
          where: { orderId, userId: order.userId },
          select: { productVariantId: true },
        })
      : [];

    // Surface dispute + refund state so the customer (and shop side) can see
    // whether an order is under complaint or has already been refunded —
    // both already tracked in the DB but never returned before now.
    const complaint = await this.complaints.getForOrder(orderId);
    const refundTx = await this.sellerTransactions.findOne({
      where: { orderId, type: SellerTxType.RefundDebit },
    });

    return {
      ...order,
      reviewedVariantIds: myReviews.map((r) => r.productVariantId),
      complaint: complaint
        ? {
            status: complaint.status,
            reason: complaint.reason,
            createdAt: complaint.createdAt,
            resolvedAt: complaint.resolvedAt,
          }
        : null,
      refund: refundTx ? { amount: parseFloat(refundTx.amount), at: refundTx.createdAt } : null,
    };
  }

  async updateStatus(
    actorUserId: string,
    orderId: string,
    nextStatus: OrderStatus,
    note?: string,
  ): Promise<Order> {
    const order = await this.orders.findOne({ where: { id: orderId }, relations: { shop: true } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');

    const isOwner = order.shop.ownerId === actorUserId;
    const isCustomer = order.userId === actorUserId;

    const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.New]: [OrderStatus.Accepted, OrderStatus.Cancelled, OrderStatus.SellerRejected],
      [OrderStatus.Accepted]: [OrderStatus.Preparing, OrderStatus.Cancelled],
      [OrderStatus.Preparing]: [OrderStatus.Delivering, OrderStatus.Cancelled],
      [OrderStatus.Delivering]: [OrderStatus.Delivered, OrderStatus.Cancelled],
      [OrderStatus.Delivered]: [],
      [OrderStatus.Cancelled]: [],
      [OrderStatus.SellerNoResponse]: [],
      [OrderStatus.SellerRejected]: [],
    };

    if (!allowedTransitions[order.status].includes(nextStatus)) {
      throw new BadRequestException(`Status ${order.status} -> ${nextStatus} mumkin emas`);
    }

    // Shop-side transitions are allowed for the owner OR active staff holding
    // the matching permission (kassir accepts, courier delivers, etc.).
    if (nextStatus === OrderStatus.Accepted) {
      await this.assertShopCanManage(actorUserId, order, 'orders.accept');
    } else if ([OrderStatus.Preparing, OrderStatus.Delivering].includes(nextStatus)) {
      await this.assertShopCanManage(actorUserId, order, 'orders.update_status');
    } else if (nextStatus === OrderStatus.Delivered) {
      // The customer confirms receipt; the shop side (owner/courier) may also.
      if (!isCustomer) await this.assertShopCanManage(actorUserId, order, 'orders.update_status');
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
          throw new BadRequestException('Yetkazib berish boshlangandan keyin buyurtmani bekor qilib bo\'lmaydi');
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
            'Buyurtma allaqachon to\'langan va do\'kon qabul qilgan — bekor qilish uchun qo\'llab-quvvatlash xizmatiga murojaat qiling',
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
        throw new BadRequestException(`Status ${locked.status} -> ${nextStatus} mumkin emas`);
      }

      locked.status = nextStatus;
      const event: OrderTimelineEvent = {
        status: nextStatus,
        at: new Date().toISOString(),
        byUserId: actorUserId,
        note,
      };
      locked.timeline = [...locked.timeline, event];
      if (nextStatus === OrderStatus.Cancelled || nextStatus === OrderStatus.SellerRejected) {
        locked.cancellationReason =
          note ?? (nextStatus === OrderStatus.SellerRejected ? "Do'kon buyurtmani rad etdi" : null);
        await this.restockOrder(manager, locked.id);
      }
      return manager.save(locked);
    });

    // Hook financial settlement when order is delivered
    if (nextStatus === OrderStatus.Delivered) {
      void this.settleDeliveredOrder(order).catch((err) =>
        this.logger.error(`Payment settlement failed for order ${order.id}: ${err.message}`),
      );
      // Fiskal chek: naqd buyurtmada pul shu paytda olinadi. Onlaynda chek
      // to'lov webhookida chiqqan — createSaleReceipt idempotent, shuning
      // uchun bu chaqiruv webhook paytida yiqilgan chekni ham qoplaydi.
      void this.fiscal.createSaleReceipt(order.id);
    }

    // A captured Click payment must follow its order out the door: any
    // cancel/reject of a paid order triggers an automatic reversal. Fire and
    // forget — the cancel response shouldn't wait on Click, and
    // retryPendingRefunds() re-runs any attempt that fails here.
    if (
      (nextStatus === OrderStatus.Cancelled || nextStatus === OrderStatus.SellerRejected) &&
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
        .catch((err) => this.logger.error(`Refund failed for order ${order.id}: ${err.message}`));
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
    const kind = nextStatus === OrderStatus.SellerRejected ? 'order:seller_rejected' : 'order:updated';
    if (target) void this.push.sendToUser(target, {
      title: `Buyurtma #${saved.orderNumber}`,
      body: OrdersService.STATUS_LABEL[saved.status],
      data: {
        orderId: saved.id,
        kind,
        ...(!isCustomer ? { shopId: order.shopId, forSeller: false } : {}),
      },
      imageUrl: shopPhoto,
    });
    return saved;
  }

  /**
   * Customer: switch how a not-yet-paid order gets paid — cash <-> card.
   * Locked once Click confirms payment (there's no automated way to undo a
   * captured charge, same reasoning as the paid-order-immune auto-cancel in
   * autoCancelStaleNewOrders) or once the order is otherwise dead.
   */
  async changePaymentMethod(userId: string, orderId: string, method: PaymentMethod): Promise<Order> {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(Order, {
        where: { id: orderId, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException('Buyurtma topilmadi');
      if (PAYMENT_METHOD_LOCKED_STATUSES.includes(order.status)) {
        throw new BadRequestException("Bu buyurtma uchun to'lov turini o'zgartirib bo'lmaydi");
      }
      if (order.paymentStatus === PaymentStatus.Paid) {
        throw new BadRequestException("Buyurtma allaqachon to'langan — to'lov turini o'zgartirib bo'lmaydi");
      }
      if (order.paymentMethod === method) return order;

      order.paymentMethod = method;
      order.paymentStatus = method === PaymentMethod.Cash ? PaymentStatus.NotRequired : PaymentStatus.Pending;
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
    const order = await this.orders.findOne({ where: { id: orderId, userId }, relations: { shop: true } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.status !== OrderStatus.New) {
      throw new BadRequestException('Buyurtma allaqachon ko\'rib chiqilgan');
    }
    if (order.paymentMethod !== PaymentMethod.ClickOnline || order.paymentStatus !== PaymentStatus.Paid) {
      throw new BadRequestException('Qayta so\'rov faqat to\'langan buyurtmalar uchun');
    }
    const anchor = order.reRequestedAt ?? order.createdAt;
    if (Date.now() - anchor.getTime() < AUTO_CANCEL_MS) {
      throw new BadRequestException('Do\'konga hali javob berish uchun vaqt berilgan — biroz kuting');
    }

    order.reRequestedAt = new Date();
    order.paidUnacceptedAlertSentAt = null;
    order.timeline = [
      ...order.timeline,
      { status: OrderStatus.New, at: new Date().toISOString(), byUserId: userId, note: 'customer-re-request' },
    ];
    const saved = await this.orders.save(order);

    const staff = await this.staff.find({ where: { shopId: order.shopId, isActive: true } });
    const recipients = [...new Set([order.shop.ownerId, ...staff.map((s) => s.userId)])];
    void this.push.sendToUsers(recipients, {
      title: '⚠️ Mijoz javob kutmoqda',
      body: `#${order.orderNumber} — to'langan buyurtma uchun mijoz qayta so'rov yubordi. Zudlik bilan qabul qiling!`,
      data: { orderId: order.id, kind: 'order:paid_unaccepted', shopId: order.shopId, forSeller: true },
    });
    this.emitOrderEvent('order:updated', saved);
    return saved;
  }

  private async settleDeliveredOrder(
    order: Pick<Order, 'id' | 'shop' | 'total' | 'paymentMethod' | 'commissionRateSnapshot' | 'commissionExempt'>,
  ): Promise<void> {
    const sellerId = order.shop.ownerId;
    // Use the rate captured at order-creation time — never recompute from
    // whatever's active now (SPEC §10.1: rate changes aren't retroactive).
    // Falls back to the current rate only for orders placed before this
    // snapshot column existed.
    let commissionRate = order.commissionRateSnapshot;
    if (commissionRate == null) {
      const defaultRate = this.settings.getNumber(SETTING_KEYS.COMMISSION_RATE_DEFAULT);
      commissionRate = await this.prime.getCommissionRate(sellerId, defaultRate);
    }
    // Admin `exempt` flag overrides everything else — 0% regardless of
    // whatever rate was snapshotted (SPEC §10.3).
    if (order.commissionExempt) commissionRate = 0;

    if (order.paymentMethod === PaymentMethod.Cash) {
      await this.payments.recordCashOrderDelivery({ sellerId, orderId: order.id, orderTotal: order.total, commissionRate });
    } else {
      await this.payments.recordOnlineOrderDelivery({ sellerId, orderId: order.id, orderTotal: order.total, commissionRate });
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
  @Cron(CronExpression.EVERY_MINUTE)
  async autoCancelStaleNewOrders(): Promise<void> {
    const cutoff = new Date(Date.now() - AUTO_CANCEL_MS);
    const stale = await this.orders.find({
      where: { status: OrderStatus.New, createdAt: LessThan(cutoff), paymentStatus: Not(PaymentStatus.Paid) },
      take: 50,
    });
    await this.alertStalePaidOrders(cutoff);
    await this.autoRefundAbandonedPaidOrders();
    for (const order of stale) {
      // Only emit/notify if the transition actually happened (it may be
      // skipped if the order was accepted between the scan and the lock).
      const transitioned = await this.dataSource.transaction(async (manager) => {
        const fresh = await manager.findOne(Order, {
          where: { id: order.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!fresh || fresh.status !== OrderStatus.New) return false;
        await this.restockOrder(manager, fresh.id);
        fresh.status = OrderStatus.SellerNoResponse;
        fresh.cancellationReason = 'Do\'kon 5 daqiqada javob bermadi';
        fresh.timeline = [
          ...fresh.timeline,
          { status: OrderStatus.SellerNoResponse, at: new Date().toISOString(), byUserId: null, note: 'auto-reject-timeout' },
        ];
        await manager.save(fresh);
        return true;
      });
      if (!transitioned) continue;
      order.status = OrderStatus.SellerNoResponse;
      this.emitOrderEvent('order:updated', order);
      if (order.userId) {
        void this.push.sendToUser(order.userId, {
          title: `Buyurtma #${order.orderNumber}`,
          body: 'Do\'kon 5 daqiqada javob bermadi — boshqa do\'konlardan taklif bor',
          data: { orderId: order.id, kind: 'order:seller_no_response' },
        });
      }
    }
    if (stale.length > 0) this.logger.log(`${stale.length} stale order(s) moved to SellerNoResponse`);
  }

  /**
   * One-time (per 5-min window — a re-request re-arms it) alert pair for a
   * paid order stuck unaccepted: urgent nudge to the shop + an options push
   * to the customer (wait / re-request / cancel-with-refund). Anchored on
   * COALESCE(reRequestedAt, createdAt) so each re-request restarts the clock.
   */
  private async alertStalePaidOrders(cutoff: Date): Promise<void> {
    const stalePaid = await this.orders
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.shop', 'shop')
      .where('o.status = :status', { status: OrderStatus.New })
      .andWhere('o.paymentStatus = :ps', { ps: PaymentStatus.Paid })
      .andWhere('o.paidUnacceptedAlertSentAt IS NULL')
      .andWhere('COALESCE(o.reRequestedAt, o.createdAt) < :cutoff', { cutoff })
      .take(50)
      .getMany();
    if (stalePaid.length === 0) return;

    for (const order of stalePaid) {
      const staff = await this.staff.find({ where: { shopId: order.shopId, isActive: true } });
      const recipients = [...new Set([order.shop.ownerId, ...staff.map((s) => s.userId)])];
      void this.push.sendToUsers(recipients, {
        title: '⚠️ To\'langan buyurtma kutmoqda',
        body: `#${order.orderNumber} — mijoz to'lagan, lekin hali qabul qilinmagan. Zudlik bilan javob bering!`,
        data: { orderId: order.id, kind: 'order:paid_unaccepted', shopId: order.shopId, forSeller: true },
      });
      if (order.userId) {
        void this.push.sendToUser(order.userId, {
          title: `Buyurtma #${order.orderNumber}`,
          body: 'Do\'kon hali javob bermadi. Kutishingiz, qayta so\'rov yuborishingiz yoki bekor qilib pulni qaytarib olishingiz mumkin',
          data: { orderId: order.id, kind: 'order:paid_unaccepted_customer' },
        });
      }
    }
    await this.orders.update(
      { id: In(stalePaid.map((o) => o.id)) },
      { paidUnacceptedAlertSentAt: new Date() },
    );
    this.logger.warn(`${stalePaid.length} paid order(s) stuck unaccepted past the 5-min window — shop and customer notified`);
  }

  /**
   * Safety net behind the customer's own cancel/re-request buttons: a paid
   * order the shop has ignored for PAID_AUTO_CANCEL_MS (since the last
   * re-request) is closed as SellerNoResponse, restocked and auto-refunded.
   */
  private async autoRefundAbandonedPaidOrders(): Promise<void> {
    const cutoff = new Date(Date.now() - PAID_AUTO_CANCEL_MS);
    const abandoned = await this.orders
      .createQueryBuilder('o')
      .where('o.status = :status', { status: OrderStatus.New })
      .andWhere('o.paymentStatus = :ps', { ps: PaymentStatus.Paid })
      .andWhere('COALESCE(o.reRequestedAt, o.createdAt) < :cutoff', { cutoff })
      .take(50)
      .getMany();

    for (const order of abandoned) {
      const transitioned = await this.dataSource.transaction(async (manager) => {
        const fresh = await manager.findOne(Order, {
          where: { id: order.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!fresh || fresh.status !== OrderStatus.New) return false;
        await this.restockOrder(manager, fresh.id);
        fresh.status = OrderStatus.SellerNoResponse;
        fresh.cancellationReason = 'Do\'kon javob bermadi — to\'lov avtomatik qaytarildi';
        fresh.timeline = [
          ...fresh.timeline,
          { status: OrderStatus.SellerNoResponse, at: new Date().toISOString(), byUserId: null, note: 'auto-refund-timeout' },
        ];
        await manager.save(fresh);
        return true;
      });
      if (!transitioned) continue;

      order.status = OrderStatus.SellerNoResponse;
      this.emitOrderEvent('order:updated', order);
      const refunded = await this.click.refundPaidOrder(order.id);
      if (order.userId) {
        void this.push.sendToUser(order.userId, {
          title: `Buyurtma #${order.orderNumber}`,
          body: refunded
            ? 'Do\'kon javob bermadi — pulingiz qaytarildi (kartaga 1-3 ish kunida tushadi)'
            : 'Do\'kon javob bermadi — to\'lovni qaytarish boshlandi, tez orada yakunlanadi',
          data: { orderId: order.id, kind: 'order:seller_no_response' },
        });
      }
      this.logger.warn(
        `Paid order ${order.id} abandoned by shop — auto-closed, refund ${refunded ? 'done' : 'pending (retry cron)'}`,
      );
    }
  }

  /**
   * Backstop for reversals that failed at cancel time (Click hiccup, network,
   * missing payment id later backfilled): any dead paid Click order without
   * refundedAt gets retried until the money is actually back.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryPendingRefunds(): Promise<void> {
    const stuck = await this.orders.find({
      where: {
        status: In([OrderStatus.Cancelled, OrderStatus.SellerNoResponse, OrderStatus.SellerRejected]),
        paymentMethod: PaymentMethod.ClickOnline,
        paymentStatus: PaymentStatus.Paid,
        refundedAt: IsNull(),
      },
      take: 20,
    });
    for (const order of stuck) {
      const refunded = await this.click.refundPaidOrder(order.id);
      if (refunded && order.userId) {
        void this.push.sendToUser(order.userId, {
          title: `Buyurtma #${order.orderNumber}`,
          body: 'To\'lovingiz qaytarildi — pul kartangizga 1-3 ish kunida tushadi',
          data: { orderId: order.id, kind: 'order:refunded' },
        });
      }
    }
  }

  private async restockOrder(manager: import('typeorm').EntityManager, orderId: string) {
    const items = await manager.find(OrderItem, { where: { orderId } });
    if (items.length === 0) return;
    // Fixed (id-ascending) lock order — see the matching comment in create()
    // for why (avoids a deadlock between two orders sharing variants).
    const sortedItems = [...items].sort((a, b) => a.productVariantId.localeCompare(b.productVariantId));
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
    const preCheck = await this.orders.findOne({ where: { id: orderId }, relations: { shop: true } });
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
        throw new BadRequestException('Faqat yetkazib berilayotganda qaytarish mumkin');
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
      resolved.sort((a, b) => a.item.productVariantId.localeCompare(b.item.productVariantId));

      let totalReturnAmount = 0;
      for (const { r, item } of resolved) {
        const remaining = item.quantity - item.returnedQuantity;
        if (r.quantity > remaining) {
          throw new BadRequestException(`"${item.productName}" da faqat ${remaining} ta qaytarish mumkin`);
        }
        // Cost per still-sold unit (cost of goods over the units not yet returned).
        const unitCost = unitCostOf(item.costOfGoods, remaining);
        item.returnedQuantity += r.quantity;
        // Returned units are no longer sold — drop their cost from the line.
        item.costOfGoods = Math.max(0, item.costOfGoods - unitCost * r.quantity);
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

    const result = await this.orders.findOneOrFail({ where: { id: orderId }, relations: { items: true, shop: true } });
    this.emitOrderEvent('order:updated', result);
    // To'lab bo'lingan (onlayn) buyurtmada sotuv cheki allaqachon chiqqan —
    // qaytarilgan qatorlar uchun qisman refund chek kerak. Naqdda sotuv cheki
    // hali yo'q (u Delivered'da, kamaytirilgan miqdorlar bilan chiqadi) —
    // createRefundReceipt sotuv cheki bo'lmasa o'zi hech narsa qilmaydi.
    void this.fiscal.createRefundReceipt(orderId, returns);
    // Remind the customer to (optionally) add a return reason.
    if (result.userId) void this.push.sendToUser(result.userId, {
      title: `Buyurtma #${result.orderNumber}`,
      body: 'Ba\'zi mahsulotlar qaytarildi. Xohlasangiz sabab qoldiring.',
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
    const order = await this.orders.findOne({ where: { id: orderId }, relations: { shop: true } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    await this.assertShopCanManage(userId, order, 'orders.update_status');
    if (isTerminalOrderStatus(order.status)) {
      throw new BadRequestException('Yakunlangan buyurtmaga kod kiritib bo\'lmaydi');
    }

    const orderItems = await this.items.find({ where: { orderId } });
    for (const { orderItemId, codes } of items) {
      const item = orderItems.find((i) => i.id === orderItemId);
      if (!item) throw new NotFoundException('Buyurtma elementi topilmadi');
      // Takror skanerlangan kodlar tushiriladi; donadan ortiq kod saqlanmaydi.
      item.markingCodes = [...new Set(codes.map((c) => c.trim()).filter(Boolean))].slice(
        0,
        item.quantity,
      );
      await this.items.save(item);
    }
    void this.fiscal.rebuildIncompleteSaleForOrder(orderId);
    return this.orders.findOneOrFail({ where: { id: orderId }, relations: { items: true } });
  }

  async setReturnReason(userId: string, orderId: string, reason: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.userId !== userId) throw new ForbiddenException();
    order.returnReason = reason.trim() || null;
    return this.orders.save(order);
  }

  /**
   * Customer rates products from a delivered order (1–5 stars + optional text).
   * Per business rule, customers rate **products only** — the shop rating is
   * derived automatically from the average of all its product reviews.
   *
   * Re-submitting for an already-reviewed variant overwrites the prior review.
   */
  async createReviews(
    userId: string,
    orderId: string,
    items: { productVariantId: string; stars: number; text?: string }[],
  ): Promise<{ reviewedVariantIds: string[] }> {
    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: { items: true, shop: true },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.userId !== userId) throw new ForbiddenException();
    if (order.status !== OrderStatus.Delivered) {
      throw new BadRequestException('Faqat yetkazilgan buyurtmani baholash mumkin');
    }

    const orderedVariantIds = new Set(order.items.map((i) => i.productVariantId));
    for (const r of items) {
      if (!orderedVariantIds.has(r.productVariantId)) {
        throw new BadRequestException('Mahsulot ushbu buyurtmada yo\'q');
      }
    }

    await this.dataSource.transaction(async (manager) => {
      for (const r of items) {
        const existing = await manager.findOne(Review, {
          where: { userId, orderId, productVariantId: r.productVariantId },
        });
        if (existing) {
          existing.stars = r.stars;
          existing.text = r.text ?? null;
          await manager.save(existing);
        } else {
          await manager.save(
            manager.create(Review, {
              userId,
              orderId,
              productVariantId: r.productVariantId,
              stars: r.stars,
              text: r.text ?? null,
            }),
          );
        }
      }
    });

    // Roll up ratings for every affected variant + the shop.
    const affectedVariantIds = [...new Set(items.map((i) => i.productVariantId))];
    for (const variantId of affectedVariantIds) {
      await this.recomputeVariantRating(variantId);
    }
    await this.recomputeShopRating(order.shopId);

    const myReviews = await this.reviews.find({
      where: { orderId, userId },
      select: { productVariantId: true },
    });
    return { reviewedVariantIds: myReviews.map((rv) => rv.productVariantId) };
  }

  /** Recompute a variant's cached rating from its reviews (SQL aggregation). */
  private async recomputeVariantRating(variantId: string): Promise<void> {
    const agg = await this.reviews
      .createQueryBuilder('r')
      .select('COALESCE(AVG(r.stars), 0)', 'avg')
      .addSelect('COUNT(*)', 'cnt')
      .where('r.productVariantId = :variantId', { variantId })
      .getRawOne<{ avg: string; cnt: string }>();
    await this.variants.update(variantId, {
      ratingAverage: Math.round(Number(agg?.avg ?? 0) * 100) / 100,
      ratingCount: Number(agg?.cnt ?? 0),
    });
  }

  /** Shop rating = average of all reviews across the shop's variants (SQL). */
  private async recomputeShopRating(shopId: string): Promise<void> {
    const agg = await this.reviews
      .createQueryBuilder('r')
      .innerJoin('product_variants', 'v', 'v.id = r.productVariantId')
      .select('COALESCE(AVG(r.stars), 0)', 'avg')
      .addSelect('COUNT(*)', 'cnt')
      .where('v.shopId = :shopId', { shopId })
      .getRawOne<{ avg: string; cnt: string }>();
    await this.shops.update(shopId, {
      ratingAverage: Math.round(Number(agg?.avg ?? 0) * 100) / 100,
      ratingCount: Number(agg?.cnt ?? 0),
    });
  }

  // --- In-order chat -------------------------------------------------------

  /** Verify the user is a party to the order and return { order, fromShop }. */
  private async authorizeChat(userId: string, orderId: string) {
    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: { shop: true },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const isCustomer = order.userId === userId;
    let isShop = order.shop.ownerId === userId;
    // Staff with the chat permission represent the shop side too.
    if (!isCustomer && !isShop) {
      const member = await this.staff.findOne({
        where: { shopId: order.shopId, userId, isActive: true },
      });
      if (!member?.permissions?.includes('orders.chat')) throw new ForbiddenException();
      isShop = true;
    }
    return { order, fromShop: isShop };
  }

  async listMessages(userId: string, orderId: string): Promise<ChatMessage[]> {
    await this.authorizeChat(userId, orderId);
    return this.chat.find({
      where: { orderId },
      order: { createdAt: 'ASC' },
      take: 200,
    });
  }

  async sendMessage(userId: string, orderId: string, text: string): Promise<ChatMessage> {
    const { order, fromShop } = await this.authorizeChat(userId, orderId);
    const message = await this.chat.save(
      this.chat.create({ orderId, senderUserId: userId, fromShop, text: text.trim() }),
    );
    // Deliver live to both parties.
    if (order.userId) this.realtime.emitToUser(order.userId, 'chat:message', message);
    this.realtime.emitToShop(order.shopId, 'chat:message', message);
    // Push the other party (excluding the sender).
    void this.notifyChat(order, fromShop, userId, text.trim());
    return message;
  }

  /** Push a new chat message to the receiving side (customer ↔ shop staff). */
  private async notifyChat(
    order: Pick<Order, 'id' | 'orderNumber' | 'userId' | 'shopId'> & { shop: Pick<Shop, 'ownerId'> },
    fromShop: boolean,
    senderUserId: string,
    text: string,
  ): Promise<void> {
    const payload = {
      title: `#${order.orderNumber} — yangi xabar`,
      body: text.length > 80 ? `${text.slice(0, 80)}…` : text,
      data: { kind: 'chat', orderId: order.id, shopId: order.shopId },
    };
    if (fromShop) {
      // Shop → customer.
      if (order.userId) void this.push.sendToUser(order.userId, payload);
    } else {
      // Customer → shop owner + staff who can chat (minus the sender).
      const staff = await this.staff.find({ where: { shopId: order.shopId, isActive: true } });
      const recipients = [
        order.shop.ownerId,
        ...staff.filter((s) => s.permissions?.includes('orders.chat')).map((s) => s.userId),
      ].filter((id) => id && id !== senderUserId);
      void this.push.sendToUsers([...new Set(recipients)], payload);
    }
  }

  /**
   * Reminds customers to rate delivered orders. Runs every 4 hours.
   * Targets orders delivered 4–48 hours ago that still have unreviewed items.
   */
  @Cron('0 */4 * * *')
  async sendReviewReminders(): Promise<void> {
    const now = Date.now();
    const from = new Date(now - 48 * 60 * 60 * 1000);
    const to = new Date(now - 4 * 60 * 60 * 1000);

    const delivered = await this.orders.find({
      where: { status: OrderStatus.Delivered, updatedAt: Between(from, to), reviewReminderSentAt: IsNull() },
      relations: { items: true },
      take: 200,
    });
    if (delivered.length === 0) return;

    // For each order check if all items have been reviewed.
    const orderIds = delivered.map((o) => o.id);
    const existingReviews = await this.reviews.find({ where: { orderId: In(orderIds) } });
    const reviewedPairs = new Set(existingReviews.map((r) => `${r.orderId}:${r.productVariantId}`));

    const reminded = new Set<string>();
    const remindedOrderIds: string[] = [];
    for (const order of delivered) {
      if (!order.userId) continue;
      const hasUnreviewed = order.items.some(
        (it) => !reviewedPairs.has(`${order.id}:${it.productVariantId}`),
      );
      if (!hasUnreviewed) continue;
      // At most one reminder push per user per run — other eligible orders
      // for the same user get picked up (and marked sent) on a later run.
      if (reminded.has(order.userId)) continue;
      reminded.add(order.userId);
      remindedOrderIds.push(order.id);

      void this.push.sendToUser(order.userId, {
        title: 'Buyurtmangizni baholang',
        body: `#${order.orderNumber} buyurtmangiz haqida fikr qoldiring — bu do'konni rivojlantiradi!`,
        data: { kind: 'review_reminder', orderId: order.id },
      });
    }
    if (remindedOrderIds.length > 0) {
      // Persist so this same order never triggers a repeat reminder — the
      // previous version had no persisted flag and re-sent the same "please
      // rate your order" push every 4h for up to ~44h (≈11 times).
      await this.orders.update({ id: In(remindedOrderIds) }, { reviewReminderSentAt: new Date() });
      this.logger.log(`Sent review reminders to ${reminded.size} user(s)`);
    }
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
  async getDeliveryRoute(actorUserId: string, shopId: string): Promise<{
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
    const shop = await assertShopPermission(this.shops, this.staff, actorUserId, shopId, 'orders.view_assigned');

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
    const stops: Array<(typeof unvisited)[number] & { sequence: number; distanceFromPreviousKm: number }> = [];

    while (unvisited.length > 0) {
      let nearestIdx = 0;
      let nearestKm = Infinity;
      for (let i = 0; i < unvisited.length; i++) {
        const d = haversineKm(currentLat, currentLng, unvisited[i].lat, unvisited[i].lng);
        if (d < nearestKm) {
          nearestKm = d;
          nearestIdx = i;
        }
      }
      const [next] = unvisited.splice(nearestIdx, 1);
      stops.push({ ...next, sequence: stops.length + 1, distanceFromPreviousKm: Math.round(nearestKm * 100) / 100 });
      currentLat = next.lat;
      currentLng = next.lng;
    }

    return {
      shopLocation: { lat: shop.latitude, lng: shop.longitude },
      stops,
    };
  }

  // ─── Admin: platforma bo'ylab buyurtmalarni ko'rish ──────────────────────

  private adminOrdersFilterQuery(opts: {
    search?: string;
    status?: OrderStatus;
    channel?: OrderChannel;
    paymentMethod?: PaymentMethod;
    paymentStatus?: PaymentStatus;
    shopId?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const qb = this.orders
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.shop', 'shop')
      .leftJoinAndSelect('o.user', 'user')
      .orderBy('o.createdAt', 'DESC');

    if (opts.status) qb.andWhere('o.status = :status', { status: opts.status });
    if (opts.channel) qb.andWhere('o.channel = :channel', { channel: opts.channel });
    if (opts.paymentMethod) qb.andWhere('o.paymentMethod = :paymentMethod', { paymentMethod: opts.paymentMethod });
    if (opts.paymentStatus) qb.andWhere('o.paymentStatus = :paymentStatus', { paymentStatus: opts.paymentStatus });
    if (opts.shopId) qb.andWhere('o.shopId = :shopId', { shopId: opts.shopId });
    // Uzbekistan has a fixed UTC+5 offset (no DST) — parse the admin's
    // YYYY-MM-DD as Tashkent-local midnight, not UTC midnight, so "bugun"
    // matches what a Tashkent-based admin actually means by that date.
    if (opts.dateFrom) qb.andWhere('o.createdAt >= :dateFrom', { dateFrom: new Date(`${opts.dateFrom}T00:00:00+05:00`) });
    if (opts.dateTo) qb.andWhere('o.createdAt < :dateTo', { dateTo: new Date(new Date(`${opts.dateTo}T00:00:00+05:00`).getTime() + 24 * 3600 * 1000) });
    if (opts.search) {
      qb.andWhere(
        '(o.orderNumber ILIKE :q OR shop.name ILIKE :q OR user.phone ILIKE :q OR user.name ILIKE :q)',
        { q: `%${opts.search}%` },
      );
    }
    return qb;
  }

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
    const qb = this.adminOrdersFilterQuery(opts);
    const limit = Math.min(opts.limit ?? 30, 100);
    const offset = Math.max(opts.offset ?? 0, 0);
    const [items, total] = await qb.skip(offset).take(limit).getManyAndCount();
    return { items, total };
  }

  /** Same filters as adminListOrders, but every matching row (capped) for an .xlsx export. */
  private static readonly EXPORT_ROW_CAP = 5000;

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
    const qb = this.adminOrdersFilterQuery(opts);
    const rows = await qb.take(OrdersService.EXPORT_ROW_CAP).getMany();
    return buildXlsxBuffer(
      'Buyurtmalar',
      [
        { header: 'Buyurtma raqami', key: 'orderNumber', width: 16 },
        { header: "Do'kon", key: 'shopName', width: 24 },
        { header: 'Mijoz', key: 'customerName', width: 20 },
        { header: 'Telefon', key: 'customerPhone', width: 16 },
        { header: 'Holat', key: 'status', width: 14 },
        { header: "To'lov usuli", key: 'paymentMethod', width: 14 },
        { header: "To'lov holati", key: 'paymentStatus', width: 14 },
        { header: 'Summa', key: 'total', width: 12 },
        { header: 'Komissiyasiz', key: 'commissionExempt', width: 12 },
        { header: 'Sana', key: 'createdAt', width: 20 },
      ],
      rows.map((o) => ({
        orderNumber: o.orderNumber,
        shopName: o.shop?.name ?? '',
        customerName: o.user?.name ?? '',
        customerPhone: o.user?.phone ?? '',
        status: o.status,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        total: o.total,
        commissionExempt: o.commissionExempt ? 'ha' : "yo'q",
        createdAt: o.createdAt.toISOString(),
      })),
    );
  }

  async adminGetOrder(id: string): Promise<Order> {
    const order = await this.orders.findOne({
      where: { id },
      relations: { items: { productVariant: true }, shop: true, user: true },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    return order;
  }

  /**
   * Admin: mark/unmark a 0%-commission order (SPEC §10.3). Only meaningful
   * before the order reaches `Delivered` — settlement runs once, at that
   * transition (see settleDeliveredOrder), so toggling this after delivery
   * can't retroactively undo commission already recorded.
   */
  async adminSetCommissionExempt(id: string, exempt: boolean, adminUserId: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.status === OrderStatus.Delivered) {
      throw new BadRequestException(
        'Buyurtma allaqachon yetkazilgan — komissiya hisoblab bo\'lingan, endi bu belgi ta\'sir qilmaydi',
      );
    }
    // Update only this one column — updateStatus() re-reads the full entity
    // under a pessimistic_write lock and saves it back wholesale, so a
    // concurrent findOne-mutate-save here would risk clobbering whatever
    // status/timeline change that transaction just committed.
    await this.orders.update(id, { commissionExempt: exempt });
    void this.auditLog.record({
      adminUserId,
      action: exempt ? AuditAction.OrderCommissionExempted : AuditAction.OrderCommissionExemptRemoved,
      targetType: 'order',
      targetId: id,
    });
    return this.orders.findOneOrFail({ where: { id } });
  }
}
