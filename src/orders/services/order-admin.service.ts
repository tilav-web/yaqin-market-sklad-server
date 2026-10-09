import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction } from '../../audit-log/entities/admin-audit-log.entity';
import { buildXlsxBuffer } from '../../common/xlsx.util';
import {
  Order,
  OrderChannel,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../entities/order.entity';

@Injectable()
export class OrderAdminService {
  private static readonly EXPORT_ROW_CAP = 5000;

  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    private readonly auditLog: AuditLogService,
  ) {}

  adminOrdersFilterQuery(opts: {
    search?: string;
    status?: OrderStatus;
    channel?: OrderChannel;
    paymentMethod?: PaymentMethod;
    paymentStatus?: PaymentStatus;
    shopId?: string;
    dateFrom?: string;
    dateTo?: string;
  }): SelectQueryBuilder<Order> {
    const qb = this.orders
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.shop', 'shop')
      .leftJoinAndSelect('o.user', 'user')
      .orderBy('o.createdAt', 'DESC');

    if (opts.status) qb.andWhere('o.status = :status', { status: opts.status });
    if (opts.channel)
      qb.andWhere('o.channel = :channel', { channel: opts.channel });
    if (opts.paymentMethod)
      qb.andWhere('o.paymentMethod = :paymentMethod', {
        paymentMethod: opts.paymentMethod,
      });
    if (opts.paymentStatus)
      qb.andWhere('o.paymentStatus = :paymentStatus', {
        paymentStatus: opts.paymentStatus,
      });
    if (opts.shopId) qb.andWhere('o.shopId = :shopId', { shopId: opts.shopId });

    if (opts.dateFrom)
      qb.andWhere('o.createdAt >= :dateFrom', {
        dateFrom: new Date(`${opts.dateFrom}T00:00:00+05:00`),
      });
    if (opts.dateTo)
      qb.andWhere('o.createdAt < :dateTo', {
        dateTo: new Date(
          new Date(`${opts.dateTo}T00:00:00+05:00`).getTime() +
            24 * 3600 * 1000,
        ),
      });
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
    const rows = await qb.take(OrderAdminService.EXPORT_ROW_CAP).getMany();
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

  async adminSetCommissionExempt(
    id: string,
    exempt: boolean,
    adminUserId: string,
  ): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.status === OrderStatus.Delivered) {
      throw new BadRequestException(
        "Buyurtma allaqachon yetkazilgan — komissiya hisoblab bo'lingan, endi bu belgi ta'sir qilmaydi",
      );
    }
    await this.orders.update(id, { commissionExempt: exempt });
    void this.auditLog.record({
      adminUserId,
      action: exempt
        ? AuditAction.OrderCommissionExempted
        : AuditAction.OrderCommissionExemptRemoved,
      targetType: 'order',
      targetId: id,
    });
    return this.orders.findOneOrFail({ where: { id } });
  }
}
