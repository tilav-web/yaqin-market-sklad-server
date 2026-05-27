import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import type { EnvironmentVariables } from '../config/configuration';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(ConfigService) config: ConfigService<EnvironmentVariables, true>) {
    this.client = new Redis({
      host: config.get('REDIS_HOST', { infer: true }),
      port: config.get('REDIS_PORT', { infer: true }),
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
