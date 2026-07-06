import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Order, OrderStatus } from '../orders/entities/order.entity';
import { SETTING_KEYS } from '../settings/entities/global-setting.entity';
import { SettingsService } from '../settings/settings.service';
import { ComplaintStatus, OrderComplaint } from './entities/order-complaint.entity';

@Injectable()
export class ComplaintsService {
  constructor(
    @InjectRepository(OrderComplaint)
    private readonly complaints: Repository<OrderComplaint>,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    private readonly settings: SettingsService,
  ) {}

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
    const order = await this.orders.findOne({ where: { id: orderId } });
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

    return this.complaints.save(
      this.complaints.create({
        orderId,
        customerId,
        shopId: order.shopId,
        reason: dto.reason,
        description: dto.description ?? null,
        status: ComplaintStatus.Open,
      }),
    );
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
  }): Promise<{ items: OrderComplaint[]; total: number }> {
    const qb = this.complaints
      .createQueryBuilder('c')
      .orderBy('c.createdAt', 'DESC')
      .take(Math.min(opts.limit ?? 50, 100))
      .skip(Math.max(opts.offset ?? 0, 0));
    if (opts.status) qb.andWhere('c.status = :status', { status: opts.status });
    if (opts.shopId) qb.andWhere('c.shopId = :shopId', { shopId: opts.shopId });
    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  /** Admin: all complaints for one shop (for the admin shop-detail page). */
  listForShop(shopId: string): Promise<OrderComplaint[]> {
    return this.complaints.find({ where: { shopId }, order: { createdAt: 'DESC' } });
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
