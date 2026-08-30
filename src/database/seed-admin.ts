import * as argon2 from 'argon2';
import { AppDataSource } from './data-source';
import {
  AdminRole,
  AdminUser,
} from '../admin-users/entities/admin-user.entity';

async function seedSuperAdmin() {
  console.log('--- Seeding SuperAdmin user ---');
  await AppDataSource.initialize();

  const repo = AppDataSource.getRepository(AdminUser);

  const defaultUsername = process.env.DEFAULT_ADMIN_USERNAME || 'superadmin';
  const defaultPassword =
    process.env.DEFAULT_ADMIN_PASSWORD || 'YaqinAdmin2026!';
  const defaultPhone = process.env.DEFAULT_ADMIN_PHONE || '+998900000000';

  const existing = await repo.findOne({ where: { username: defaultUsername } });
  if (existing) {
    console.log(
      `SuperAdmin '${defaultUsername}' allaqachon mavjud (id: ${existing.id}).`,
    );
    await AppDataSource.destroy();
    return;
  }

  const passwordHash = await argon2.hash(defaultPassword);

  const superAdmin = repo.create({
    username: defaultUsername,
    passwordHash,
    firstName: 'Super',
    lastName: 'Admin',
    phone: defaultPhone,
    email: 'admin@yaqin-market.uz',
    role: AdminRole.SuperAdmin,
    permissions: [],
    isActive: true,
  });

  const saved = await repo.save(superAdmin);
  console.log(`✅ SuperAdmin muvaffaqiyatli yaratildi:`);
  console.log(`   Username: ${saved.username}`);
  console.log(`   Parol:    ${defaultPassword}`);
  console.log(`   Rol:      ${saved.role}`);
  console.log(`   ID:       ${saved.id}`);

  await AppDataSource.destroy();
}

seedSuperAdmin().catch((err) => {
  console.error('SuperAdmin seed qilishda xatolik:', err);
  process.exit(1);
});
