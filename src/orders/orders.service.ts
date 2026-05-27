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
import { Shop } from '../shops/entities/shop.entity';
import { UserAddress } from '../users/entities/user-address.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order, OrderStatus, OrderTimelineEvent, PaymentMethod } from './entities/order.entity';

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
    private readonly dataSource: DataSource,
  ) {}

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

    return this.dataSource.transaction(async (manager) => {
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

  async getOne(userId: string, orderId: string): Promise<Order> {
    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: { items: true, shop: true, deliveryAddress: true },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.userId !== userId && order.shop.ownerId !== userId) {
      throw new ForbiddenException();
    }
    return order;
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

    return this.dataSource.transaction(async (manager) => {
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
    if (order.userId !== userId) throw new ForbiddenException();
    if (![OrderStatus.Delivering, OrderStatus.Delivered].includes(order.status)) {
      throw new BadRequestException("Faqat yetkazib berilayotgan yoki yetkazilgan buyurtmada qaytarish mumkin");
    }

    return this.dataSource.transaction(async (manager) => {
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
  }
}
