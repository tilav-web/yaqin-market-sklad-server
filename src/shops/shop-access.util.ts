import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { Shop } from './entities/shop.entity';
import { ShopStaff, StaffPermission } from './entities/shop-staff.entity';

/**
 * Authorize a shop-side action: the owner always passes; otherwise the actor
 * must be active staff of that shop holding `permission`. Shared by the
 * products, orders and shops services so every seller operation is gated the
 * same way. Returns the shop for convenience.
 */
export async function assertShopPermission(
  shops: Repository<Shop>,
  staff: Repository<ShopStaff>,
  userId: string,
  shopId: string,
  permission: StaffPermission,
): Promise<Shop> {
  const shop = await shops.findOne({ where: { id: shopId } });
  if (!shop) throw new NotFoundException("Do'kon topilmadi");
  if (shop.ownerId === userId) return shop;
  const member = await staff.findOne({
    where: { shopId, userId, isActive: true },
  });
  if (member?.permissions?.includes(permission)) return shop;
  throw new ForbiddenException("Bu amal uchun ruxsatingiz yo'q");
}

/** True if the user is the owner or any active staff member of the shop. */
export async function isShopMember(
  shops: Repository<Shop>,
  staff: Repository<ShopStaff>,
  userId: string,
  shopId: string,
): Promise<boolean> {
  const shop = await shops.findOne({
    where: { id: shopId },
    select: { id: true, ownerId: true },
  });
  if (!shop) return false;
  if (shop.ownerId === userId) return true;
  const member = await staff.findOne({
    where: { shopId, userId, isActive: true },
  });
  return !!member;
}
