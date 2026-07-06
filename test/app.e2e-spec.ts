import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  // NOTE: the original scaffold-generated test hit `/` expecting the Nest
  // starter's "Hello World!" — there is no such route in this app (no root
  // AppController), so it always failed with a 404. `/health` is the actual
  // always-public, no-auth route (see src/health/health.controller.ts).
  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('status');
        expect(res.body.services).toHaveProperty('database');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
