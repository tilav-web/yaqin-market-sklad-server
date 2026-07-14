import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Role } from '../auth/role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/entities/admin-audit-log.entity';
import { Order } from '../orders/entities/order.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { UserAddress } from './entities/user-address.entity';
import { User, UserStatus } from './entities/user.entity';

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

  async updateProfile(userId: string, dto: { name?: string; avatarUrl?: string }): Promise<User> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('Foydalanuvchi topilmadi');
    if (dto.name !== undefined) user.name = dto.name;
    if (dto.avatarUrl !== undefined) user.avatarUrl = dto.avatarUrl;
    return this.users.save(user);
  }

  // Addresses
  listAddresses(userId: string): Promise<UserAddress[]> {
    return this.addresses.find({ where: { userId }, order: { isDefault: 'DESC', createdAt: 'ASC' } });
  }

  async createAddress(
    userId: string,
    dto: {
      label: string;
      address: string;
      latitude: number;
      longitude: number;
      notes?: string;
      isDefault?: boolean;
    },
  ): Promise<UserAddress> {
    if (dto.isDefault) {
      await this.addresses.update({ userId }, { isDefault: false });
    }
    const existing = await this.addresses.count({ where: { userId } });
    const address = this.addresses.create({
      userId,
      label: dto.label,
      address: dto.address,
      latitude: dto.latitude,
      longitude: dto.longitude,
      notes: dto.notes ?? null,
      isDefault: dto.isDefault ?? existing === 0,
    });
    return this.addresses.save(address);
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
      isDefault: boolean;
    }>,
  ): Promise<UserAddress> {
    const address = await this.addresses.findOne({ where: { id: addressId, userId } });
    if (!address) throw new NotFoundException('Manzil topilmadi');
    if (dto.isDefault) {
      await this.addresses.update({ userId }, { isDefault: false });
    }
    Object.assign(address, dto);
    return this.addresses.save(address);
  }

  async deleteAddress(userId: string, addressId: string): Promise<void> {
    const result = await this.addresses.delete({ id: addressId, userId });
    if (!result.affected) throw new NotFoundException('Manzil topilmadi');
  }

  // ---- Admin ---------------------------------------------------------------

  async adminListUsers(opts: { search?: string; limit?: number; offset?: number; sellerOnly?: boolean; customerOnly?: boolean; adminOnly?: boolean }) {
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
      .orderBy('u.createdAt', 'DESC')
      .take(Math.min(opts.limit ?? 50, 100))
      .skip(Math.max(opts.offset ?? 0, 0));
    const s = opts.search?.trim();
    if (s) qb.where('(u.phone ILIKE :q OR u.name ILIKE :q)', { q: `%${s}%` });
    if (opts.sellerOnly) qb.andWhere('u.isSellerApproved = true');
    if (opts.customerOnly) qb.andWhere('u.isSellerApproved = false AND u.isAdmin = false');
    if (opts.adminOnly) qb.andWhere('u.isAdmin = true');
    const [items, total] = await qb.getManyAndCount();
    return { items, total };
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

  async getFavorites(userId: string): Promise<{ shopIds: string[]; productIds: string[] }> {
    const user = await this.users.findOne({ where: { id: userId } });
    return {
      shopIds: user?.favoriteShopIds ?? [],
      productIds: user?.favoriteProductIds ?? [],
    };
  }

  async toggleFavoriteShop(userId: string, shopId: string, add: boolean): Promise<{ shopIds: string[] }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    const ids = new Set(user.favoriteShopIds ?? []);
    add ? ids.add(shopId) : ids.delete(shopId);
    user.favoriteShopIds = [...ids];
    await this.users.save(user);
    return { shopIds: user.favoriteShopIds };
  }

  async toggleFavoriteProduct(userId: string, productId: string, add: boolean): Promise<{ productIds: string[] }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    const ids = new Set(user.favoriteProductIds ?? []);
    add ? ids.add(productId) : ids.delete(productId);
    user.favoriteProductIds = [...ids];
    await this.users.save(user);
    return { productIds: user.favoriteProductIds };
  }
}
