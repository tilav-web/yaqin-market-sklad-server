import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { Role } from '../src/auth/role.enum';
import { User } from '../src/users/entities/user.entity';

/**
 * Global RolesGuard enforcement (SPEC.md, app.module.ts's APP_GUARD chain):
 * a route decorated with `@Roles(Role.Admin)` must 403 a authenticated
 * non-admin, 401 an unauthenticated caller, and only 200 an actual admin.
 *
 * Uses the real HTTP pipeline (JwtAuthGuard → RolesGuard) against a real DB
 * row, rather than mocking the guard — this is exactly the wiring that
 * would silently regress if `RolesGuard` were ever dropped from
 * `app.module.ts`'s providers or a controller's `@Roles()` decorator were
 * removed.
 */
describe('RolesGuard (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let jwtService: JwtService;
  let config: ConfigService;
  const createdUserIds: string[] = [];

  const ADMIN_ROUTE = '/api/admin/complaints';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health'] });
    await app.init();

    dataSource = app.get(DataSource);
    jwtService = app.get(JwtService);
    config = app.get(ConfigService);
  });

  afterAll(async () => {
    if (createdUserIds.length) {
      await dataSource.getRepository(User).delete(createdUserIds);
    }
    await app.close();
  });

  async function createUser(roles: Role[]): Promise<User> {
    const repo = dataSource.getRepository(User);
    const phone = `+998${Math.floor(100_000_000 + Math.random() * 800_000_000)}`;
    const user = await repo.save(
      repo.create({
        phone,
        roles,
        isAdmin: roles.includes(Role.Admin),
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  async function tokenFor(user: User): Promise<string> {
    return jwtService.signAsync(
      { sub: user.id, phone: user.phone, roles: user.roles },
      { secret: config.get('JWT_SECRET'), expiresIn: '15m' },
    );
  }

  it('Authorization header bo\'lmasa 401 qaytaradi', async () => {
    await request(app.getHttpServer()).get(ADMIN_ROUTE).expect(401);
  });

  it('oddiy mijoz (admin bo\'lmagan) JWT bilan 403 qaytaradi', async () => {
    const user = await createUser([Role.Customer]);
    const token = await tokenFor(user);

    await request(app.getHttpServer())
      .get(ADMIN_ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('admin JWT bilan 200 qaytaradi', async () => {
    const user = await createUser([Role.Customer, Role.Admin]);
    const token = await tokenFor(user);

    const res = await request(app.getHttpServer())
      .get(ADMIN_ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('total');
  });
});
