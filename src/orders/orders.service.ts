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
import { Between, DataSource, In, LessThan, Repository } from 'typeorm';

import { calcDeliveryFee, haversineKm } from '../geo/geo.util';
import { PaymentsService } from '../payments/payments.service';
import { GlobalProduct } from '../products/entities/global-product.entity';
import { MovementType } from '../products/entities/inventory-movement.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { consumeFifo, restockReturn, unitCostOf } from '../products/inventory.util';
import { PrimeService } from '../prime/prime.service';
import { PromotionsService } from '../promotions/promotions.service';
import { PushService } from '../push/push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SETTING_KEYS } from '../settings/entities/global-setting.entity';
import { SettingsService } from '../settings/settings.service';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff, StaffPermission } from '../shops/entities/shop-staff.entity';
import { isShopOpenNow } from '../shops/shop-hours.util';
import { UserAddress } from '../users/entities/user-address.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order, OrderChannel, OrderStatus, OrderTimelineEvent, PaymentMethod, PaymentStatus } from './entities/order.entity';
import { Review } from './entities/review.entity';

const orderNumberGen = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

// A new order the shop doesn't accept within this window is auto-cancelled.
const AUTO_CANCEL_MS = 5 * 60 * 1000;

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
    private readonly dataSource: DataSource,
    private readonly realtime: RealtimeGateway,
    private readonly push: PushService,
    private readonly payments: PaymentsService,
    private readonly prime: PrimeService,
    private readonly settings: SettingsService,
    private readonly promotions: PromotionsService,
  ) {}

  private static readonly STATUS_LABEL: Record<OrderStatus, string> = {
    [OrderStatus.New]: 'Yangi',
    [OrderStatus.Accepted]: 'Qabul qilindi',
    [OrderStatus.Preparing]: 'Yig\'ilmoqda',
    [OrderStatus.Delivering]: 'Yetkazib berilmoqda',
    [OrderStatus.Delivered]: 'Yetkazildi',
    [OrderStatus.Cancelled]: 'Bekor qilindi',
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
   * Authorize read access to an order for realtime/tracking endpoints: the
   * customer who placed it, the shop owner, or any active staff member of
   * that shop (e.g. the assigned courier) may view it. Mirrors the isParty
   * check in {@link getOne}.
   */
  async assertOrderParty(userId: string, orderId: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id: orderId }, relations: { shop: true } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const isParty = order.userId === userId || order.shop.ownerId === userId;
    if (!isParty) {
      const staff = await this.staff.findOne({
        where: { shopId: order.shopId, userId, isActive: true },
      });
      if (!staff) throw new ForbiddenException();
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

  async create(
    userId: string,
    dto: { shopId: string; deliveryAddressId: string; items: { productVariantId: string; quantity: number }[]; paymentMethod?: PaymentMethod },
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
    if (distanceKm > shop.deliveryZone.maxKm) {
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
      const promo = await this.promotions.findActiveForProduct(
        shop.id,
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

    let deliveryFee = calcDeliveryFee({
      distanceKm,
      freeKm: shop.deliveryZone.freeKm,
      pricingType: shop.deliveryZone.pricingType,
      pricePerStep: shop.deliveryZone.pricePerStep,
    });
    // Shop-level free_delivery promotion against the cart subtotal.
    const freeDelivery = await this.promotions.findFreeDeliveryPromotion(shop.id, subTotal);
    if (freeDelivery.free) deliveryFee = 0;

    const lowAlerts: { name: string; stock: number }[] = [];
    const created = await this.dataSource.transaction(async (manager) => {
      const order = manager.create(Order, {
        userId,
        shopId: shop.id,
        deliveryAddressId: address.id,
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
        timeline: [{ status: OrderStatus.New, at: new Date().toISOString(), byUserId: userId }],
      });
      const savedOrder = await manager.save(order);

      for (const li of lineItems) {
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
      return manager.findOneOrFail(Order, { where: { id: savedOrder.id }, relations: { items: true } });
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
      .leftJoinAndSelect('o.deliveryAddress', 'addr')
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
  ): Promise<Order & { reviewedVariantIds: string[] }> {
    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: { items: { productVariant: true }, shop: true, deliveryAddress: true, user: true },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const isParty = order.userId === userId || order.shop.ownerId === userId;
    if (!isParty) {
      // Active staff of the shop may also view the order (e.g. courier).
      const staff = await this.staff.findOne({
        where: { shopId: order.shopId, userId, isActive: true },
      });
      if (!staff) throw new ForbiddenException();
    }
    const myReviews = order.userId
      ? await this.reviews.find({
          where: { orderId, userId: order.userId },
          select: { productVariantId: true },
        })
      : [];
    return { ...order, reviewedVariantIds: myReviews.map((r) => r.productVariantId) };
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
      [OrderStatus.New]: [OrderStatus.Accepted, OrderStatus.Cancelled],
      [OrderStatus.Accepted]: [OrderStatus.Preparing, OrderStatus.Cancelled],
      [OrderStatus.Preparing]: [OrderStatus.Delivering, OrderStatus.Cancelled],
      [OrderStatus.Delivering]: [OrderStatus.Delivered, OrderStatus.Cancelled],
      [OrderStatus.Delivered]: [],
      [OrderStatus.Cancelled]: [],
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
      if (!isCustomer) await this.assertShopCanManage(actorUserId, order, 'orders.cancel');
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      order.status = nextStatus;
      const event: OrderTimelineEvent = {
        status: nextStatus,
        at: new Date().toISOString(),
        byUserId: actorUserId,
        note,
      };
      order.timeline = [...order.timeline, event];
      if (nextStatus === OrderStatus.Cancelled) {
        order.cancellationReason = note ?? null;
        await this.restockOrder(manager, order.id);
      }
      return manager.save(order);
    });

    // Hook financial settlement when order is delivered
    if (nextStatus === OrderStatus.Delivered) {
      void this.settleDeliveredOrder(order).catch((err) =>
        this.logger.error(`Payment settlement failed for order ${order.id}: ${err.message}`),
      );
    }

    this.emitOrderEvent('order:updated', saved);
    // Notify the customer when the shop advances the order; notify the shop
    // when the customer confirms delivery or cancels.
    // Shop-side actor (owner OR staff) → notify the customer; customer confirming
    // → notify the shop owner.
    const target = !isCustomer ? saved.userId : order.shop.ownerId;
    const shopPhoto = order.shop.photos?.[0];
    if (target) void this.push.sendToUser(target, {
      title: `Buyurtma #${saved.orderNumber}`,
      body: OrdersService.STATUS_LABEL[saved.status],
      data: {
        orderId: saved.id,
        kind: 'order:updated',
        ...(!isCustomer ? { shopId: order.shopId, forSeller: false } : {}),
      },
      imageUrl: shopPhoto,
    });
    return saved;
  }

  private async settleDeliveredOrder(order: Pick<Order, 'id' | 'shop' | 'total' | 'paymentMethod'>): Promise<void> {
    const sellerId = order.shop.ownerId;
    const defaultRate = this.settings.getNumber(SETTING_KEYS.COMMISSION_RATE_DEFAULT);
    const commissionRate = await this.prime.getCommissionRate(sellerId, defaultRate);

    if (order.paymentMethod === PaymentMethod.Cash) {
      await this.payments.recordCashOrderDelivery({ sellerId, orderId: order.id, orderTotal: order.total, commissionRate });
    } else {
      await this.payments.recordOnlineOrderDelivery({ sellerId, orderId: order.id, orderTotal: order.total, commissionRate });
    }
  }

  /**
   * Business rule #5: a `new` order the shop hasn't accepted within 5 minutes is
   * auto-cancelled — stock is returned and the customer is notified. Runs every
   * minute.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async autoCancelStaleNewOrders(): Promise<void> {
    const cutoff = new Date(Date.now() - AUTO_CANCEL_MS);
    const stale = await this.orders.find({
      where: { status: OrderStatus.New, createdAt: LessThan(cutoff) },
      take: 50,
    });
    for (const order of stale) {
      // Only emit/notify if the cancel actually happened (it may be skipped if
      // the order was accepted between the scan and the lock).
      const cancelled = await this.dataSource.transaction(async (manager) => {
        const fresh = await manager.findOne(Order, {
          where: { id: order.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!fresh || fresh.status !== OrderStatus.New) return false;
        await this.restockOrder(manager, fresh.id);
        fresh.status = OrderStatus.Cancelled;
        fresh.cancellationReason = 'Do\'kon 5 daqiqada qabul qilmadi — avtomatik bekor qilindi';
        fresh.timeline = [
          ...fresh.timeline,
          { status: OrderStatus.Cancelled, at: new Date().toISOString(), byUserId: null, note: 'auto-cancel' },
        ];
        await manager.save(fresh);
        return true;
      });
      if (!cancelled) continue;
      order.status = OrderStatus.Cancelled;
      this.emitOrderEvent('order:updated', order);
      if (order.userId) {
        void this.push.sendToUser(order.userId, {
          title: `Buyurtma #${order.orderNumber}`,
          body: 'Do\'kon 5 daqiqada qabul qilmadi — buyurtma bekor qilindi',
          data: { orderId: order.id, kind: 'order:auto_cancelled' },
        });
      }
    }
    if (stale.length > 0) this.logger.log(`Auto-cancelled ${stale.length} stale order(s)`);
  }

  private async restockOrder(manager: import('typeorm').EntityManager, orderId: string) {
    const items = await manager.find(OrderItem, { where: { orderId } });
    if (items.length === 0) return;
    // Load every variant in one query instead of one findOne per item (N+1).
    const variants = await manager.find(ProductVariant, {
      where: { id: In(items.map((i) => i.productVariantId)) },
    });
    const variantMap = new Map(variants.map((v) => [v.id, v]));
    for (const item of items) {
      const variant = variantMap.get(item.productVariantId);
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
    const order = await this.orders.findOne({ where: { id: orderId }, relations: { items: true, shop: true } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    // Returns are marked by the shop side (seller/courier) at hand-off, before
    // the customer pays cash — not by the customer.
    await this.assertShopCanManage(userId, order, 'orders.update_status');
    if (order.status !== OrderStatus.Delivering) {
      throw new BadRequestException('Faqat yetkazib berilayotganda qaytarish mumkin');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      let totalReturnAmount = 0;
      for (const r of returns) {
        const item = order.items.find((i) => i.id === r.orderItemId);
        if (!item) throw new NotFoundException('Buyurtma elementi topilmadi');
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

        const variant = await manager.findOne(ProductVariant, { where: { id: item.productVariantId } });
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
      return manager.save(order);
    });
    this.emitOrderEvent('order:updated', result);
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
      where: { status: OrderStatus.Delivered, updatedAt: Between(from, to) },
      relations: { items: true },
      take: 200,
    });
    if (delivered.length === 0) return;

    // For each order check if all items have been reviewed.
    const orderIds = delivered.map((o) => o.id);
    const existingReviews = await this.reviews.find({ where: { orderId: In(orderIds) } });
    const reviewedPairs = new Set(existingReviews.map((r) => `${r.orderId}:${r.productVariantId}`));

    const reminded = new Set<string>();
    for (const order of delivered) {
      if (!order.userId) continue;
      const hasUnreviewed = order.items.some(
        (it) => !reviewedPairs.has(`${order.id}:${it.productVariantId}`),
      );
      if (!hasUnreviewed) continue;
      if (reminded.has(order.userId)) continue;
      reminded.add(order.userId);

      void this.push.sendToUser(order.userId, {
        title: 'Buyurtmangizni baholang',
        body: `#${order.orderNumber} buyurtmangiz haqida fikr qoldiring — bu do'konni rivojlantiradi!`,
        data: { kind: 'review_reminder', orderId: order.id },
      });
    }
    if (reminded.size > 0) this.logger.log(`Sent review reminders to ${reminded.size} user(s)`);
  }

  // ─── Yetkazib berish marshruti ────────────────────────────────────────────

  async getDeliveryRoute(actorUserId: string, shopId: string) {
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new Error('Do\'kon topilmadi');

    const deliveringOrders = await this.orders.find({
      where: { shopId, status: OrderStatus.Delivering },
      relations: { deliveryAddress: true },
    });

    return {
      shopLocation: { lat: shop.latitude, lng: shop.longitude },
      orders: deliveringOrders
        .filter((o) => o.deliveryAddress)
        .map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          address: o.deliveryAddress!.address,
          lat: o.deliveryAddress!.latitude,
          lng: o.deliveryAddress!.longitude,
          customerPhone: o.deliveryAddress ? undefined : undefined,
          total: o.total,
        }))
        .sort((a, b) => {
          const distA = haversineKm(shop.latitude, shop.longitude, a.lat, a.lng);
          const distB = haversineKm(shop.latitude, shop.longitude, b.lat, b.lng);
          return distA - distB;
        }),
    };
  }
}
