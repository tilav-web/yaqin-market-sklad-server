import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

import type { EnvironmentVariables } from '../config/configuration';

export const buildTypeOrmOptions = (
  config: ConfigService<EnvironmentVariables, true>,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: config.get('POSTGRES_HOST', { infer: true }),
  port: config.get('POSTGRES_PORT', { infer: true }),
  username: config.get('POSTGRES_USER', { infer: true }),
  password: config.get('POSTGRES_PASSWORD', { infer: true }),
  database: config.get('POSTGRES_DB', { infer: true }),
  autoLoadEntities: true,
  synchronize: config.get('NODE_ENV', { infer: true }) !== 'production',
  logging:
    config.get('NODE_ENV', { infer: true }) === 'development' ? ['warn', 'error'] : ['error'],
});
