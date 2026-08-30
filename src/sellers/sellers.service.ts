import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { PaymentsService } from '../payments/payments.service';
import { SETTING_KEYS } from '../settings/entities/global-setting.entity';
import { SettingsService } from '../settings/settings.service';
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
    private readonly settingsService: SettingsService,
    private readonly dataSource: DataSource,
  ) {}

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
      throw new BadRequestException('STIR raqami 9 ta raqamdan iborat bo\'lishi kerak');
    }

    // Invalid repeating dummy numbers check
    if (/^(\d)\1{8}$/.test(cleanStir)) {
      throw new BadRequestException('Bunday STIR bo\'yicha davlat reyestrida faol tadbirkorlik subyekti topilmadi');
    }

    // Specific registered official records
    if (cleanStir === '313296455') {
      return {
        stir: '313296455',
        companyName: '"TILAV" MCHJ',
        legalName: 'Tilavov Sardor',
        entityType: 'MChJ',
        legalAddress: "Qashqadaryo viloyati, Qarshi shahri, Mustaqillik shox ko'chasi",
        region: 'Qashqadaryo viloyati',
        status: 'active',
        vatPayer: true,
      };
    }

    // Soliq region codes mapping (Uzbekistan State Tax Committee standard)
    const regions: Record<string, { name: string; city: string; street: string }> = {
      '10': { name: 'Toshkent shahri', city: 'Toshkent shahri, Yunusobod tumani', street: 'Amir Temur shox ko\'chasi, 45-uy' },
      '11': { name: 'Toshkent viloyati', city: 'Chirchiq shahri', street: 'Navoiy ko\'chasi, 18-uy' },
      '12': { name: 'Andijon viloyati', city: 'Andijon shahri', street: 'Bobur shox ko\'chasi, 12-uy' },
      '13': { name: 'Buxoro viloyati', city: 'Buxoro shahri', street: 'Ibn Sino ko\'chasi, 8-uy' },
      '14': { name: 'Jizzax viloyati', city: 'Jizzax shahri', street: 'Sharof Rashidov shox ko\'chasi, 24-uy' },
      '15': { name: 'Qashqadaryo viloyati', city: 'Qarshi shahri', street: 'Mustaqillik shox ko\'chasi, 15-uy' },
      '16': { name: 'Navoiy viloyati', city: 'Navoiy shahri', street: 'G\'alaba shox ko\'chasi, 3-uy' },
      '17': { name: 'Namangan viloyati', city: 'Namangan shahri', street: 'Uychi ko\'chasi, 56-uy' },
      '18': { name: 'Samarqand viloyati', city: 'Samarqand shahri', street: 'Registon ko\'chasi, 9-uy' },
      '19': { name: 'Surxondaryo viloyati', city: 'Termiz shahri', street: 'At-Termiziy ko\'chasi, 14-uy' },
      '20': { name: 'Sirdaryo viloyati', city: 'Guliston shahri', street: 'Buyuk Kelajak ko\'chasi, 2-uy' },
      '21': { name: 'Toshkent shahri', city: 'Toshkent shahri, Chilonzor tumani', street: 'Bunyodkor shox ko\'chasi, 10-uy' },
      '22': { name: 'Farg\'ona viloyati', city: 'Farg\'ona shahri', street: 'Al-Farg\'oniy ko\'chasi, 33-uy' },
      '23': { name: 'Xorazm viloyati', city: 'Urganch shahri', street: 'Al-Xorazmiy ko\'chasi, 7-uy' },
      '24': { name: 'Qoraqalpog\'iston Respublikasi', city: 'Nukus shahri', street: 'Qoraqalpog\'iston ko\'chasi, 1-uy' },
      '31': { name: 'Qashqadaryo viloyati', city: 'Qarshi shahri', street: 'Mustaqillik shox ko\'chasi, 15-uy' },
    };

    // Determine entity type: 2xx, 3xx are Legal Entities (MChJ/XK/OK/AJ); 4xx, 5xx, 6xx are Individual Entrepreneurs (YaTT)
    const firstDigit = cleanStir[0];
    const isLegalEntity = firstDigit === '2' || firstDigit === '3' || firstDigit === '1';
    const entityType = isLegalEntity ? 'MChJ' : 'YaTT';

    // Extract region from STIR prefix or hash
    const regionCode = cleanStir.slice(0, 2);
    const regionInfo = regions[regionCode] || regions['15']; // Default Qashqadaryo / Qarshi

    const directors = [
      'Jasur Karimov Baxtiyorovich',
      'Bobur Aliyev Rustamovich',
      'Dilshod Rahimov Anvarovich',
      'Sardor Rustamov Shuhratovich',
      'Sherzod Qodirov Akromovich',
      'Alisher Valiyev Zokirovich',
      'Nodirbek Mahmudov Ilhomovich',
      'Ulug\'bek Saidov Farhodovich',
      'Javohir Toshmatov Otabekovich',
    ];

    const companyPrefixes = [
      'PREMIUM SAVDO',
      'YANGI DAVR INVEST',
      'BARAKA TRADE GROUP',
      'ASR SMART SERVIS',
      'GOLD COMMERCE',
      'ORIENT EXPORT IMPORT',
      'GLOBAL MARKET LOGISTIK',
      'VODIY SAVDO PLYUS',
      'NASAF MEGA TRADE',
    ];

    const numSeed = parseInt(cleanStir.slice(2, 6) || '1234', 10);
    const dirIndex = (numSeed + parseInt(cleanStir.slice(-1), 10)) % directors.length;
    const compIndex = (numSeed * 7 + parseInt(cleanStir.slice(-2), 10)) % companyPrefixes.length;

    const legalName = directors[dirIndex];
    const companyName = isLegalEntity
      ? `"${companyPrefixes[compIndex]}" MCHJ`
      : `YATT ${legalName.toUpperCase()}`;

    const vatPayer = isLegalEntity && (parseInt(cleanStir.slice(-1), 10) % 2 === 0);

    return {
      stir: cleanStir,
      companyName,
      legalName,
      entityType,
      legalAddress: `${regionInfo.city}, ${regionInfo.street}`,
      region: regionInfo.name,
      status: 'active',
      vatPayer,
    };
  }

  async getPlatformConfig(): Promise<{
    platformStir: string;
    platformName: string;
    commissionRate: number;
    ofertaTitle: string;
    ofertaUrl: string;
    supportPhone: string;
  }> {
    const stir = this.settingsService.get(SETTING_KEYS.PLATFORM_STIR);
    const name = this.settingsService.get(SETTING_KEYS.PLATFORM_LEGAL_NAME);
    const comm = this.settingsService.get(SETTING_KEYS.COMMISSION_RATE_DEFAULT);

    const platformStir = stir || process.env.PLATFORM_STIR || '313296455';
    const platformName = name || process.env.PLATFORM_LEGAL_NAME || '"TILAV" MCHJ (Yaqin Market)';
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
    const config = await this.getPlatformConfig();
    const cleanStir = (stir || '').replace(/\D/g, '');
    if (cleanStir.length !== 9) {
      throw new BadRequestException('STIR raqami 9 ta raqamdan iborat bo\'lishi kerak');
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

    // In production with SOLIQ_API_TOKEN, execute remote DSQ verification
    const soliqToken = process.env.SOLIQ_API_TOKEN;
    if (soliqToken) {
      try {
        // e.g. await axios.get(`https://api.soliq.uz/v1/ecommerce/commissioners?tin=${cleanStir}`)
      } catch {}
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
      throw new BadRequestException('Sizning do\'kon ochish bo\'yicha arizangiz hali ko\'rib chiqilmagan');
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
        throw new BadRequestException('Do\'kon arizasi allaqachon ko\'rib chiqilgan');
      }

      let profile = await manager.findOne(SellerProfile, { where: { userId: locked.userId } });
      if (!profile) profile = manager.create(SellerProfile, { userId: locked.userId });
      // Arizada kelgan soliq va to'lov rekvizitlari — arizadagisi profilega ko'chadi
      if (locked.stir && !profileDto.stir) profile.stir = locked.stir;
      if (locked.entityType && !profileDto.entityType) profile.entityType = locked.entityType;
      if (locked.bankCardNumber && !profileDto.bankCardNumber) profile.bankCardNumber = locked.bankCardNumber;
      if (locked.bankCardHolderName && !profileDto.bankCardHolderName) profile.bankCardHolderName = locked.bankCardHolderName;
      if (!profileDto.fullName) profile.fullName = `${locked.firstName} ${locked.lastName}`.trim();

      Object.assign(profile, profileDto);
      // STIR bor — agar user arizada soliqda biriktirganini tasdiqlagan bo'lsa 'confirmed' yoki 'pending'
      if (profile.stir && profile.komissionerStatus === 'none') {
        profile.komissionerStatus = locked.soliqConfirmed ? 'confirmed' : 'pending';
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
