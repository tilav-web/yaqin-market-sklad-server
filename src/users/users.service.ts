import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Role } from '../auth/role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/entities/admin-audit-log.entity';
import { buildXlsxBuffer } from '../common/xlsx.util';
import { LocationEvidenceDto, buildEvidence } from '../geo/location-evidence';
import { Order } from '../orders/entities/order.entity';
import { RiskService } from '../risk/risk.service';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { UserAddress } from './entities/user-address.entity';
import { User, UserGender, UserStatus } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(UserAddress)
    private readonly addresses: Repository<UserAddress>,
    @InjectRepository(ShopStaff)
    private readonly shopStaff: Repository<ShopStaff>,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    private readonly auditLog: AuditLogService,
    private readonly risk: RiskService,
  ) {}

  /**
   * Computes effective roles for a user from their flags + shop_staff membership.
   * Persists the result on the user row so guards can read it directly when
   * skipping a lookup is acceptable (e.g. JWT-decoded role list).
   */
  async computeRoles(user: User): Promise<Role[]> {
    const roles: Role[] = [Role.Customer];
    if (user.isSellerApproved) roles.push(Role.Seller);
    if (user.isAdmin) roles.push(Role.Admin);
    const staffCount = await this.shopStaff.count({
      where: { userId: user.id, isActive: true },
    });
    if (staffCount > 0) roles.push(Role.Staff);

    if (
      user.roles.length !== roles.length ||
      roles.some((r) => !user.roles.includes(r))
    ) {
      user.roles = roles;
      await this.users.save(user);
    }
    return roles;
  }

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  findByPhone(phone: string): Promise<User | null> {
    return this.users.findOne({ where: { phone } });
  }

  async upsertByPhone(phone: string): Promise<User> {
    let user = await this.findByPhone(phone);
    if (user) {
      user.lastLoginAt = new Date();
      return this.users.save(user);
    }
    user = this.users.create({ phone, lastLoginAt: new Date() });
    return this.users.save(user);
  }

  async updateProfile(
    userId: string,
    dto: {
      name?: string;
      firstName?: string;
      lastName?: string;
      birthDate?: string;
      gender?: UserGender;
      email?: string;
      avatarUrl?: string;
    },
  ): Promise<User> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('Foydalanuvchi topilmadi');
    if (dto.firstName !== undefined) user.firstName = dto.firstName;
    if (dto.lastName !== undefined) user.lastName = dto.lastName;
    if (dto.birthDate !== undefined) user.birthDate = dto.birthDate;
    if (dto.gender !== undefined) user.gender = dto.gender;
    if (dto.email !== undefined) user.email = dto.email;
    if (dto.avatarUrl !== undefined) user.avatarUrl = dto.avatarUrl;
    // `name` stays a derived display cache — many existing call sites (chat,
    // orders, avatar-initial fallback) only ever read this single field, so
    // recompute it from firstName/lastName instead of also threading the
    // split fields through every one of them.
    if (dto.firstName !== undefined || dto.lastName !== undefined) {
      user.name =
        [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
        null;
    } else if (dto.name !== undefined) {
      user.name = dto.name;
    }
    return this.users.save(user);
  }

  // Addresses
  listAddresses(userId: string): Promise<UserAddress[]> {
    return this.addresses.find({
      where: { userId },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
  }

  async createAddress(
    userId: string,
    dto: {
      label: string;
      address: string;
      latitude: number;
      longitude: number;
      notes?: string;
      entrance?: string;
      floor?: string;
      apartment?: string;
      intercom?: string;
      isDefault?: boolean;
      evidence?: LocationEvidenceDto;
    },
    deviceId?: string | null,
  ): Promise<UserAddress> {
    if (dto.isDefault) {
      await this.addresses.update({ userId }, { isDefault: false });
    }
    const existing = await this.addresses.count({ where: { userId } });
    const pinEvidence = buildEvidence(dto.evidence, {
      deviceId: deviceId ?? null,
      actorUserId: userId,
      actorRole: 'customer',
    });
    const address = this.addresses.create({
      userId,
      label: dto.label,
      address: dto.address,
      latitude: dto.latitude,
      longitude: dto.longitude,
      notes: dto.notes ?? null,
      entrance: dto.entrance ?? null,
      floor: dto.floor ?? null,
      apartment: dto.apartment ?? null,
      intercom: dto.intercom ?? null,
      isDefault: dto.isDefault ?? existing === 0,
      pinEvidence,
      pinSetCount: 1,
    });
    const saved = await this.addresses.save(address);
    void this.risk.onAddressPinned({
      userId,
      addressId: saved.id,
      pin: { latitude: saved.latitude, longitude: saved.longitude },
      evidence: pinEvidence,
    });
    return saved;
  }

  async updateAddress(
    userId: string,
    addressId: string,
    dto: Partial<{
      label: string;
      address: string;
      latitude: number;
      longitude: number;
      notes: string;
      entrance: string;
      floor: string;
      apartment: string;
      intercom: string;
      isDefault: boolean;
      evidence: LocationEvidenceDto;
    }>,
    deviceId?: string | null,
  ): Promise<UserAddress> {
    const address = await this.addresses.findOne({
      where: { id: addressId, userId },
    });
    if (!address) throw new NotFoundException('Manzil topilmadi');
    if (dto.isDefault) {
      await this.addresses.update({ userId }, { isDefault: false });
    }
    const coordsChanged =
      (dto.latitude != null && dto.latitude !== address.latitude) ||
      (dto.longitude != null && dto.longitude !== address.longitude);
    const { evidence: evidenceDto, ...rest } = dto;
    Object.assign(address, rest);
    let pinEvidence = address.pinEvidence;
    if (coordsChanged) {
      pinEvidence = buildEvidence(evidenceDto, {
        deviceId: deviceId ?? null,
        actorUserId: userId,
        actorRole: 'customer',
      });
      address.pinEvidence = pinEvidence;
      address.pinSetCount += 1;
    }
    const saved = await this.addresses.save(address);
    if (coordsChanged) {
      void this.risk.onAddressPinned({
        userId,
        addressId: saved.id,
        pin: { latitude: saved.latitude, longitude: saved.longitude },
        evidence: pinEvidence,
      });
    }
    return saved;
  }

  async deleteAddress(userId: string, addressId: string): Promise<void> {
    // Orders keep their own jsonb snapshot of the address (no FK) — deleting a
    // saved address never touches order history.
    const result = await this.addresses.delete({ id: addressId, userId });
    if (!result.affected) throw new NotFoundException('Manzil topilmadi');
  }

  // ---- Admin ---------------------------------------------------------------

  private adminUsersFilterQuery(opts: {
    search?: string;
    sellerOnly?: boolean;
    customerOnly?: boolean;
    adminOnly?: boolean;
  }) {
    const qb = this.users
      .createQueryBuilder('u')
      .select([
        'u.id',
        'u.phone',
        'u.name',
        'u.status',
        'u.isSellerApproved',
        'u.isAdmin',
        'u.roles',
        'u.createdAt',
      ])
      .orderBy('u.createdAt', 'DESC');
    const s = opts.search?.trim();
    if (s) qb.where('(u.phone ILIKE :q OR u.name ILIKE :q)', { q: `%${s}%` });
    if (opts.sellerOnly) qb.andWhere('u.isSellerApproved = true');
    if (opts.customerOnly)
      qb.andWhere('u.isSellerApproved = false AND u.isAdmin = false');
    if (opts.adminOnly) qb.andWhere('u.isAdmin = true');
    return qb;
  }

  async adminListUsers(opts: {
    search?: string;
    limit?: number;
    offset?: number;
    sellerOnly?: boolean;
    customerOnly?: boolean;
    adminOnly?: boolean;
  }) {
    const qb = this.adminUsersFilterQuery(opts)
      .take(Math.min(opts.limit ?? 50, 100))
      .skip(Math.max(opts.offset ?? 0, 0));
    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  private static readonly EXPORT_ROW_CAP = 5000;

  async adminExportUsers(opts: {
    search?: string;
    sellerOnly?: boolean;
    customerOnly?: boolean;
    adminOnly?: boolean;
  }): Promise<Buffer> {
    const rows = await this.adminUsersFilterQuery(opts)
      .take(UsersService.EXPORT_ROW_CAP)
      .getMany();
    return buildXlsxBuffer(
      'Foydalanuvchilar',
      [
        { header: 'Telefon', key: 'phone', width: 16 },
        { header: 'Ismi', key: 'name', width: 22 },
        { header: 'Holat', key: 'status', width: 14 },
        { header: 'Sotuvchi', key: 'isSellerApproved', width: 12 },
        { header: 'Admin', key: 'isAdmin', width: 10 },
        { header: "Ro'yxatdan o'tgan", key: 'createdAt', width: 20 },
      ],
      rows.map((u) => ({
        phone: u.phone,
        name: u.name ?? '',
        status: u.status,
        isSellerApproved: u.isSellerApproved ? 'ha' : "yo'q",
        isAdmin: u.isAdmin ? 'ha' : "yo'q",
        createdAt: u.createdAt.toISOString(),
      })),
    );
  }

  async adminSetStatus(
    userId: string,
    blocked: boolean,
    adminUserId: string,
    reason?: string,
  ): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Foydalanuvchi topilmadi');
    user.status = blocked ? UserStatus.Blocked : UserStatus.Active;
    const saved = await this.users.save(user);
    void this.auditLog.record({
      adminUserId,
      action: blocked ? AuditAction.UserBlocked : AuditAction.UserUnblocked,
      targetType: 'user',
      targetId: userId,
      reason,
    });
    return saved;
  }

  async adminSetAdmin(
    userId: string,
    isAdmin: boolean,
    adminUserId: string,
    reason: string,
  ): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Foydalanuvchi topilmadi');
    user.isAdmin = isAdmin;
    await this.computeRoles(user); // re-derive + persist roles
    const saved = await this.users.save(user);
    void this.auditLog.record({
      adminUserId,
      action: isAdmin ? AuditAction.UserPromoted : AuditAction.UserDemoted,
      targetType: 'user',
      targetId: userId,
      reason,
    });
    return saved;
  }

  /** Admin: paginated order history for one user (5.3 "Buyurtma tarixini ko'rish"). */
  async adminListUserOrders(
    userId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<{ items: Order[]; total: number }> {
    const [items, total] = await this.orders.findAndCount({
      where: { userId },
      relations: { items: true, shop: true },
      order: { createdAt: 'DESC' },
      take: Math.min(opts.limit ?? 50, 100),
      skip: Math.max(opts.offset ?? 0, 0),
    });
    return { items, total };
  }

  /* ─── Favorites ─── */

  async getFavorites(
    userId: string,
  ): Promise<{ shopIds: string[]; productIds: string[] }> {
    const user = await this.users.findOne({ where: { id: userId } });
    return {
      shopIds: user?.favoriteShopIds ?? [],
      productIds: user?.favoriteProductIds ?? [],
    };
  }

  async toggleFavoriteShop(
    userId: string,
    shopId: string,
    add: boolean,
  ): Promise<{ shopIds: string[] }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    const ids = new Set(user.favoriteShopIds ?? []);
    if (add) {
      ids.add(shopId);
    } else {
      ids.delete(shopId);
    }
    user.favoriteShopIds = [...ids];
    await this.users.save(user);
    return { shopIds: user.favoriteShopIds };
  }

  async toggleFavoriteProduct(
    userId: string,
    productId: string,
    add: boolean,
  ): Promise<{ productIds: string[] }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    const ids = new Set(user.favoriteProductIds ?? []);
    if (add) {
      ids.add(productId);
    } else {
      ids.delete(productId);
    }
    user.favoriteProductIds = [...ids];
    await this.users.save(user);
    return { productIds: user.favoriteProductIds };
  }
}
