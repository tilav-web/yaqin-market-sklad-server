import { randomBytes } from 'crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, In, Repository } from 'typeorm';

import { Order } from '../orders/entities/order.entity';
import { GlobalProduct } from '../products/entities/global-product.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { User } from '../users/entities/user.entity';
import { boundingBox, calcDeliveryFee, GeoJsonPolygon, haversineKm, pointInPolygon } from '../geo/geo.util';
import { Shop } from './entities/shop.entity';
import {
  PRESET_PERMISSIONS,
  ShopStaff,
  StaffPermission,
  StaffPreset,
} from './entities/shop-staff.entity';
import { StaffInvitation, StaffInvitationStatus } from './entities/staff-invitation.entity';
import { assertShopPermission } from './shop-access.util';
import { isShopOpenNow } from './shop-hours.util';
import { CreateShopDto, UpdateShopDto } from './dto/shop.dto';

const INVITE_TTL_MS = 10 * 60 * 1000; // QR invite valid for 10 minutes (per spec)

// Widest realistic delivery zone — the SQL bounding-box prefilter radius.
const MAX_DELIVERY_RADIUS_KM = 50;

export interface StaffView {
  id: string;
  userId: string;
  name: string | null;
  phone: string;
  customRoleName: string;
  preset: StaffPreset;
  permissions: StaffPermission[];
  isActive: boolean;
}

@Injectable()
export class ShopsService {
  constructor(
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(ShopStaff)
    private readonly staff: Repository<ShopStaff>,
    @InjectRepository(StaffInvitation)
    private readonly invitations: Repository<StaffInvitation>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
    @InjectRepository(GlobalProduct)
    private readonly globalProducts: Repository<GlobalProduct>,
    private readonly dataSource: DataSource,
  ) {}

  findOne(id: string): Promise<Shop | null> {
    return this.shops.findOne({ where: { id } });
  }

  async listMyShops(userId: string): Promise<(Shop & { newOrderCount: number })[]> {
    const shops = await this.shops.find({ where: { ownerId: userId }, order: { createdAt: 'ASC' } });
    if (shops.length === 0) return [];
    // UNSEEN new orders per shop: status 'new' AND created after the owner last
    // opened that shop's orders. Opening the orders tab clears the badge.
    const rows = await this.orders
      .createQueryBuilder('o')
      .select('o.shopId', 'shopId')
      .addSelect('COUNT(*)', 'cnt')
      .where('o.shopId IN (:...ids)', { ids: shops.map((s) => s.id) })
      .andWhere("o.status = 'new'")
      .andWhere('(s.ownerOrdersSeenAt IS NULL OR o.createdAt > s.ownerOrdersSeenAt)')
      .innerJoin('o.shop', 's')
      .groupBy('o.shopId')
      .getRawMany<{ shopId: string; cnt: string }>();
    const counts = new Map(rows.map((r) => [r.shopId, Number(r.cnt)]));
    return shops.map((s) => Object.assign(s, { newOrderCount: counts.get(s.id) ?? 0 }));
  }

  /** Mark this shop's orders as seen by the owner — clears the profile badge. */
  async markOrdersSeen(userId: string, shopId: string): Promise<void> {
    const shop = await this.getOwned(userId, shopId);
    shop.ownerOrdersSeenAt = new Date();
    await this.shops.save(shop);
  }

