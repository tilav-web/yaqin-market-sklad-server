import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaymentsService } from '../payments/payments.service';
import { Shop } from '../shops/entities/shop.entity';
import { User } from '../users/entities/user.entity';
import { SellerApplication, SellerApplicationStatus } from './entities/seller-application.entity';
import { SellerProfile } from './entities/seller-profile.entity';

@Injectable()
export class SellersService {
  constructor(
    @InjectRepository(SellerApplication)
    private readonly apps: Repository<SellerApplication>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(SellerProfile)
    private readonly profiles: Repository<SellerProfile>,
    private readonly payments: PaymentsService,
  ) {}

  async submitApplication(
    userId: string,
    dto: {
      shopName: string;
      shopAddress: string;
      shopLatitude: number;
      shopLongitude: number;
      shopPhotos: string[];
      stir?: string;
    },
  ): Promise<SellerApplication> {
    const existingPending = await this.apps.findOne({
      where: { userId, status: SellerApplicationStatus.Pending },
    });
    if (existingPending) {
      throw new BadRequestException('Sizning oldingi arizangiz hali ko\'rib chiqilmagan');
    }
    const app = this.apps.create({
      userId,
      shopName: dto.shopName,
      shopAddress: dto.shopAddress,
      shopLatitude: dto.shopLatitude,
      shopLongitude: dto.shopLongitude,
      shopPhotos: dto.shopPhotos,
      stir: dto.stir ?? null,
      status: SellerApplicationStatus.Pending,
    });
    return this.apps.save(app);
  }

  listMyApplications(userId: string): Promise<SellerApplication[]> {
    return this.apps.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  listAllApplications(status?: SellerApplicationStatus): Promise<SellerApplication[]> {
    return this.apps.find({
      where: status ? { status } : {},
      relations: { user: true },
      order: { createdAt: 'DESC' },
    });
  }

  async getApplication(id: string): Promise<SellerApplication> {
    const app = await this.apps.findOne({ where: { id }, relations: { user: true } });
    if (!app) throw new NotFoundException('Ariza topilmadi');
    return app;
  }

  async approve(id: string, adminUserId: string): Promise<{ application: SellerApplication; shop: Shop }> {
    const app = await this.getApplication(id);
    if (app.status !== SellerApplicationStatus.Pending) {
      throw new BadRequestException('Ariza allaqachon ko\'rib chiqilgan');
    }
    app.status = SellerApplicationStatus.Approved;
    app.reviewedByUserId = adminUserId;
    app.reviewedAt = new Date();
    await this.apps.save(app);

    await this.users.update(app.userId, { isSellerApproved: true });

    const shop = this.shops.create({
      ownerId: app.userId,
      name: app.shopName,
      address: app.shopAddress,
      latitude: app.shopLatitude,
      longitude: app.shopLongitude,
      photos: app.shopPhotos,
    });
    const savedShop = await this.shops.save(shop);
    await this.payments.ensureBalance(app.userId);

    return { application: app, shop: savedShop };
  }

  async reject(id: string, adminUserId: string, reason: string): Promise<SellerApplication> {
    const app = await this.getApplication(id);
    if (app.status !== SellerApplicationStatus.Pending) {
      throw new BadRequestException('Ariza allaqachon ko\'rib chiqilgan');
    }
    app.status = SellerApplicationStatus.Rejected;
    app.rejectionReason = reason;
    app.reviewedByUserId = adminUserId;
    app.reviewedAt = new Date();
    return this.apps.save(app);
  }

  /* ─── Seller Profile (admin fills) ─── */

  async getProfile(userId: string): Promise<SellerProfile | null> {
    return this.profiles.findOne({ where: { userId } });
  }

  async upsertProfile(
    userId: string,
    adminId: string,
    dto: Partial<Pick<SellerProfile, 'fullName' | 'passportOrPinfl' | 'stir' | 'bankCardNumber' | 'bankCardHolderName' | 'adminNotes'>>,
    verify = false,
  ): Promise<SellerProfile> {
    let profile = await this.profiles.findOne({ where: { userId } });
    if (!profile) {
      profile = this.profiles.create({ userId });
    }
    Object.assign(profile, dto);
    if (verify) {
      profile.verifiedAt = new Date();
      profile.verifiedByAdminId = adminId;
    }
    return this.profiles.save(profile);
  }
}
