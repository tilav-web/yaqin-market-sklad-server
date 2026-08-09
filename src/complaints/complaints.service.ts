import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Order, OrderStatus } from '../orders/entities/order.entity';
import { PushService } from '../push/push.service';
import { RiskService } from '../risk/risk.service';
import { SETTING_KEYS } from '../settings/entities/global-setting.entity';
import { SettingsService } from '../settings/settings.service';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { User } from '../users/entities/user.entity';
import { ComplaintStatus, OrderComplaint } from './entities/order-complaint.entity';

export interface AdminComplaintRow extends OrderComplaint {
  orderNumber: string | null;
  customerName: string | null;
  shopName: string | null;
}

@Injectable()
export class ComplaintsService {
  constructor(
    @InjectRepository(OrderComplaint)
    private readonly complaints: Repository<OrderComplaint>,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(ShopStaff)
    private readonly staff: Repository<ShopStaff>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    private readonly settings: SettingsService,
    private readonly push: PushService,
    private readonly risk: RiskService,
  ) {}

  /** Batch-joins order/customer/shop names onto raw complaint rows — mirrors AuditLogService.list()'s pattern. */
  private async withNames(items: OrderComplaint[]): Promise<AdminComplaintRow[]> {
    const orderIds = [...new Set(items.map((c) => c.orderId))];
    const customerIds = [...new Set(items.map((c) => c.customerId))];
    const shopIds = [...new Set(items.map((c) => c.shopId))];

    const [orders, customers, shops] = await Promise.all([
      orderIds.length
        ? this.orders.find({ where: { id: In(orderIds) }, select: { id: true, orderNumber: true } })
        : [],
      customerIds.length
        ? this.users.find({ where: { id: In(customerIds) }, select: { id: true, name: true, phone: true } })
        : [],
      shopIds.length ? this.shops.find({ where: { id: In(shopIds) }, select: { id: true, name: true } }) : [],
    ]);
    const orderMap = new Map(orders.map((o) => [o.id, o.orderNumber]));
    const customerMap = new Map(customers.map((u) => [u.id, u.name || u.phone]));
    const shopMap = new Map(shops.map((s) => [s.id, s.name]));

    return items.map((c) => ({
      ...c,
      orderNumber: orderMap.get(c.orderId) ?? null,
      customerName: customerMap.get(c.customerId) ?? null,
      shopName: shopMap.get(c.shopId) ?? null,
    }));
  }

  /** The order's `delivered` timeline timestamp, or null if never delivered. */
  private deliveredAt(order: Pick<Order, 'timeline'>): Date | null {
    const events = order.timeline.filter((e) => e.status === OrderStatus.Delivered);
    if (!events.length) return null;
    return new Date(events[events.length - 1].at);
  }

  /**
   * Customer disputes a delivered order. Only the order's own customer may
   * file it, only while the order is `delivered`, and only within the same
   * escrow window (`SETTING_KEYS.SETTLEMENT_HOURS`) used for pending-balance
   * settlement — reused here rather than a second hardcoded constant
   * (SPEC.md §8.5, §21).
   */
  async createComplaint(
    customerId: string,
    orderId: string,
    dto: { reason: string; description?: string },
  ): Promise<OrderComplaint> {
    const order = await this.orders.findOne({ where: { id: orderId }, relations: { shop: true } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.userId !== customerId) throw new ForbiddenException();
    if (order.status !== OrderStatus.Delivered) {
      throw new BadRequestException('Faqat yetkazilgan buyurtmaga shikoyat qilish mumkin');
    }

    const deliveredAt = this.deliveredAt(order);
    const hours = this.settings.getNumber(SETTING_KEYS.SETTLEMENT_HOURS, 24);
    const deadline = deliveredAt ? deliveredAt.getTime() + hours * 60 * 60 * 1000 : 0;
    if (!deliveredAt || Date.now() > deadline) {
      throw new BadRequestException(
        `Shikoyat faqat yetkazib berilgandan keyingi ${hours} soat ichida qabul qilinadi`,
      );
    }

    const existing = await this.complaints.findOne({ where: { orderId } });
    if (existing) throw new BadRequestException('Bu buyurtma uchun shikoyat allaqachon yuborilgan');

    const complaint = await this.complaints.save(
      this.complaints.create({
        orderId,
        customerId,
        shopId: order.shopId,
        reason: dto.reason,
        description: dto.description ?? null,
        status: ComplaintStatus.Open,
      }),
    );

    // Notify the shop side — previously a complaint sat silently until an
    // admin happened to open the queue and poll it.
    const staff = await this.staff.find({ where: { shopId: order.shopId, isActive: true } });
    const recipients = [...new Set([order.shop.ownerId, ...staff.map((s) => s.userId)])];
    void this.push.sendToUsers(recipients, {
      title: 'Yangi shikoyat',
      body: `#${order.orderNumber} — ${dto.reason}`,
      data: { orderId: order.id, kind: 'complaint:new', shopId: order.shopId, forSeller: true },
    });

    void this.risk.onComplaintFiled({ orderId: order.id, courierUserId: order.deliveredByUserId, reason: dto.reason });

    return complaint;
  }

  /** Single-order lookup — used to surface complaint status on order-detail. */
  getForOrder(orderId: string): Promise<OrderComplaint | null> {
    return this.complaints.findOne({ where: { orderId } });
  }

  /**
   * Batch check used by payments.service.ts's settlement cron: which of the
   * given orders currently have an OPEN complaint (and must not auto-settle).
   */
  async openComplaintOrderIds(orderIds: string[]): Promise<Set<string>> {
    if (!orderIds.length) return new Set();
    const rows = await this.complaints.find({
      where: { orderId: In(orderIds), status: ComplaintStatus.Open },
      select: { orderId: true },
    });
    return new Set(rows.map((r) => r.orderId));
  }

  async adminList(opts: {
    status?: ComplaintStatus;
    shopId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: AdminComplaintRow[]; total: number }> {
    const qb = this.complaints
      .createQueryBuilder('c')
      .orderBy('c.createdAt', 'DESC')
      .take(Math.min(opts.limit ?? 50, 100))
      .skip(Math.max(opts.offset ?? 0, 0));
    if (opts.status) qb.andWhere('c.status = :status', { status: opts.status });
    if (opts.shopId) qb.andWhere('c.shopId = :shopId', { shopId: opts.shopId });
    const [items, total] = await qb.getManyAndCount();
    return { items: await this.withNames(items), total };
  }

  /** Admin: all complaints for one shop (for the admin shop-detail page). */
  async listForShop(shopId: string): Promise<AdminComplaintRow[]> {
    const items = await this.complaints.find({ where: { shopId }, order: { createdAt: 'DESC' } });
    return this.withNames(items);
  }

  /** Admin sidebar badge — mirrors ContactService.unreadCount(). */
  openCount(): Promise<number> {
    return this.complaints.count({ where: { status: ComplaintStatus.Open } });
  }

  async adminResolve(id: string, adminId: string, resolution: string): Promise<OrderComplaint> {
    const complaint = await this.complaints.findOne({ where: { id } });
    if (!complaint) throw new NotFoundException('Shikoyat topilmadi');
    if (complaint.status === ComplaintStatus.Resolved) {
      throw new BadRequestException('Shikoyat allaqachon yopilgan');
    }
    complaint.status = ComplaintStatus.Resolved;
    complaint.resolution = resolution;
    complaint.resolvedByAdminId = adminId;
    complaint.resolvedAt = new Date();
    return this.complaints.save(complaint);
  }
}
