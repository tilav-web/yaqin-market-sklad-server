/**
 * Plain TypeORM DataSource for the CLI (migration:generate/run/revert).
 *
 * NestJS's TypeOrmModule.forRootAsync + ConfigService (see
 * ../database/typeorm.config.ts) is how the running app connects — it can't
 * be reused here because the CLI runs outside of Nest's DI container. This
 * file talks to the same database using the same env vars, but is loaded
 * directly via `dotenv` and lists entities/migrations by glob instead of
 * relying on autoLoadEntities.
 *
 * Usage (see package.json scripts):
 *   npm run migration:generate -- src/database/migrations/SomeName
 *   npm run migration:run
 *   npm run migration:revert
 */
import 'reflect-metadata';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { DataSource } from 'typeorm';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  username: process.env.POSTGRES_USER ?? 'yaqin',
  password: process.env.POSTGRES_PASSWORD ?? 'yaqin_dev_password',
  database: process.env.POSTGRES_DB ?? 'yaqin_market',
  entities: [path.join(__dirname, '../**/*.entity{.ts,.js}')],
  migrations: [path.join(__dirname, 'migrations/*{.ts,.js}')],
  // Never synchronize from the CLI data source — schema changes must go
  // through migrations once this workflow is adopted. The running app's own
  // synchronize:true (dev-only, see typeorm.config.ts) is unaffected by this.
  synchronize: false,
  logging: ['error'],
});
