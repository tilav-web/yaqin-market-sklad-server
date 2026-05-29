import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { customAlphabet } from 'nanoid';
import { DataSource, In, Repository } from 'typeorm';

import { calcDeliveryFee, haversineKm } from '../geo/geo.util';
import { InventoryMovement, MovementType } from '../products/entities/inventory-movement.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { PushService } from '../push/push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff, StaffPermission } from '../shops/entities/shop-staff.entity';
import { UserAddress } from '../users/entities/user-address.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order, OrderStatus, OrderTimelineEvent, PaymentMethod } from './entities/order.entity';
import { Review } from './entities/review.entity';

const orderNumberGen = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

@Injectable()
export class OrdersService {
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
    private readonly dataSource: DataSource,
    private readonly realtime: RealtimeGateway,
    private readonly push: PushService,
  ) {}

  private static readonly STATUS_LABEL: Record<OrderStatus, string> = {
    [OrderStatus.New]: 'Yangi',
    [OrderStatus.Accepted]: 'Qabul qilindi',
    [OrderStatus.Preparing]: 'Yig\'ilmoqda',
    [OrderStatus.Delivering]: 'Yetkazib berilmoqda',
    [OrderStatus.Delivered]: 'Yetkazildi',
    [OrderStatus.Cancelled]: 'Bekor qilindi',
  };

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
    this.realtime.emitToUser(order.userId, event, payload);
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

  async create(
    userId: string,
    dto: { shopId: string; deliveryAddressId: string; items: { productVariantId: string; quantity: number }[] },
  ): Promise<Order> {
    const shop = await this.shops.findOne({ where: { id: dto.shopId, isActive: true } });
    if (!shop) throw new NotFoundException('Do\'kon topilmadi');
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
    let subTotal = 0;
    const lineItems: { variant: ProductVariant; quantity: number; unitPrice: number; lineTotal: number }[] = [];
    for (const it of dto.items) {
      const v = variantMap.get(it.productVariantId);
      if (!v) throw new BadRequestException('Mahsulot topilmadi');
      if (v.stock < it.quantity) {
        throw new BadRequestException(`"${v.name}" mahsulotidan ${v.stock} ta qoldi, ${it.quantity} ta so'ralgan`);
      }
      const unitPrice = v.discountPrice ?? v.price;
      const lineTotal = unitPrice * it.quantity;
      subTotal += lineTotal;
      lineItems.push({ variant: v, quantity: it.quantity, unitPrice, lineTotal });
    }

    if (subTotal < shop.minOrderPrice) {
      throw new BadRequestException(`Minimal buyurtma narxi: ${shop.minOrderPrice} so'm`);
    }

    const deliveryFee = calcDeliveryFee({
      distanceKm,
      freeKm: shop.deliveryZone.freeKm,
      pricingType: shop.deliveryZone.pricingType,
      pricePerStep: shop.deliveryZone.pricePerStep,
    });

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
        paymentMethod: PaymentMethod.Cash,
        timeline: [{ status: OrderStatus.New, at: new Date().toISOString(), byUserId: userId }],
      });
      const savedOrder = await manager.save(order);

      for (const li of lineItems) {
        const item = manager.create(OrderItem, {
          orderId: savedOrder.id,
          productVariantId: li.variant.id,
          productName: li.variant.name,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          lineTotal: li.lineTotal,
        });
        await manager.save(item);

        const before = li.variant.stock;
        li.variant.stock -= li.quantity;
        await manager.save(li.variant);

        await manager.save(
          manager.create(InventoryMovement, {
            productVariantId: li.variant.id,
            type: MovementType.Sold,
            quantity: li.quantity,
            beforeStock: before,
            afterStock: li.variant.stock,
            orderId: savedOrder.id,
          }),
        );
      }

      return manager.findOne(Order, { where: { id: savedOrder.id }, relations: { items: true } }) as Promise<Order>;
    });
    this.emitOrderEvent('order:new', created);
    void this.push.sendToUser(shop.ownerId, {
      title: 'Yangi buyurtma',
      body: `#${created.orderNumber} — ${created.total.toLocaleString()} so'm`,
      data: { orderId: created.id, kind: 'order:new' },
    });
    return created;
  }

  listForUser(userId: string): Promise<Order[]> {
    return this.orders.find({
      where: { userId },
      relations: { items: true, shop: true },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  listForShop(shopOwnerId: string, shopId: string, status?: OrderStatus): Promise<Order[]> {
    return this.dataSource
      .createQueryBuilder(Order, 'o')
      .innerJoin('o.shop', 'shop')
      .leftJoinAndSelect('o.items', 'items')
      .leftJoinAndSelect('o.deliveryAddress', 'addr')
      .leftJoinAndSelect('o.user', 'usr')
      .where('shop.id = :shopId', { shopId })
      .andWhere('shop.ownerId = :ownerId', { ownerId: shopOwnerId })
      .andWhere(status ? 'o.status = :status' : '1=1', status ? { status } : {})
      .orderBy('o.createdAt', 'DESC')
      .take(200)
      .getMany();
  }

  async getOne(
    userId: string,
    orderId: string,
  ): Promise<Order & { reviewedVariantIds: string[] }> {
    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: { items: true, shop: true, deliveryAddress: true },
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
    const myReviews = await this.reviews.find({
      where: { orderId, userId: order.userId },
      select: { productVariantId: true },
    });
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

    if (
      [OrderStatus.Accepted, OrderStatus.Preparing, OrderStatus.Delivering].includes(nextStatus) &&
      !isOwner
    ) {
      throw new ForbiddenException('Faqat sotuvchi statusni o\'zgartirishi mumkin');
    }
    if (nextStatus === OrderStatus.Delivered && !isCustomer && !isOwner) {
      throw new ForbiddenException('Faqat customer yetkazilganini tasdiqlashi mumkin');
    }
    if (nextStatus === OrderStatus.Cancelled && !isCustomer && !isOwner) {
      throw new ForbiddenException();
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
    this.emitOrderEvent('order:updated', saved);
    // Notify the customer when the shop advances the order; notify the shop
    // when the customer confirms delivery or cancels.
    const target = isOwner ? saved.userId : order.shop.ownerId;
    void this.push.sendToUser(target, {
      title: `Buyurtma #${saved.orderNumber}`,
      body: OrdersService.STATUS_LABEL[saved.status],
      data: { orderId: saved.id, kind: 'order:updated' },
    });
    return saved;
  }

  private async restockOrder(manager: import('typeorm').EntityManager, orderId: string) {
    const items = await manager.find(OrderItem, { where: { orderId } });
    for (const item of items) {
      const variant = await manager.findOne(ProductVariant, { where: { id: item.productVariantId } });
      if (!variant) continue;
      const before = variant.stock;
      const restockQty = item.quantity - item.returnedQuantity;
      variant.stock += restockQty;
      await manager.save(variant);
      await manager.save(
        manager.create(InventoryMovement, {
          productVariantId: variant.id,
          type: MovementType.Returned,
          quantity: restockQty,
          beforeStock: before,
          afterStock: variant.stock,
          orderId,
          reason: 'Bekor qilindi',
        }),
      );
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
        item.returnedQuantity += r.quantity;
        await manager.save(item);

        const variant = await manager.findOne(ProductVariant, { where: { id: item.productVariantId } });
        if (variant) {
          const before = variant.stock;
          variant.stock += r.quantity;
          await manager.save(variant);
          await manager.save(
            manager.create(InventoryMovement, {
              productVariantId: variant.id,
              type: MovementType.Returned,
              quantity: r.quantity,
              beforeStock: before,
              afterStock: variant.stock,
              orderId,
              reason: reason ?? 'Customer qaytardi',
              performedByUserId: userId,
            }),
          );
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
    void this.push.sendToUser(result.userId, {
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

  /** Recompute a variant's cached rating from its reviews. */
  private async recomputeVariantRating(variantId: string): Promise<void> {
    const rows = await this.reviews.find({
      where: { productVariantId: variantId },
      select: { stars: true },
    });
    const count = rows.length;
    const avg = count ? rows.reduce((s, r) => s + r.stars, 0) / count : 0;
    await this.variants.update(variantId, {
      ratingAverage: Math.round(avg * 100) / 100,
      ratingCount: count,
    });
  }

  /** Shop rating = average of all reviews across the shop's variants. */
  private async recomputeShopRating(shopId: string): Promise<void> {
    const variants = await this.variants.find({
      where: { shopId },
      select: { id: true },
    });
    const variantIds = variants.map((v) => v.id);
    if (variantIds.length === 0) return;
    const rows = await this.reviews.find({
      where: { productVariantId: In(variantIds) },
      select: { stars: true },
    });
    const count = rows.length;
    const avg = count ? rows.reduce((s, r) => s + r.stars, 0) / count : 0;
    await this.shops.update(shopId, {
      ratingAverage: Math.round(avg * 100) / 100,
      ratingCount: count,
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
    const isShop = order.shop.ownerId === userId;
    if (!isCustomer && !isShop) throw new ForbiddenException();
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
    this.realtime.emitToUser(order.userId, 'chat:message', message);
    this.realtime.emitToShop(order.shopId, 'chat:message', message);
    return message;
  }
}
