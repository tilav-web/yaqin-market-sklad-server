import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, MoreThanOrEqual, Repository } from 'typeorm';

import { GlobalProduct } from '../products/entities/global-product.entity';
import {
  InventoryMovement,
  MovementType,
} from '../products/entities/inventory-movement.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { StockBatch } from '../products/entities/stock-batch.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { Shop } from '../shops/entities/shop.entity';
import { User } from '../users/entities/user.entity';
import {
  AnalyticsEvent,
  AnalyticsEventType,
} from './entities/analytics-event.entity';

export type StatsPeriod = 'today' | '7d' | '30d';

export interface StatsResult {
  period: StatsPeriod;
  revenue: number;
  profit: number;
  orderCount: number;
  itemsSold: number;
  inventoryValue: number;
  topProducts: { name: string; qty: number; revenue: number }[];
}

export interface ReorderItem {
  variantId: string;
  name: string;
  stock: number;
  lowStockThreshold: number;
  soldLast30: number;
  perDay: number;
  daysLeft: number | null;
  suggestedQty: number;
  unitCost: number;
}

export interface ExpiringItem {
  batchId: string;
  variantId: string;
  name: string;
  quantityRemaining: number;
  costPrice: number;
  expiryDate: string;
  daysToExpiry: number;
}

