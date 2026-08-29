import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { AdminRole, AdminUser } from './entities/admin-user.entity';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { ListAdminUsersQueryDto } from './dto/list-admin-users.dto';
import { ResetAdminPasswordDto, UpdateAdminUserDto } from './dto/update-admin-user.dto';

@Injectable()
export class AdminUsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    @InjectRepository(AdminUser)
    private readonly repo: Repository<AdminUser>,
  ) {}

  async onApplicationBootstrap() {
    await this.ensureRootSuperAdmin();
  }

  /**
   * Server ishga tushganda asosiy Root SuperAdmin borligini tekshiradi.
   * Agar bazada yo'q bo'lsa, uni avtomatik yaratib, daxlsiz (isProtected) qilib belgilaydi.
   */
  async ensureRootSuperAdmin(): Promise<void> {
    try {
      const rootUsername = (process.env.DEFAULT_ADMIN_USERNAME || 'superadmin').toLowerCase().trim();
      const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'YaqinAdmin2026!';
      const defaultPhone = process.env.DEFAULT_ADMIN_PHONE || '+998900000000';

      const existing = await this.repo.findOne({
        where: [{ isProtected: true }, { username: rootUsername }],
      });

      if (!existing) {
        const passwordHash = await argon2.hash(defaultPassword);
        const rootAdmin = this.repo.create({
          username: rootUsername,
          passwordHash,
          firstName: 'Super',
          lastName: 'Admin',
          phone: defaultPhone,
          email: 'admin@yaqin-market.uz',
          role: AdminRole.SuperAdmin,
          permissions: [],
          isActive: true,
          isProtected: true,
        });
        await this.repo.save(rootAdmin);
        this.logger.log(`✅ Root SuperAdmin yaratildi: username='${rootUsername}'`);
      } else if (!existing.isProtected) {
        existing.isProtected = true;
        await this.repo.save(existing);
      }
    } catch (e) {
      this.logger.warn(`Root SuperAdmin tekshirishda xatolik (ehtimol DB migratsiyasi bajarilmoqda): ${e}`);
    }
  }

  async create(dto: CreateAdminUserDto, createdByAdminId?: string): Promise<AdminUser> {
    const existingUsername = await this.repo.findOne({
      where: { username: dto.username.toLowerCase().trim() },
    });
    if (existingUsername) {
      throw new ConflictException(`'${dto.username}' nomli username allaqachon mavjud`);
    }

    if (dto.phone) {
      const formattedPhone = this.normalizePhone(dto.phone);
      const existingPhone = await this.repo.findOne({ where: { phone: formattedPhone } });
      if (existingPhone) {
        throw new ConflictException(`'${dto.phone}' telefon raqami boshqa xodimga biriktirilgan`);
      }
      dto.phone = formattedPhone;
    }

    const passwordHash = await argon2.hash(dto.password);

    const admin = this.repo.create({
      username: dto.username.toLowerCase().trim(),
      passwordHash,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      phone: dto.phone || null,
      email: dto.email?.trim() || null,
      role: dto.role,
      permissions: dto.permissions || [],
      isActive: true,
      isProtected: false,
      createdByAdminId: createdByAdminId || null,
    });

    return this.repo.save(admin);
  }

  async findAll(query: ListAdminUsersQueryDto) {
    const qb = this.repo.createQueryBuilder('a');

    if (query.search) {
      const search = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(a.username) LIKE :search OR LOWER(a.firstName) LIKE :search OR LOWER(a.lastName) LIKE :search OR a.phone LIKE :search)',
        { search },
      );
    }

    if (query.role) {
      qb.andWhere('a.role = :role', { role: query.role });
    }

    if (query.isActive !== undefined) {
      qb.andWhere('a.isActive = :isActive', { isActive: query.isActive });
    }

    qb.orderBy('a.isProtected', 'DESC')
      .addOrderBy('a.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [items, total] = await qb.getManyAndCount();

    // Strip passwordHash from results
    const safeItems = items.map((u) => {
      const { passwordHash: _, ...rest } = u;
      return rest;
    });

    return {
      items: safeItems,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async findById(id: string): Promise<AdminUser> {
    const admin = await this.repo.findOne({ where: { id } });
    if (!admin) {
      throw new NotFoundException('Xodim topilmadi');
    }
    return admin;
  }

  async findByUsername(username: string): Promise<AdminUser | null> {
    return this.repo.findOne({
      where: { username: username.toLowerCase().trim() },
    });
  }

  async findByPhone(phone: string): Promise<AdminUser | null> {
    return this.repo.findOne({
      where: { phone: this.normalizePhone(phone) },
    });
  }

  async update(id: string, dto: UpdateAdminUserDto): Promise<AdminUser> {
    const admin = await this.findById(id);

    if (admin.isProtected) {
      if (dto.role !== undefined && dto.role !== AdminRole.SuperAdmin) {
        throw new BadRequestException("Asosiy (Root) SuperAdmin rolini o'zgartirib bo'lmaydi");
      }
      if (dto.isActive === false) {
        throw new BadRequestException("Asosiy (Root) SuperAdminni nofaol qilib bo'lmaydi");
      }
    }

    if (dto.phone !== undefined) {
      if (dto.phone) {
        const formatted = this.normalizePhone(dto.phone);
        const existing = await this.repo.findOne({ where: { phone: formatted } });
        if (existing && existing.id !== id) {
          throw new ConflictException(`'${dto.phone}' telefon raqami boshqa xodimga biriktirilgan`);
        }
        admin.phone = formatted;
      } else {
        admin.phone = null;
      }
    }

    if (dto.username !== undefined) {
      const cleanUsername = dto.username.toLowerCase().trim().replace(/\s+/g, '');
      if (!cleanUsername) {
        throw new BadRequestException("Username bo'sh bo'lishi mumkin emas");
      }
      if (cleanUsername !== admin.username) {
        const existing = await this.repo.findOne({ where: { username: cleanUsername } });
        if (existing && existing.id !== id) {
          throw new ConflictException(`'${cleanUsername}' nomli username allaqachon mavjud`);
        }
        admin.username = cleanUsername;
      }
    }

    if (dto.firstName !== undefined) admin.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) admin.lastName = dto.lastName.trim();
    if (dto.email !== undefined) admin.email = dto.email?.trim() || null;
    if (dto.role !== undefined) admin.role = dto.role;
    if (dto.permissions !== undefined) admin.permissions = dto.permissions;
    if (dto.isActive !== undefined && !admin.isProtected) admin.isActive = dto.isActive;

    return this.repo.save(admin);
  }

  async setStatus(id: string, isActive: boolean, currentAdminId: string): Promise<AdminUser> {
    const admin = await this.findById(id);

    if (admin.isProtected && !isActive) {
      throw new BadRequestException("Asosiy (Root) SuperAdminni nofaol qilib bo'lmaydi");
    }

    if (id === currentAdminId && !isActive) {
      throw new BadRequestException("O'zingizning hisobingizni nofaol qila olmaysiz");
    }

    admin.isActive = isActive;
    return this.repo.save(admin);
  }

  async resetPassword(id: string, dto: ResetAdminPasswordDto): Promise<void> {
    const admin = await this.findById(id);
    admin.passwordHash = await argon2.hash(dto.newPassword);
    await this.repo.save(admin);
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.repo.update(id, { lastLoginAt: new Date() });
  }

  private normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('998') && digits.length === 12) {
      return `+${digits}`;
    }
    if (digits.length === 9) {
      return `+998${digits}`;
    }
    return raw.startsWith('+') ? raw : `+${raw}`;
  }
}
