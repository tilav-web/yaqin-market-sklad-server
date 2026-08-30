import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';

import { Role } from '../auth/role.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { SetSettingValueDto } from './dto/setting.dto';
import { SettingsService } from './settings.service';

@Controller('admin/settings')
@Roles(Role.Admin)
export class SettingsController {
  constructor(private readonly svc: SettingsService) {}

  @Get()
  getAll() {
    return this.svc.getAll();
  }

  /**
   * Marja-kalkulyator: admin panel komissiya maydonini o'zgartirganda shu
   * endpoint bilan jonli breakdown/ogohlantirish ko'rsatadi.
   * ?commission=2 — saqlanmagan qiymatni sinab ko'rish; bo'sh — joriy sozlama.
   */
  @Get('economics')
  economics(@Query('commission') commission?: string) {
    const n =
      commission != null && commission.trim() !== ''
        ? Number(commission)
        : undefined;
    return this.svc.computeEconomics(Number.isFinite(n) ? n : undefined);
  }

  @Get('test-didox')
  testDidox(@Query('key') key?: string, @Query('tin') tin?: string) {
    return this.svc.testDidox(key, tin);
  }

  @Put(':key')
  set(@Param('key') key: string, @Body() body: SetSettingValueDto) {
    return this.svc.set(key, body.value, body.force ?? false);
  }
}
