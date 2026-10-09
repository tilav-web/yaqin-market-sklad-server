import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, LessThan, Not, Repository } from 'typeorm';

import { ClickService } from '../../click/click.service';
import { PushService } from '../../push/push.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { ProductVariant } from '../../products/entities/product-variant.entity';
import { restockReturn, unitCostOf } from '../../products/inventory.util';
import { ShopStaff } from '../../shops/entities/shop-staff.entity';
import { OrderItem } from '../entities/order-item.entity';
import {
  Order,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../entities/order.entity';

const AUTO_CANCEL_MS = 5 * 60 * 1000;
const PAID_AUTO_CANCEL_MS = 30 * 60 * 1000;

@Injectable()
export class OrderLifecycleCronService {
  private readonly logger = new Logger(OrderLifecycleCronService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(ShopStaff)
    private readonly staff: Repository<ShopStaff>,
    private readonly dataSource: DataSource,
    private readonly realtime: RealtimeGateway,
    private readonly push: PushService,
    private readonly click: ClickService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async autoCancelStaleNewOrders(): Promise<void> {
    const cutoff = new Date(Date.now() - AUTO_CANCEL_MS);
    const stale = await this.orders.find({
      where: {
        status: OrderStatus.New,
        createdAt: LessThan(cutoff),
        paymentStatus: Not(PaymentStatus.Paid),
      },
      take: 50,
    });
    await this.alertStalePaidOrders(cutoff);
    await this.autoRefundAbandonedPaidOrders();
    for (const order of stale) {
      const transitioned = await this.dataSource.transaction(
        async (manager) => {
          const fresh = await manager.findOne(Order, {
            where: { id: order.id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!fresh || fresh.status !== OrderStatus.New) return false;
          await this.restockOrder(manager, fresh.id);
          fresh.status = OrderStatus.SellerNoResponse;
          fresh.cancellationReason = "Do'kon 5 daqiqada javob bermadi";
          fresh.timeline = [
            ...fresh.timeline,
            {
              status: OrderStatus.SellerNoResponse,
              at: new Date().toISOString(),
              byUserId: null,
              note: 'auto-reject-timeout',
            },
          ];
          await manager.save(fresh);
          return true;
        },
      );
      if (!transitioned) continue;
      order.status = OrderStatus.SellerNoResponse;
      this.emitOrderEvent('order:updated', order);
      if (order.userId) {
        void this.push.sendToUser(order.userId, {
          title: `Buyurtma #${order.orderNumber}`,
          body: "Do'kon 5 daqiqada javob bermadi — boshqa do'konlardan taklif bor",
          data: { orderId: order.id, kind: 'order:seller_no_response' },
        });
      }
    }
    if (stale.length > 0)
      this.logger.log(
        `${stale.length} stale order(s) moved to SellerNoResponse`,
      );
  }

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
      const staff = await this.staff.find({
        where: { shopId: order.shopId, isActive: true },
      });
      const recipients = [
        ...new Set([order.shop.ownerId, ...staff.map((s) => s.userId)]),
      ];
      void this.push.sendToUsers(recipients, {
        title: "⚠️ To'langan buyurtma kutmoqda",
        body: `#${order.orderNumber} — mijoz to'lagan, lekin hali qabul qilinmagan. Zudlik bilan javob bering!`,
        data: {
          orderId: order.id,
          kind: 'order:paid_unaccepted',
          shopId: order.shopId,
          forSeller: true,
        },
      });
      if (order.userId) {
        void this.push.sendToUser(order.userId, {
          title: `Buyurtma #${order.orderNumber}`,
          body: "Do'kon hali javob bermadi. Kutishingiz, qayta so'rov yuborishingiz yoki bekor qilib pulni qaytarib olishingiz mumkin",
          data: { orderId: order.id, kind: 'order:paid_unaccepted_customer' },
        });
      }
    }
    await this.orders.update(
      { id: In(stalePaid.map((o) => o.id)) },
      { paidUnacceptedAlertSentAt: new Date() },
    );
    this.logger.warn(
      `${stalePaid.length} paid order(s) stuck unaccepted past the 5-min window — shop and customer notified`,
    );
  }

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
      const transitioned = await this.dataSource.transaction(
        async (manager) => {
          const fresh = await manager.findOne(Order, {
            where: { id: order.id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!fresh || fresh.status !== OrderStatus.New) return false;
          await this.restockOrder(manager, fresh.id);
          fresh.status = OrderStatus.SellerNoResponse;
          fresh.cancellationReason =
            "Do'kon javob bermadi — to'lov avtomatik qaytarildi";
          fresh.timeline = [
            ...fresh.timeline,
            {
              status: OrderStatus.SellerNoResponse,
              at: new Date().toISOString(),
              byUserId: null,
              note: 'auto-refund-timeout',
            },
          ];
          await manager.save(fresh);
          return true;
        },
      );
      if (!transitioned) continue;

      order.status = OrderStatus.SellerNoResponse;
      this.emitOrderEvent('order:updated', order);
      const refunded = await this.click.refundPaidOrder(order.id);
      if (order.userId) {
        void this.push.sendToUser(order.userId, {
          title: `Buyurtma #${order.orderNumber}`,
          body: refunded
            ? "Do'kon javob bermadi — pulingiz qaytarildi (kartaga 1-3 ish kunida tushadi)"
            : "Do'kon javob bermadi — to'lovni qaytarish boshlandi, tez orada yakunlanadi",
          data: { orderId: order.id, kind: 'order:seller_no_response' },
        });
      }
      this.logger.warn(
        `Paid order ${order.id} abandoned by shop — auto-closed, refund ${refunded ? 'done' : 'pending (retry cron)'}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryPendingRefunds(): Promise<void> {
    const stuck = await this.orders.find({
      where: {
        status: In([
          OrderStatus.Cancelled,
          OrderStatus.SellerNoResponse,
          OrderStatus.SellerRejected,
        ]),
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
          body: "To'lovingiz qaytarildi — pul kartangizga 1-3 ish kunida tushadi",
          data: { orderId: order.id, kind: 'order:refunded' },
        });
      }
    }
  }

  private async restockOrder(
    manager: import('typeorm').EntityManager,
    orderId: string,
  ) {
    const items = await manager.find(OrderItem, { where: { orderId } });
    if (items.length === 0) return;
    const sortedItems = [...items].sort((a, b) =>
      a.productVariantId.localeCompare(b.productVariantId),
    );
    for (const item of sortedItems) {
      const variant = await manager.findOne(ProductVariant, {
        where: { id: item.productVariantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!variant) continue;
      const restockQty = item.quantity - item.returnedQuantity;
      if (restockQty <= 0) continue;
      const unitCost = unitCostOf(item.costOfGoods, restockQty);
      await restockReturn(manager, {
        variant,
        quantity: restockQty,
        unitCost,
        orderId,
        reason: 'Bekor qilindi',
      });
      item.costOfGoods = 0;
      item.returnedQuantity = item.quantity;
      await manager.save(item);
    }
  }

  private emitOrderEvent(event: string, order: Order) {
    if (order.userId) this.realtime.emitToUser(order.userId, event, order);
    this.realtime.emitToShop(order.shopId, event, order);
  }
}