export interface AdminDashboardStats {
  totalUsers: number;
  totalSellers: number;
  totalShops: number;
  totalOrders: number;
  ordersToday: number;
  orders7d: number;
  gmvTotal: number;
  gmv7d: number;
  pendingApplications: number;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly items: Repository<OrderItem>,
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
    @InjectRepository(StockBatch)
    private readonly batches: Repository<StockBatch>,
    @InjectRepository(InventoryMovement)
    private readonly movements: Repository<InventoryMovement>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(GlobalProduct)
    private readonly globalProducts: Repository<GlobalProduct>,
    @InjectRepository(AnalyticsEvent)
    private readonly events: Repository<AnalyticsEvent>,
  ) {}

  // ─── View → cart → order funnel (SPEC.md §5.3) ────────────────────────────

  /**
   * Write-only, intentionally minimal: no existence checks against
   * shop/productVariant so the hot path (called on every product view /
   * add-to-cart tap) stays a single cheap bulk insert.
   */
  async logEvents(
    userId: string | null,
    items: {
      type: AnalyticsEventType;
      shopId: string;
      productVariantId?: string;
    }[],
  ): Promise<void> {
    if (!items.length) return;
    await this.events.insert(
      items.map((i) => ({
        type: i.type,
        userId,
        shopId: i.shopId,
        productVariantId: i.productVariantId ?? null,
      })),
    );
  }

  /**
   * Aggregate funnel counts for an admin-chosen date range: product views,
   * add-to-cart taps, and orders placed (any status — placing an order is
   * the conversion event; its eventual delivered/cancelled outcome is a
   * separate concern already covered by the dashboard/timeline endpoints).
   * MVP scope: aggregate totals only, no per-user/session funnel tracking.
   */
  async funnel(
    from?: string,
    to?: string,
  ): Promise<{
    from: string;
    to: string;
    productViews: number;
    addToCart: number;
    orders: number;
  }> {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [productViews, addToCart, orders] = await Promise.all([
      this.events.count({
        where: {
          type: AnalyticsEventType.ProductView,
          createdAt: Between(fromDate, toDate),
        },
      }),
      this.events.count({
        where: {
          type: AnalyticsEventType.AddToCart,
          createdAt: Between(fromDate, toDate),
        },
      }),
      this.orders.count({ where: { createdAt: Between(fromDate, toDate) } }),
    ]);

    return {
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      productViews,
      addToCart,
      orders,
    };
  }

  private async ensureOwned(userId: string, shopId: string): Promise<void> {
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException("Do'kon topilmadi");
    if (shop.ownerId !== userId) throw new ForbiddenException();
  }

  private periodStart(period: StatsPeriod): Date {
    const now = new Date();
    if (period === 'today') {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    const days = period === '7d' ? 7 : 30;
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  /** Sales + profit dashboard for delivered orders within the period. */
  async stats(
    userId: string,
    shopId: string,
    period: StatsPeriod,
  ): Promise<StatsResult> {
    await this.ensureOwned(userId, shopId);
    const start = this.periodStart(period);

    // Per-line aggregates over delivered orders, net of returns.
    const agg = await this.items
      .createQueryBuilder('it')
      .innerJoin(Order, 'o', 'o.id = it.orderId')
      .select(
        'COALESCE(SUM(it.unitPrice * (it.quantity - it.returnedQuantity)), 0)',
        'revenue',
      )
      .addSelect('COALESCE(SUM(it.costOfGoods), 0)', 'cogs')
      .addSelect('COALESCE(SUM(it.quantity - it.returnedQuantity), 0)', 'qty')
      .addSelect('COUNT(DISTINCT o.id)', 'orders')
      .where('o.shopId = :shopId', { shopId })
      .andWhere('o.status = :st', { st: OrderStatus.Delivered })
      .andWhere('o.createdAt >= :start', { start })
      .getRawOne<{
        revenue: string;
        cogs: string;
        qty: string;
        orders: string;
      }>();

    const revenue = Number(agg?.revenue ?? 0);
    const cogs = Number(agg?.cogs ?? 0);

    const top = await this.items
      .createQueryBuilder('it')
      .innerJoin(Order, 'o', 'o.id = it.orderId')
      .select('it.productName', 'name')
      .addSelect('SUM(it.quantity - it.returnedQuantity)', 'qty')
      .addSelect(
        'SUM(it.unitPrice * (it.quantity - it.returnedQuantity))',
        'revenue',
      )
      .where('o.shopId = :shopId', { shopId })
      .andWhere('o.status = :st', { st: OrderStatus.Delivered })
      .andWhere('o.createdAt >= :start', { start })
      .groupBy('it.productName')
      .orderBy('qty', 'DESC')
      .limit(5)
      .getRawMany<{ name: string; qty: string; revenue: string }>();

    const inv = await this.batches
      .createQueryBuilder('b')
      .select('COALESCE(SUM(b.quantityRemaining * b.costPrice), 0)', 'value')
      .where('b.shopId = :shopId', { shopId })
      .andWhere('b.quantityRemaining > 0')
      .getRawOne<{ value: string }>();

    return {
      period,
      revenue,
      profit: revenue - cogs,
      orderCount: Number(agg?.orders ?? 0),
      itemsSold: Number(agg?.qty ?? 0),
      inventoryValue: Number(inv?.value ?? 0),
      topProducts: top.map((t) => ({
        name: t.name,
        qty: Number(t.qty),
        revenue: Number(t.revenue),
      })),
    };
  }

  /**
   * "Olib kelish kerak" — replenishment suggestions based on the last 30 days of
   * sales velocity. Flags items that are low or will run out within a week.
   */
  async reorder(userId: string, shopId: string): Promise<ReorderItem[]> {
    await this.ensureOwned(userId, shopId);
    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const variants = await this.variants.find({
      where: { shopId, isActive: true },
    });
    if (variants.length === 0) return [];
    const gpIds = [...new Set(variants.map((v) => v.globalProductId))];
    const gps = await this.globalProducts.findBy({ id: In(gpIds) });
    const gpNameMap = new Map(
      gps.map((gp) => [
        gp.id,
        typeof gp.name === 'object' ? gp.name?.uz || '' : (gp.name ?? ''),
      ]),
    );
    const variantNameMap = new Map(
      variants.map((v) => [v.id, gpNameMap.get(v.globalProductId) ?? '']),
    );

    // Units sold per variant over the last 30 days (from the movement ledger).
    // NET demand = sold − returned/cancelled, so cancelled orders don't inflate
    // the velocity (and over-suggest restocking).
    const soldRows = await this.movements
      .createQueryBuilder('m')
      .select('m.productVariantId', 'vid')
      .addSelect(
        'SUM(CASE WHEN m.type = :sold THEN m.quantity WHEN m.type = :returned THEN -m.quantity ELSE 0 END)',
        'qty',
      )
      .where('m.productVariantId IN (:...ids)', {
        ids: variants.map((v) => v.id),
      })
      .andWhere('m.type IN (:...types)', {
        types: [MovementType.Sold, MovementType.Returned],
      })
      .andWhere('m.createdAt >= :start', { start })
      .setParameters({
        sold: MovementType.Sold,
        returned: MovementType.Returned,
      })
      .groupBy('m.productVariantId')
      .getRawMany<{ vid: string; qty: string }>();
    const soldMap = new Map(
      soldRows.map((r) => [r.vid, Math.max(0, Number(r.qty))]),
    );

    // Next FIFO cost per variant (cost to restock estimate).
    const heads = await this.batches
      .createQueryBuilder('b')
      .where('b.shopId = :shopId', { shopId })
      .andWhere('b.quantityRemaining > 0')
      .orderBy('b.productVariantId')
      .addOrderBy('b.receivedAt', 'ASC')
      .getMany();
    const costMap = new Map<string, number>();
    for (const b of heads)
      if (!costMap.has(b.productVariantId))
        costMap.set(b.productVariantId, b.costPrice);

    const out: ReorderItem[] = [];
    for (const v of variants) {
      const soldLast30 = soldMap.get(v.id) ?? 0;
      const perDay = soldLast30 / 30;
      const daysLeft = perDay > 0 ? Math.floor(v.stock / perDay) : null;
      const isLow = v.stock <= v.lowStockThreshold;
      const willRunOut = daysLeft !== null && daysLeft < 7;
      if (!isLow && !willRunOut) continue;
      // Target two weeks of cover (or at least twice the low threshold).
      const target = Math.max(Math.ceil(perDay * 14), v.lowStockThreshold * 2);
      out.push({
        variantId: v.id,
        name: variantNameMap.get(v.id) ?? '',
        stock: v.stock,
        lowStockThreshold: v.lowStockThreshold,
        soldLast30,
        perDay: Math.round(perDay * 10) / 10,
        daysLeft,
        suggestedQty: Math.max(0, target - v.stock),
        unitCost: costMap.get(v.id) ?? 0,
      });
    }
    // Most urgent first: fewest days of cover, then lowest stock.
    out.sort((a, b) => {
      const da = a.daysLeft ?? 9999;
      const db = b.daysLeft ?? 9999;
      return da - db || a.stock - b.stock;
    });
    return out;
  }

  /** Batches expiring within `days` (or already expired), soonest first. */
  async expiring(
    userId: string,
    shopId: string,
    days: number,
  ): Promise<ExpiringItem[]> {
    await this.ensureOwned(userId, shopId);
    const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const rows = await this.batches
      .createQueryBuilder('b')
      .innerJoin(ProductVariant, 'v', 'v.id = b.productVariantId')
      .innerJoin(GlobalProduct, 'gp', 'gp.id = v."globalProductId"')
      .select(['b.id AS id', 'b.productVariantId AS vid', 'gp.name AS name'])
      .addSelect('b.quantityRemaining', 'qty')
      .addSelect('b.costPrice', 'cost')
      .addSelect('b.expiryDate', 'expiry')
      .where('b.shopId = :shopId', { shopId })
      .andWhere('b.quantityRemaining > 0')
      .andWhere('b.expiryDate IS NOT NULL')
      .andWhere('b.expiryDate <= :cutoff', { cutoff })
      .orderBy('b.expiryDate', 'ASC')
      .getRawMany<{
        id: string;
        vid: string;
        name: string;
        qty: number;
        cost: number;
        expiry: string;
      }>();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return rows.map((r) => {
      const exp = new Date(r.expiry);
      const daysToExpiry = Math.round(
        (exp.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
      );
      return {
        batchId: r.id,
        variantId: r.vid,
        name: r.name,
        quantityRemaining: Number(r.qty),
        costPrice: Number(r.cost),
        expiryDate:
          typeof r.expiry === 'string'
            ? r.expiry.slice(0, 10)
            : exp.toISOString().slice(0, 10),
        daysToExpiry,
      };
    });
  }

  /** Platform-wide dashboard stats for admin. */
  async adminDashboard(): Promise<AdminDashboardStats> {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const start7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totalUsers, totalSellers, totalShops, totalOrders] =
      await Promise.all([
        this.users.count(),
        this.users.count({ where: { isSellerApproved: true } }),
        this.shops.count(),
        this.orders.count({ where: { status: OrderStatus.Delivered } }),
      ]);

    const [ordersToday, orders7d] = await Promise.all([
      this.orders.count({
        where: {
          status: OrderStatus.Delivered,
          createdAt: MoreThanOrEqual(startOfDay),
        },
      }),
      this.orders.count({
        where: {
          status: OrderStatus.Delivered,
          createdAt: MoreThanOrEqual(start7d),
        },
      }),
    ]);

    const gmvRows = await this.orders
      .createQueryBuilder('o')
      .select('COALESCE(SUM(o.total), 0)', 'gmv')
      .where('o.status = :st', { st: OrderStatus.Delivered })
      .getRawOne<{ gmv: string }>();

    const gmv7dRows = await this.orders
      .createQueryBuilder('o')
      .select('COALESCE(SUM(o.total), 0)', 'gmv')
      .where('o.status = :st', { st: OrderStatus.Delivered })
      .andWhere('o.createdAt >= :start', { start: start7d })
      .getRawOne<{ gmv: string }>();

    // Count pending applications via raw query to avoid circular imports
    const pendingRow = await this.orders.manager
      .createQueryBuilder()
      .select('COUNT(*)', 'cnt')
      .from('seller_applications', 'sa')
      .where("sa.status = 'pending'")
      .getRawOne<{ cnt: string }>();

    return {
      totalUsers,
      totalSellers,
      totalShops,
      totalOrders,
      ordersToday,
      orders7d,
      gmvTotal: Number(gmvRows?.gmv ?? 0),
      gmv7d: Number(gmv7dRows?.gmv ?? 0),
      pendingApplications: Number(pendingRow?.cnt ?? 0),
    };
  }

  /** Top shops by delivered order count and GMV, last 30 days. */
  async topShops(
    limit = 10,
  ): Promise<
    Array<{ shopId: string; shopName: string; orderCount: number; gmv: number }>
  > {
    const start30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await this.orders
      .createQueryBuilder('o')
      .innerJoin('o.shop', 's')
      .select([
        'o.shopId AS "shopId"',
        's.name AS "shopName"',
        'COUNT(o.id) AS "orderCount"',
        'COALESCE(SUM(o.total), 0) AS "gmv"',
      ])
      .where('o.status = :st', { st: OrderStatus.Delivered })
      .andWhere('o.createdAt >= :start', { start: start30d })
      .groupBy('o.shopId, s.name')
      .orderBy('"orderCount"', 'DESC')
      .limit(limit)
      .getRawMany<{
        shopId: string;
        shopName: string;
        orderCount: string;
        gmv: string;
      }>();

    return rows.map((r) => ({
      shopId: r.shopId,
      shopName: r.shopName,
      orderCount: Number(r.orderCount),
      gmv: Number(r.gmv),
    }));
  }

  /** Top products by quantity sold, last 30 days. */
  async topProducts(limit = 10): Promise<
    Array<{
      productName: string;
      shopName: string;
      qtySold: number;
      revenue: number;
    }>
  > {
    const start30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await this.orders.manager
      .createQueryBuilder()
      .select([
        'oi."productName"',
        's.name AS "shopName"',
        'SUM(oi.quantity) AS "qtySold"',
        'SUM(oi."lineTotal") AS "revenue"',
      ])
      .from('order_items', 'oi')
      .innerJoin('orders', 'o', 'o.id = oi."orderId"')
      .innerJoin('shops', 's', 's.id = o."shopId"')
      .where("o.status = 'delivered'")
      .andWhere('o."createdAt" >= :start', { start: start30d })
      .groupBy('oi."productName", s.name')
      .orderBy('"qtySold"', 'DESC')
      .limit(limit)
      .getRawMany<{
        productName: string;
        shopName: string;
        qtySold: string;
        revenue: string;
      }>();

    return rows.map((r) => ({
      productName: r.productName,
      shopName: r.shopName,
      qtySold: Number(r.qtySold),
      revenue: Number(r.revenue),
    }));
  }

  /** Daily order count and GMV for the last N days. */
  async ordersTimeline(
    days = 30,
  ): Promise<Array<{ date: string; count: number; gmv: number }>> {
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.orders.manager
      .createQueryBuilder()
      .select([
        'DATE_TRUNC(\'day\', o."createdAt")::date::text AS date',
        'COUNT(o.id) AS count',
        'COALESCE(SUM(o.total), 0) AS gmv',
      ])
      .from('orders', 'o')
      .where("o.status = 'delivered'")
      .andWhere('o."createdAt" >= :start', { start })
      .groupBy('DATE_TRUNC(\'day\', o."createdAt")')
      .orderBy('date', 'ASC')
      .getRawMany<{ date: string; count: string; gmv: string }>();

    return rows.map((r) => ({
      date: r.date,
      count: Number(r.count),
      gmv: Number(r.gmv),
    }));
  }
}