  /**
   * A user creates a shop directly and instantly becomes its owner (and a
   * seller). Sellers may own multiple shops.
   */
  async createShop(userId: string, dto: CreateShopDto): Promise<Shop> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user?.isSellerApproved) {
      throw new ForbiddenException(
        'Do\'kon yaratish uchun avval ariza yuborib, admin tasdiqlashini kuting',
      );
    }
    return this.shops.save(
      this.shops.create({
        ownerId: userId,
        name: dto.name,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        description: dto.description ?? null,
        photos: dto.photos ?? [],
      }),
    );
  }

  async listShopsWhereStaff(userId: string): Promise<{ shop: Shop; role: string }[]> {
    const staffRecords = await this.staff.find({
      where: { userId, isActive: true },
      relations: { shop: true },
    });
    return staffRecords.map((s) => ({ shop: s.shop, role: s.customRoleName }));
  }

  async getOwned(userId: string, shopId: string): Promise<Shop> {
    const shop = await this.findOne(shopId);
    if (!shop) throw new NotFoundException('Do\'kon topilmadi');
    if (shop.ownerId !== userId) throw new ForbiddenException('Bu do\'kon sizniki emas');
    return shop;
  }

  async update(userId: string, shopId: string, dto: UpdateShopDto): Promise<Shop> {
    const shop = await this.getOwned(userId, shopId);
    Object.assign(shop, dto);
    return this.shops.save(shop);
  }

  // ---- Staff (QR onboarding) ----------------------------------------------

  /**
   * Owner generates a short-lived QR invite. Whoever scans and accepts it
   * becomes staff of this shop with NO permissions — the owner grants them
   * afterwards.
   */
  async createStaffInvitation(
    userId: string,
    shopId: string,
  ): Promise<{ token: string; expiresAt: Date; shopName: string }> {
    const shop = await this.getOwned(userId, shopId);
    const invite = this.invitations.create({
      shopId: shop.id,
      invitedByUserId: userId,
      customRoleName: 'Xodim',
      preset: 'custom',
      permissions: [],
      qrToken: randomBytes(24).toString('base64url'),
      status: StaffInvitationStatus.Pending,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
    const saved = await this.invitations.save(invite);
    return { token: saved.qrToken, expiresAt: saved.expiresAt, shopName: shop.name };
  }

  /** Scanned by a user — joins them to the shop as staff (idempotent). */
  async acceptStaffInvitation(
    userId: string,
    token: string,
  ): Promise<{ shopId: string; shopName: string }> {
    // Whole accept flow runs in one transaction with the invite row locked, so
    // a single QR can't be redeemed twice concurrently.
    return this.dataSource.transaction(async (manager) => {
      const invite = await manager.findOne(StaffInvitation, {
        where: { qrToken: token },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invite) throw new NotFoundException('Taklif topilmadi');
      if (invite.status !== StaffInvitationStatus.Pending || invite.expiresAt.getTime() < Date.now()) {
        throw new BadRequestException('Taklif muddati tugagan yoki ishlatilgan');
      }
      const shop = await manager.findOne(Shop, { where: { id: invite.shopId } });
      if (!shop) throw new NotFoundException('Do\'kon topilmadi');
      if (shop.ownerId === userId) {
        throw new BadRequestException('Siz do\'kon egasisiz — o\'zingizni xodim qila olmaysiz');
      }

      // Business rule: a staff member works for a single owner only.
      const existingMemberships = await manager.find(ShopStaff, {
        where: { userId, isActive: true },
        relations: { shop: true },
      });
      const conflicting = existingMemberships.find(
        (s) => s.shopId !== invite.shopId && s.shop && s.shop.ownerId !== shop.ownerId,
      );
      if (conflicting) {
        throw new BadRequestException('Siz allaqachon boshqa egaga tegishli do\'konda ishlaysiz');
      }

      let staff = await manager.findOne(ShopStaff, { where: { shopId: invite.shopId, userId } });
      if (staff) {
        staff.isActive = true;
        await manager.save(staff);
      } else {
        staff = await manager.save(
          manager.create(ShopStaff, {
            shopId: invite.shopId,
            userId,
            customRoleName: invite.customRoleName,
            preset: invite.preset,
            permissions: invite.permissions,
            isActive: true,
          }),
        );
      }

      invite.status = StaffInvitationStatus.Accepted;
      invite.acceptedByUserId = userId;
      invite.acceptedAt = new Date();
      await manager.save(invite);

      return { shopId: shop.id, shopName: shop.name };
    });
  }

  async listStaff(userId: string, shopId: string): Promise<StaffView[]> {
    await this.getOwned(userId, shopId);
    const rows = await this.staff.find({
      where: { shopId },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });
    return rows.map((s) => ({
      id: s.id,
      userId: s.userId,
      name: s.user?.name ?? null,
      phone: s.user?.phone ?? '',
      customRoleName: s.customRoleName,
      preset: s.preset,
      permissions: s.permissions ?? [],
      isActive: s.isActive,
    }));
  }

  async updateStaff(
    userId: string,
    shopId: string,
    staffId: string,
    dto: {
      permissions?: StaffPermission[];
      preset?: StaffPreset;
      customRoleName?: string;
      isActive?: boolean;
    },
  ): Promise<StaffView> {
    await this.getOwned(userId, shopId);
    const staff = await this.staff.findOne({ where: { id: staffId, shopId }, relations: { user: true } });
    if (!staff) throw new NotFoundException('Xodim topilmadi');
    // Selecting a non-custom preset applies that preset's permission set;
    // toggling an individual permission switches the role to "custom".
    if (dto.preset !== undefined) {
      staff.preset = dto.preset;
      if (dto.preset !== 'custom') staff.permissions = [...PRESET_PERMISSIONS[dto.preset]];
    }
    if (dto.permissions !== undefined) {
      staff.permissions = dto.permissions;
      staff.preset = 'custom';
    }
    if (dto.customRoleName !== undefined) staff.customRoleName = dto.customRoleName;
    if (dto.isActive !== undefined) staff.isActive = dto.isActive;
    const saved = await this.staff.save(staff);
    return {
      id: saved.id,
      userId: saved.userId,
      name: staff.user?.name ?? null,
      phone: staff.user?.phone ?? '',
      customRoleName: saved.customRoleName,
      preset: saved.preset,
      permissions: saved.permissions ?? [],
      isActive: saved.isActive,
    };
  }

  async removeStaff(userId: string, shopId: string, staffId: string): Promise<void> {
    await this.getOwned(userId, shopId);
    const staff = await this.staff.findOne({ where: { id: staffId, shopId } });
    if (!staff) throw new NotFoundException('Xodim topilmadi');
    staff.isActive = false;
    staff.removedAt = new Date();
    await this.staff.save(staff);
  }

  async toggleOpen(userId: string, shopId: string, isOpen: boolean): Promise<Shop> {
    // Owner or staff with the shop.toggle_open permission.
    const shop = await assertShopPermission(this.shops, this.staff, userId, shopId, 'shop.toggle_open');
    shop.isOpenManual = isOpen;
    return this.shops.save(shop);
  }

  async blockUser(userId: string, shopId: string, targetUserId: string): Promise<Shop> {
    const shop = await this.getOwned(userId, shopId);
    if (!shop.blockedUserIds.includes(targetUserId)) {
      shop.blockedUserIds = [...shop.blockedUserIds, targetUserId];
    }
    return this.shops.save(shop);
  }

  async unblockUser(userId: string, shopId: string, targetUserId: string): Promise<Shop> {
    const shop = await this.getOwned(userId, shopId);
    shop.blockedUserIds = shop.blockedUserIds.filter((id) => id !== targetUserId);
    return this.shops.save(shop);
  }

  /** Users this shop has blocked, with their name + phone, for the settings list. */
  async listBlockedUsers(
    userId: string,
    shopId: string,
  ): Promise<{ id: string; name: string | null; phone: string }[]> {
    const shop = await this.getOwned(userId, shopId);
    if (shop.blockedUserIds.length === 0) return [];
    const users = await this.users.find({ where: { id: In(shop.blockedUserIds) } });
    return users.map((u) => ({ id: u.id, name: u.name, phone: u.phone }));
  }

  // Public: shops near user
  async findNearbyShops(
    latitude: number,
    longitude: number,
    limit = 50,
  ): Promise<Array<Shop & { distanceKm: number; deliveryFeeAtUser: number; isWithinZone: boolean }>> {
    // Pre-filter by a generous bounding box in SQL so we never load every shop.
    const box = boundingBox(latitude, longitude, MAX_DELIVERY_RADIUS_KM);
    const all = await this.shops.find({
      where: {
        isActive: true,
        latitude: Between(box.latMin, box.latMax),
        longitude: Between(box.lngMin, box.lngMax),
      },
    });
    const enriched = all
      .map((s) => {
        const distanceKm = haversineKm(latitude, longitude, s.latitude, s.longitude);
        const isWithinZone = distanceKm <= s.deliveryZone.maxKm;
        const deliveryFeeAtUser = isWithinZone
          ? calcDeliveryFee({
              distanceKm,
              freeKm: s.deliveryZone.freeKm,
              pricingType: s.deliveryZone.pricingType,
              pricePerStep: s.deliveryZone.pricePerStep,
            })
          : 0;
        // Override the open flag with the schedule-aware state so the map dims
        // shops that are closed by working hours / holidays too.
        return Object.assign({}, s, {
          distanceKm,
          deliveryFeeAtUser,
          isWithinZone,
          isOpenManual: isShopOpenNow(s),
        });
      })
      .filter((s) => s.isWithinZone)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);
    return enriched;
  }

  async getPublicShop(
    shopId: string,
    latitude?: number,
    longitude?: number,
  ): Promise<Shop & { distanceKm?: number; deliveryFeeAtUser?: number; isWithinZone?: boolean }> {
    const shop = await this.findOne(shopId);
    if (!shop) throw new NotFoundException('Do\'kon topilmadi');
    if (latitude !== undefined && longitude !== undefined) {
      const distanceKm = haversineKm(latitude, longitude, shop.latitude, shop.longitude);
      const isWithinZone = distanceKm <= shop.deliveryZone.maxKm;
      const deliveryFeeAtUser = isWithinZone
        ? calcDeliveryFee({
            distanceKm,
            freeKm: shop.deliveryZone.freeKm,
            pricingType: shop.deliveryZone.pricingType,
            pricePerStep: shop.deliveryZone.pricePerStep,
          })
        : 0;
      return Object.assign({}, shop, {
        distanceKm,
        isWithinZone,
        deliveryFeeAtUser,
        isOpenManual: isShopOpenNow(shop),
      });
    }
    return Object.assign({}, shop, { isOpenManual: isShopOpenNow(shop) });
  }

  async updateDeliveryZones(
    userId: string,
    shopId: string,
    dto: { deliveryPolygon?: GeoJsonPolygon | null; freeDeliveryPolygon?: GeoJsonPolygon | null },
  ): Promise<Shop> {
    const shop = await this.getOwned(userId, shopId);

    if (dto.freeDeliveryPolygon && dto.deliveryPolygon) {
      const ring = dto.freeDeliveryPolygon.coordinates[0];
      const allInside = ring.every(([lng, lat]) =>
        pointInPolygon(lat, lng, dto.deliveryPolygon!),
      );
      if (!allInside) {
        throw new BadRequestException(
          'Tekin yetkazib berish hududi yetkazib berish hududi ichida bo\'lishi kerak',
        );
      }
    }

    await this.shops.update(shopId, {
      ...(dto.deliveryPolygon !== undefined && { deliveryPolygon: dto.deliveryPolygon }),
      ...(dto.freeDeliveryPolygon !== undefined && { freeDeliveryPolygon: dto.freeDeliveryPolygon }),
    });
    return this.shops.findOneOrFail({ where: { id: shopId } });
  }

  // ---- Admin ---------------------------------------------------------------

  async adminListShops(opts: { search?: string; limit?: number; offset?: number }) {
    const qb = this.shops
      .createQueryBuilder('s')
      .leftJoin('s.owner', 'owner')
      .select([
        's.id',
        's.name',
        's.address',
        's.isActive',
        's.isOpenManual',
        's.ratingAverage',
        's.ratingCount',
        's.latitude',
        's.longitude',
        's.createdAt',
        'owner.id',
        'owner.name',
        'owner.phone',
      ])
      .orderBy('s.createdAt', 'DESC')
      .take(Math.min(opts.limit ?? 50, 100))
      .skip(Math.max(opts.offset ?? 0, 0));
    const s = opts.search?.trim();
    if (s) qb.where('s.name ILIKE :q OR s.address ILIKE :q', { q: `%${s}%` });
    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  async adminSetActive(shopId: string, isActive: boolean): Promise<Shop> {
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Do\'kon topilmadi');
    shop.isActive = isActive;
    return this.shops.save(shop);
  }

  // ─── Do'kon profil to'liqligi ─────────────────────────────────────────────

  async getCompleteness(userId: string, shopId: string) {
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Do\'kon topilmadi');

    const totalVariants = await this.variants.count({ where: { shopId, isActive: true } });
    const withPhoto = await (async () => {
      const rows = await this.variants.find({
        where: { shopId, isActive: true },
        select: { globalProductId: true },
      });
      if (!rows.length) return 0;
      const gpIds = [...new Set(rows.map((v) => v.globalProductId))];
      const gps = await this.globalProducts.find({
        where: { id: In(gpIds) },
        select: { id: true, photos: true },
      });
      const gpPhotoMap = new Map(gps.map((gp) => [gp.id, (gp.photos?.length ?? 0) > 0]));
      return rows.filter((v) => gpPhotoMap.get(v.globalProductId)).length;
    })();

    const checks = [
      { key: 'photo_1', label: 'Do\'kon rasmi bor (≥1)', done: (shop.photos?.length ?? 0) >= 1, points: 10 },
      { key: 'photo_3', label: 'Do\'kon rasmi bor (≥3)', done: (shop.photos?.length ?? 0) >= 3, points: 5 },
      { key: 'description', label: 'Do\'kon tavsifi yozilgan', done: !!shop.description?.trim(), points: 10 },
      { key: 'working_hours', label: 'Ish vaqti to\'liq (7 kun)', done: (shop.workingHours?.length ?? 0) >= 7, points: 15 },
      { key: 'delivery_zone', label: 'Yetkazib berish zonasi', done: !!shop.deliveryZone?.maxKm, points: 15 },
      { key: 'products_10', label: '10+ mahsulot', done: totalVariants >= 10, points: 10 },
      { key: 'products_50', label: '50+ mahsulot', done: totalVariants >= 50, points: 10 },
      { key: 'products_100', label: '100+ mahsulot', done: totalVariants >= 100, points: 5 },
      { key: 'product_photos', label: 'Mahsulotlarning ≥80% da rasm bor', done: totalVariants > 0 && withPhoto / totalVariants >= 0.8, points: 10 },
      { key: 'gps', label: 'GPS manzil belgilangan', done: !!shop.latitude && !!shop.longitude, points: 10 },
    ];

    const score = checks.reduce((sum, c) => sum + (c.done ? c.points : 0), 0);
    const missing = checks.filter((c) => !c.done).map((c) => ({ key: c.key, label: c.label, points: c.points }));

    return { score, maxScore: 100, checks, missing };
  }
}
