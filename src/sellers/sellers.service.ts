import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { PaymentsService } from '../payments/payments.service';
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
    @InjectRepository(SellerProfile)
    private readonly profiles: Repository<SellerProfile>,
    private readonly payments: PaymentsService,
    private readonly dataSource: DataSource,
  ) {}

  async submitApplication(
    userId: string,
    dto: {
      firstName: string;
      lastName: string;
      contactPhone?: string;
      stir?: string;
      entityType?: string;
      note?: string;
    },
  ): Promise<SellerApplication> {
    const existingPending = await this.apps.findOne({
      where: { userId, status: SellerApplicationStatus.Pending },
    });
    if (existingPending) {
      throw new BadRequestException('Sizning do\'kon ochish bo\'yicha arizangiz hali ko\'rib chiqilmagan');
    }
    const app = this.apps.create({
      userId,
      firstName: dto.firstName,
      lastName: dto.lastName,
      contactPhone: dto.contactPhone ?? null,
      stir: dto.stir ?? null,
      entityType: dto.entityType ?? null,
      note: dto.note ?? null,
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

  async approve(
    id: string,
    adminUserId: string,
    profileDto: Partial<Pick<
      SellerProfile,
      'fullName' | 'passportOrPinfl' | 'stir' | 'entityType' |
      'bankCardNumber' | 'bankCardHolderName' | 'contractNumber' |
      'contractDate' | 'adminNotes'
    >>,
  ): Promise<{ application: SellerApplication }> {
    // Re-fetch under a write lock and re-check status INSIDE the
    // transaction — two concurrent approve/reject calls on the same
    // application must not both pass the "still pending" check (that would
    // grant seller status/balance and then have the reject overwrite the
    // status on top, with no way to undo the grant).
    const app = await this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(SellerApplication, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Ariza topilmadi');
      if (locked.status !== SellerApplicationStatus.Pending) {
        throw new BadRequestException('Ariza allaqachon ko\'rib chiqilgan');
      }

      let profile = await manager.findOne(SellerProfile, { where: { userId: locked.userId } });
      if (!profile) profile = manager.create(SellerProfile, { userId: locked.userId });
      // Arizada kelgan soliq rekvizitlari — admin approve-dto'da bermagan
      // bo'lsa arizadagisi profilega ko'chadi.
      if (locked.stir && !profileDto.stir) profile.stir = locked.stir;
      if (locked.entityType && !profileDto.entityType) profile.entityType = locked.entityType;
      Object.assign(profile, profileDto);
      // STIR bor — endi seller my.soliq.uz'da bizni komissioner qilib
      // qo'shishi kutiladi; admin tasdiqlagach 'confirmed' bo'ladi.
      if (profile.stir && profile.komissionerStatus === 'none') {
        profile.komissionerStatus = 'pending';
      }
      profile.verifiedAt = new Date();
      profile.verifiedByAdminId = adminUserId;
      await manager.save(profile);

      locked.status = SellerApplicationStatus.Approved;
      locked.reviewedByUserId = adminUserId;
      locked.reviewedAt = new Date();
      await manager.save(locked);

      await manager.update(User, locked.userId, { isSellerApproved: true });
      return locked;
    });

    await this.payments.ensureBalance(app.userId);

    return { application: app };
  }

  async reject(id: string, adminUserId: string, reason: string): Promise<SellerApplication> {
    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(SellerApplication, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Ariza topilmadi');
      if (locked.status !== SellerApplicationStatus.Pending) {
        throw new BadRequestException('Ariza allaqachon ko\'rib chiqilgan');
      }
      locked.status = SellerApplicationStatus.Rejected;
      locked.rejectionReason = reason;
      locked.reviewedByUserId = adminUserId;
      locked.reviewedAt = new Date();
      return manager.save(locked);
    });
  }

  /* ─── Seller Profile (admin fills) ─── */

  async getProfile(userId: string): Promise<SellerProfile | null> {
    return this.profiles.findOne({ where: { userId } });
  }

  async upsertProfile(
    userId: string,
    adminId: string,
    dto: Partial<Pick<SellerProfile, 'fullName' | 'passportOrPinfl' | 'stir' | 'entityType' | 'vatPayer' | 'bankCardNumber' | 'bankCardHolderName' | 'adminNotes'>>,
    verify = false,
  ): Promise<SellerProfile> {
    let profile = await this.profiles.findOne({ where: { userId } });
    if (!profile) {
      profile = this.profiles.create({ userId });
    }
    Object.assign(profile, dto);
    if (profile.stir && profile.komissionerStatus === 'none') {
      profile.komissionerStatus = 'pending';
    }
    if (verify) {
      profile.verifiedAt = new Date();
      profile.verifiedByAdminId = adminId;
    }
    return this.profiles.save(profile);
  }

  /**
   * Admin soliq kabinetida sellerning komissioner ro'yxatiga qo'shganini
   * ko'rib tasdiqlaydi (yoki bekor qiladi). Avtomatik tekshirish uchun soliq
   * tomonida ochiq API yo'q — jarayon hozircha qo'lda; API chiqsa shu metod
   * cron ichidan chaqiriladigan bo'ladi.
   */
  async setKomissionerStatus(
    userId: string,
    adminId: string,
    confirmed: boolean,
  ): Promise<SellerProfile> {
    const profile = await this.profiles.findOne({ where: { userId } });
    if (!profile) throw new NotFoundException('Seller profili topilmadi');
    if (confirmed && !profile.stir) {
      throw new BadRequestException("Avval sellerning STIRini kiriting — STIRsiz komissioner tasdig'i ma'nosiz");
    }
    profile.komissionerStatus = confirmed ? 'confirmed' : 'pending';
    profile.komissionerConfirmedAt = confirmed ? new Date() : null;
    profile.komissionerConfirmedByAdminId = confirmed ? adminId : null;
    return this.profiles.save(profile);
  }
}
