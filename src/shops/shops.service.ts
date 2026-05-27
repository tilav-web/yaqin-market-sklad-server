import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { calcDeliveryFee, haversineKm } from '../geo/geo.util';
import { Shop } from './entities/shop.entity';
import { ShopStaff } from './entities/shop-staff.entity';
import { UpdateShopDto } from './dto/shop.dto';

@Injectable()
export class ShopsService {
  constructor(
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(ShopStaff)
    private readonly staff: Repository<ShopStaff>,
  ) {}

  findOne(id: string): Promise<Shop | null> {
    return this.shops.findOne({ where: { id } });
  }

  listMyShops(userId: string): Promise<Shop[]> {
    return this.shops.find({ where: { ownerId: userId }, order: { createdAt: 'ASC' } });
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

  async toggleOpen(userId: string, shopId: string, isOpen: boolean): Promise<Shop> {
    const shop = await this.getOwned(userId, shopId);
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

  // Public: shops near user
  async findNearbyShops(
    latitude: number,
    longitude: number,
    limit = 50,
  ): Promise<Array<Shop & { distanceKm: number; deliveryFeeAtUser: number; isWithinZone: boolean }>> {
    const all = await this.shops.find({ where: { isActive: true } });
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
        return Object.assign({}, s, { distanceKm, deliveryFeeAtUser, isWithinZone });
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
      return Object.assign({}, shop, { distanceKm, isWithinZone, deliveryFeeAtUser });
    }
    return shop;
  }
}
