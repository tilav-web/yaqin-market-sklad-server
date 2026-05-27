import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';

import { Public } from '../auth/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Public()
  @Get()
  async check() {
    let db = false;
    try {
      await this.dataSource.query('SELECT 1');
      db = true;
    } catch {
      db = false;
    }
    return {
      status: db ? 'ok' : 'degraded',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      services: {
        database: db ? 'up' : 'down',
      },
    };
  }
}
