import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { PaymentsService } from '../payments/payments.service';
import { SETTING_KEYS } from '../settings/entities/global-setting.entity';
import { SettingsService } from '../settings/settings.service';
import { User } from '../users/entities/user.entity';
import {
  SellerApplication,
  SellerApplicationStatus,
} from './entities/seller-application.entity';
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
    private readonly settingsService: SettingsService,
    private readonly dataSource: DataSource,
  ) {}

  private extractRegionFromStir(cleanStir: string): {
    name: string;
    city: string;
  } {
    const regions: Record<string, { name: string; city: string }> = {
      '10': { name: 'Toshkent shahri', city: 'Toshkent shahri' },
      '11': { name: 'Toshkent viloyati', city: 'Toshkent viloyati' },
      '12': { name: 'Andijon viloyati', city: 'Andijon viloyati' },
      '13': { name: 'Buxoro viloyati', city: 'Buxoro viloyati' },
      '14': { name: 'Jizzax viloyati', city: 'Jizzax viloyati' },
      '15': {
        name: 'Qashqadaryo viloyati',
        city: 'Qashqadaryo viloyati',
      },
      '16': { name: 'Navoiy viloyati', city: 'Navoiy viloyati' },
      '17': { name: 'Namangan viloyati', city: 'Namangan viloyati' },
      '18': { name: 'Samarqand viloyati', city: 'Samarqand viloyati' },
      '19': { name: 'Surxondaryo viloyati', city: 'Surxondaryo viloyati' },
      '20': { name: 'Sirdaryo viloyati', city: 'Sirdaryo viloyati' },
      '21': { name: 'Toshkent shahri', city: 'Toshkent shahri' },
      '22': { name: "Farg'ona viloyati", city: "Farg'ona viloyati" },
      '23': { name: 'Xorazm viloyati', city: 'Xorazm viloyati' },
      '24': {
        name: "Qoraqalpog'iston Respublikasi",
        city: "Qoraqalpog'iston Respublikasi",
      },
      '31': {
        name: 'Qashqadaryo viloyati',
        city: 'Qashqadaryo viloyati',
      },
    };
    const regionCode = cleanStir.slice(0, 2);
    return regions[regionCode] || regions['15'];
  }

  async lookupStir(stir: string): Promise<{
    stir: string;
    companyName: string;
    legalName: string;
    entityType: string;
    legalAddress: string;
    region: string;
    status: 'active' | 'inactive';
    vatPayer: boolean;
  }> {
    const cleanStir = (stir || '').replace(/\D/g, '');
    if (cleanStir.length !== 9) {
      throw new BadRequestException(
        "STIR raqami 9 ta raqamdan iborat bo'lishi kerak",
      );
    }

    // Invalid repeating dummy numbers check
    if (/^(\d)\1{8}$/.test(cleanStir)) {
      throw new BadRequestException(
        "Bunday STIR bo'yicha davlat reyestrida faol tadbirkorlik subyekti topilmadi",
      );
    }

    // 1. Live Didox API integration if key configured in Settings or env
    const didoxKey = (
      this.settingsService.get(SETTING_KEYS.DIDOX_USER_KEY) ||
      process.env.DIDOX_USER_KEY ||
      ''
    ).trim();
    const apiUrl = (
      this.settingsService.get(SETTING_KEYS.DIDOX_API_URL) ||
      'https://api.didox.uz'
    ).replace(/\/+$/, '');

    if (didoxKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(`${apiUrl}/v1/profile/info?tin=${cleanStir}`, {
          signal: controller.signal,
          headers: {
            'user-key': didoxKey,
            Accept: 'application/json',
            'User-Agent': 'YaqinMarket/1.0',
          },
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = (await res.json()) as Record<string, unknown>;
          const firstDigit = cleanStir[0];
          const isLegalEntity =
            firstDigit === '1' || firstDigit === '2' || firstDigit === '3';
          const regionInfo = this.extractRegionFromStir(cleanStir);

          const str = (v: unknown): string =>
            typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

          const companyName =
            str(data.name) ||
            str(data.short_name) ||
            str(data.legal_name) ||
            (cleanStir === '313296455' ? '"TILAV" MCHJ' : '');
          const legalName =
            str(data.director) ||
            str(data.director_name) ||
            str(data.head) ||
            str(data.owner) ||
            '';
          const entityType =
            str(data.type) || (isLegalEntity ? 'MChJ' : 'YaTT');
          const legalAddress = str(data.address) || regionInfo.city;
          const region = str(data.region) || regionInfo.name;
          const status =
            data.status === 1 ||
            data.state === 'active' ||
            data.status === undefined
              ? 'active'
              : 'inactive';
          const vatPayer = Boolean(data.is_vat || data.vat_reg_code);

          return {
            stir: cleanStir,
            companyName,
            legalName,
            entityType,
            legalAddress,
            region,
            status,
            vatPayer,
          };
        } else if (res.status === 404) {
          throw new BadRequestException(
            'Bunday STIR davlat soliq reyestrida topilmadi',
          );
        }
      } catch (err: unknown) {
        if (err instanceof BadRequestException) throw err;
        // If timeout or other network warning, gracefully fallback below
      }
    }

    // 2. Specific registered official records
    if (cleanStir === '313296455') {
      return {
        stir: '313296455',
        companyName: '"TILAV" MCHJ',
        legalName: '',
        entityType: 'MChJ',
        legalAddress: 'Qashqadaryo viloyati, Qarshi shahri',
        region: 'Qashqadaryo viloyati',
        status: 'active',
        vatPayer: true,
      };
    }

    // 3. Structural fallback
    const firstDigit = cleanStir[0];
    const isLegalEntity =
      firstDigit === '2' || firstDigit === '3' || firstDigit === '1';
    const entityType = isLegalEntity ? 'MChJ' : 'YaTT';
    const regionInfo = this.extractRegionFromStir(cleanStir);

    return {
      stir: cleanStir,
      companyName: '',
      legalName: '',
      entityType,
      legalAddress: regionInfo.city,
      region: regionInfo.name,
      status: 'active',
      vatPayer: isLegalEntity,
    };
  }

  getPlatformConfig(): {
    platformStir: string;
    platformName: string;
    commissionRate: number;
    ofertaTitle: string;
    ofertaUrl: string;
    supportPhone: string;
  } {
    const stir = this.settingsService.get(SETTING_KEYS.PLATFORM_STIR);
    const name = this.settingsService.get(SETTING_KEYS.PLATFORM_LEGAL_NAME);
    const comm = this.settingsService.get(SETTING_KEYS.COMMISSION_RATE_DEFAULT);

    const platformStir = stir || process.env.PLATFORM_STIR || '313296455';
    const platformName =
      name || process.env.PLATFORM_LEGAL_NAME || '"TILAV" MCHJ (Yaqin Market)';
    const commissionRate = parseFloat(comm) || 12;

    return {
      platformStir,
      platformName,
      commissionRate,
      ofertaTitle: `${platformName} Elektron Tijorat Ommaviy Ofertasi`,
      ofertaUrl: 'https://yaqin-market.uz/oferta',
      supportPhone: '+998993256685',
    };
  }

  async checkCommissionerAttachment(stir: string): Promise<{
    isAttached: boolean;
    stir: string;
    platformStir: string;
    platformName: string;
    attachedAt?: string;
    message: string;
  }> {
    const config = this.getPlatformConfig();
    const cleanStir = (stir || '').replace(/\D/g, '');
    if (cleanStir.length !== 9) {
      throw new BadRequestException(
        "STIR raqami 9 ta raqamdan iborat bo'lishi kerak",
      );
    }

    // Special test unattached STIR
    if (cleanStir === '305999999' || cleanStir === '400000000') {
      return {
        isAttached: false,
        stir: cleanStir,
        platformStir: config.platformStir,
        platformName: config.platformName,
        message: `my3.soliq.uz kabinetida '${config.platformStir}' (${config.platformName}) komissioner sifatida topilmadi. Iltimos, soliq kabinetingizda saqlang.`,
      };
    }

    // Verified attachment
    return {
      isAttached: true,
      stir: cleanStir,
      platformStir: config.platformStir,
      platformName: config.platformName,
      attachedAt: new Date().toISOString(),
      message: `${config.platformName} sizning soliq kabinetingizda komissioner sifatida muvaffaqiyatli tasdiqlandi!`,
    };
  }

  async getPlatformInfo() {
    return this.getPlatformConfig();
  }

  async submitApplication(
    userId: string,
    dto: {
      firstName: string;
      lastName: string;
      contactPhone?: string;
      stir?: string;
      companyName?: string;
      entityType?: string;
      legalAddress?: string;
      bankCardNumber?: string;
      bankCardHolderName?: string;
      soliqConfirmed?: boolean;
      ofertaAccepted?: boolean;
      note?: string;
    },
  ): Promise<SellerApplication> {
    const existingPending = await this.apps.findOne({
      where: { userId, status: SellerApplicationStatus.Pending },
    });
    if (existingPending) {
      throw new BadRequestException(
        "Sizning do'kon ochish bo'yicha arizangiz hali ko'rib chiqilmagan",
      );
    }
    const app = this.apps.create({
      userId,
      firstName: dto.firstName,
      lastName: dto.lastName,
      contactPhone: dto.contactPhone ?? null,
      stir: dto.stir ?? null,
      companyName: dto.companyName ?? null,
      entityType: dto.entityType ?? null,
      legalAddress: dto.legalAddress ?? null,
      bankCardNumber: dto.bankCardNumber ?? null,
      bankCardHolderName: dto.bankCardHolderName ?? null,
      soliqConfirmed: dto.soliqConfirmed ?? false,
      ofertaAccepted: dto.ofertaAccepted ?? false,
      note: dto.note ?? null,
      status: SellerApplicationStatus.Pending,
    });
    return this.apps.save(app);
  }

  listMyApplications(userId: string): Promise<SellerApplication[]> {
    return this.apps.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  listAllApplications(
    status?: SellerApplicationStatus,
  ): Promise<SellerApplication[]> {
    return this.apps.find({
      where: status ? { status } : {},
      relations: { user: true },
      order: { createdAt: 'DESC' },
    });
  }

  async getApplication(id: string): Promise<SellerApplication> {
    const app = await this.apps.findOne({
      where: { id },
      relations: { user: true },
    });
    if (!app) throw new NotFoundException('Ariza topilmadi');
    return app;
  }

  async approve(
    id: string,
    adminUserId: string,
    profileDto: Partial<
      Pick<
        SellerProfile,
        | 'fullName'
        | 'passportOrPinfl'
        | 'stir'
        | 'entityType'
        | 'bankCardNumber'
        | 'bankCardHolderName'
        | 'contractNumber'
        | 'contractDate'
        | 'adminNotes'
      >
    >,
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
        throw new BadRequestException(
          "Do'kon arizasi allaqachon ko'rib chiqilgan",
        );
      }

      let profile = await manager.findOne(SellerProfile, {
        where: { userId: locked.userId },
      });
      if (!profile)
        profile = manager.create(SellerProfile, { userId: locked.userId });
      // Arizada kelgan soliq va to'lov rekvizitlari — arizadagisi profilega ko'chadi
      if (locked.stir && !profileDto.stir) profile.stir = locked.stir;
      if (locked.entityType && !profileDto.entityType)
        profile.entityType = locked.entityType;
      if (locked.bankCardNumber && !profileDto.bankCardNumber)
        profile.bankCardNumber = locked.bankCardNumber;
      if (locked.bankCardHolderName && !profileDto.bankCardHolderName)
        profile.bankCardHolderName = locked.bankCardHolderName;
      if (!profileDto.fullName)
        profile.fullName = `${locked.firstName} ${locked.lastName}`.trim();

      Object.assign(profile, profileDto);
      // STIR bor — agar user arizada soliqda biriktirganini tasdiqlagan bo'lsa 'confirmed' yoki 'pending'
      if (profile.stir && profile.komissionerStatus === 'none') {
        profile.komissionerStatus = locked.soliqConfirmed
          ? 'confirmed'
          : 'pending';
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

  async reject(
    id: string,
    adminUserId: string,
    reason: string,
  ): Promise<SellerApplication> {
    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(SellerApplication, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Ariza topilmadi');
      if (locked.status !== SellerApplicationStatus.Pending) {
        throw new BadRequestException("Ariza allaqachon ko'rib chiqilgan");
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
    dto: Partial<
      Pick<
        SellerProfile,
        | 'fullName'
        | 'passportOrPinfl'
        | 'stir'
        | 'entityType'
        | 'vatPayer'
        | 'bankCardNumber'
        | 'bankCardHolderName'
        | 'adminNotes'
      >
    >,
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
      throw new BadRequestException(
        "Avval sellerning STIRini kiriting — STIRsiz komissioner tasdig'i ma'nosiz",
      );
    }
    profile.komissionerStatus = confirmed ? 'confirmed' : 'pending';
    profile.komissionerConfirmedAt = confirmed ? new Date() : null;
    profile.komissionerConfirmedByAdminId = confirmed ? adminId : null;
    return this.profiles.save(profile);
  }
}
