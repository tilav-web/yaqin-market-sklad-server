import { randomBytes } from 'crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, In, Repository } from 'typeorm';

import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/entities/admin-audit-log.entity';
import { buildXlsxBuffer } from '../common/xlsx.util';
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
import { ShopStaffPreset } from './entities/shop-staff-preset.entity';
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
    @InjectRepository(ShopStaffPreset)
    private readonly staffPresets: Repository<ShopStaffPreset>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
    @InjectRepository(GlobalProduct)
    private readonly globalProducts: Repository<GlobalProduct>,
    private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
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

  async listShopsWhereStaff(
    userId: string,
  ): Promise<{ shop: Shop; role: string; preset: StaffPreset; permissions: StaffPermission[] }[]> {
    const staffRecords = await this.staff.find({
      where: { userId, isActive: true },
      relations: { shop: true },
    });
    return staffRecords.map((s) => ({
      shop: s.shop,
      role: s.customRoleName,
      preset: s.preset,
      permissions: s.permissions ?? [],
    }));
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
   * Resolves a {preset | customPresetId | permissions} selection (shared by
   * createStaffInvitation and updateStaff) into a concrete permission set.
   * Precedence when more than one is given: customPresetId > preset >
   * permissions — matches the "explicit permissions always win, preset is
   * just a bulk-fill convenience" behaviour already used by updateStaff.
   */
  private async resolveGrant(
    shopId: string,
    input: { preset?: StaffPreset; customPresetId?: string; permissions?: StaffPermission[] },
  ): Promise<{ preset: StaffPreset; permissions: StaffPermission[]; presetName?: string } | null> {
    if (input.customPresetId) {
      const custom = await this.staffPresets.findOne({ where: { id: input.customPresetId, shopId } });
      if (!custom) throw new BadRequestException('Shablon topilmadi');
      return { preset: 'custom', permissions: [...custom.permissions], presetName: custom.name };
    }
    if (input.preset && input.preset !== 'custom') {
      if (!PRESET_PERMISSIONS[input.preset]) throw new BadRequestException(`Noto'g'ri rol: ${input.preset}`);
      return { preset: input.preset, permissions: [...PRESET_PERMISSIONS[input.preset]] };
    }
    if (input.permissions) {
      return { preset: 'custom', permissions: input.permissions };
    }
    return null;
  }

  /**
   * Owner generates a short-lived QR invite. A preset (system or the
   * owner's own saved custom one) or an explicit permission list can be
   * granted right away — if none is given, whoever accepts joins with NO
   * permissions and the owner grants them afterwards via updateStaff.
   */
  async createStaffInvitation(
    userId: string,
    shopId: string,
    dto: { preset?: StaffPreset; customPresetId?: string; permissions?: StaffPermission[]; customRoleName?: string } = {},
  ): Promise<{ token: string; expiresAt: Date; shopName: string }> {
    const shop = await this.getOwned(userId, shopId);
    const grant = await this.resolveGrant(shopId, dto);
    const invite = this.invitations.create({
      shopId: shop.id,
      invitedByUserId: userId,
      customRoleName: dto.customRoleName ?? grant?.presetName ?? 'Xodim',
      preset: grant?.preset ?? 'custom',
      permissions: grant?.permissions ?? [],
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

      // Lock the USER row (not the invite — two different invitations from
      // two different owners are two different rows) so two concurrent
      // accept-invitation calls for the same user can't both pass the
      // cross-owner conflict check below; the second one blocks here until
      // the first transaction commits its ShopStaff insert, then re-reads
      // fresh membership data. No dedicated DB constraint is practical for
      // "one staff, one owner" since it spans shops via Shop.ownerId — this
      // lock is the race-proofing instead (see also shop-staff.entity.ts).
      await manager.findOne(User, { where: { id: userId }, lock: { mode: 'pessimistic_write' } });

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
      customPresetId?: string;
      customRoleName?: string;
      isActive?: boolean;
    },
  ): Promise<StaffView> {
    await this.getOwned(userId, shopId);
    const staff = await this.staff.findOne({ where: { id: staffId, shopId }, relations: { user: true } });
    if (!staff) throw new NotFoundException('Xodim topilmadi');
    // Selecting a preset (system or the owner's own saved custom one)
    // bulk-applies its permission set; explicitly passing `permissions`
    // always wins and switches the role label to "custom".
    if (dto.customPresetId !== undefined) {
      const custom = await this.staffPresets.findOne({ where: { id: dto.customPresetId, shopId } });
      if (!custom) throw new BadRequestException('Shablon topilmadi');
      staff.preset = 'custom';
      staff.permissions = [...custom.permissions];
      if (dto.customRoleName === undefined) staff.customRoleName = custom.name;
    } else if (dto.preset !== undefined) {
      // Defensive: the DTO already validates `preset` against known values,
      // but never let an unrecognised one reach the PRESET_PERMISSIONS
      // lookup (which would throw an uncaught TypeError / 500).
      if (dto.preset !== 'custom' && !PRESET_PERMISSIONS[dto.preset]) {
        throw new BadRequestException(`Noto'g'ri rol: ${String(dto.preset)}`);
      }
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

  // ---- Staff presets (seller-defined, reusable permission bundles) -------

  async listStaffPresets(userId: string, shopId: string): Promise<ShopStaffPreset[]> {
    await this.getOwned(userId, shopId);
    return this.staffPresets.find({ where: { shopId }, order: { name: 'ASC' } });
  }

  async createStaffPreset(
    userId: string,
    shopId: string,
    dto: { name: string; permissions: StaffPermission[] },
  ): Promise<ShopStaffPreset> {
    await this.getOwned(userId, shopId);
    try {
      return await this.staffPresets.save(
        this.staffPresets.create({ shopId, name: dto.name.trim(), permissions: dto.permissions }),
      );
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException('Shu nomli shablon allaqachon mavjud');
      throw e;
    }
  }

  async updateStaffPreset(
    userId: string,
    shopId: string,
    presetId: string,
    dto: { name?: string; permissions?: StaffPermission[] },
  ): Promise<ShopStaffPreset> {
    await this.getOwned(userId, shopId);
    const preset = await this.staffPresets.findOne({ where: { id: presetId, shopId } });
    if (!preset) throw new NotFoundException('Shablon topilmadi');
    if (dto.name !== undefined) preset.name = dto.name.trim();
    if (dto.permissions !== undefined) preset.permissions = dto.permissions;
    try {
      return await this.staffPresets.save(preset);
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException('Shu nomli shablon allaqachon mavjud');
      throw e;
    }
  }

  /** Deleting a preset never affects staff already granted from it — permissions were copied, not linked. */
  async deleteStaffPreset(userId: string, shopId: string, presetId: string): Promise<void> {
    await this.getOwned(userId, shopId);
    await this.staffPresets.delete({ id: presetId, shopId });
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

  /**
   * Cheap proxy for Shop.getCompleteness() usable on the hot search path with
   * zero extra queries — computed only from fields already loaded on the Shop
   * row. Deliberately omits the product-count/photo-coverage criteria (10/50/
   * 100+ products, ≥80% with photos), since those require joining
   * ProductVariant/GlobalProduct per shop, which is exactly the cost this
   * proxy exists to avoid. See findNearbyShops for how it's used, and the
   * task report for the caching follow-up this stands in for.
   */
  private static cheapCompletenessProxy(
    shop: Pick<Shop, 'photos' | 'description' | 'workingHours' | 'deliveryZone' | 'latitude' | 'longitude'>,
  ): number {
    let score = 0;
    if ((shop.photos?.length ?? 0) >= 1) score += 10;
    if ((shop.photos?.length ?? 0) >= 3) score += 5;
    if (shop.description?.trim()) score += 10;
    if ((shop.workingHours?.length ?? 0) >= 7) score += 15;
    if (shop.deliveryZone?.maxKm) score += 15;
    if (shop.latitude && shop.longitude) score += 10;
    return score; // out of 65 (see comment above for the omitted 35)
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
      .sort((a, b) => {
        // SPEC.md §31.4: among shops at (roughly) the same distance and
        // rating, the more "complete" profile ranks higher. Distance is
        // bucketed to 100m so nearly-identical distances count as tied
        // rather than never matching on raw floating-point km.
        const bucket = (km: number) => Math.round(km * 10);
        const distDiff = bucket(a.distanceKm) - bucket(b.distanceKm);
        if (distDiff !== 0) return distDiff;
        const ratingDiff = b.ratingAverage - a.ratingAverage;
        if (ratingDiff !== 0) return ratingDiff;
        const completenessDiff = ShopsService.cheapCompletenessProxy(b) - ShopsService.cheapCompletenessProxy(a);
        if (completenessDiff !== 0) return completenessDiff;
        return a.distanceKm - b.distanceKm; // final stable tiebreak
      })
      .slice(0, limit);
    return enriched;
  }

  async getPublicShop(
    shopId: string,
    latitude?: number,
    longitude?: number,
  ): Promise<Shop & { distanceKm?: number; deliveryFeeAtUser?: number; isWithinZone?: boolean }> {
    // Mirror findNearbyShops/order-creation: an admin-deactivated shop must
    // not be reachable via direct link either.
    const shop = await this.shops.findOne({ where: { id: shopId, isActive: true } });
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

  private adminShopsFilterQuery(opts: { search?: string }) {
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
      .orderBy('s.createdAt', 'DESC');
    const s = opts.search?.trim();
    if (s) qb.where('s.name ILIKE :q OR s.address ILIKE :q', { q: `%${s}%` });
    return qb;
  }

  async adminListShops(opts: { search?: string; limit?: number; offset?: number }) {
    const qb = this.adminShopsFilterQuery(opts)
      .take(Math.min(opts.limit ?? 50, 100))
      .skip(Math.max(opts.offset ?? 0, 0));
    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  async adminExportShops(opts: { search?: string }): Promise<Buffer> {
    const rows = await this.adminShopsFilterQuery(opts).take(5000).getMany();
    return buildXlsxBuffer(
      "Do'konlar",
      [
        { header: 'Nomi', key: 'name', width: 26 },
        { header: 'Manzil', key: 'address', width: 32 },
        { header: 'Egasi', key: 'ownerName', width: 20 },
        { header: 'Egasi telefoni', key: 'ownerPhone', width: 16 },
        { header: 'Holat', key: 'isActive', width: 12 },
        { header: 'Ochiq/yopiq', key: 'isOpenManual', width: 12 },
        { header: 'Reyting', key: 'rating', width: 12 },
        { header: "Ro'yxatdan o'tgan", key: 'createdAt', width: 20 },
      ],
      rows.map((s) => ({
        name: s.name,
        address: s.address,
        ownerName: s.owner?.name ?? '',
        ownerPhone: s.owner?.phone ?? '',
        isActive: s.isActive ? 'ha' : "yo'q",
        isOpenManual: s.isOpenManual ? 'ochiq' : 'yopiq',
        rating: `${s.ratingAverage.toFixed(1)} (${s.ratingCount})`,
        createdAt: s.createdAt.toISOString(),
      })),
    );
  }

  async adminSetActive(
    shopId: string,
    isActive: boolean,
    adminUserId: string,
    reason?: string,
  ): Promise<Shop> {
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Do\'kon topilmadi');
    shop.isActive = isActive;
    const saved = await this.shops.save(shop);
    void this.auditLog.record({
      adminUserId,
      action: isActive ? AuditAction.ShopActivated : AuditAction.ShopDeactivated,
      targetType: 'shop',
      targetId: shopId,
      reason,
    });
    return saved;
  }

  // ─── Do'kon profil to'liqligi ─────────────────────────────────────────────

  async getCompleteness(userId: string, shopId: string) {
    // Owner always sees it; staff need the same "view shop settings"
    // permission that gates the rest of the shop-settings surface.
    const shop = await assertShopPermission(this.shops, this.staff, userId, shopId, 'shop.settings.view');

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

    return { score, maxScore: 100, items: checks };
  }
}
