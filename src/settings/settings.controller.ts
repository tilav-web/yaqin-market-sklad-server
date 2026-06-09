import { Body, Controller, Get, Param, Put } from '@nestjs/common';

import { Role } from '../auth/role.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { SettingsService } from './settings.service';

@Controller('admin/settings')
@Roles(Role.Admin)
export class SettingsController {
  constructor(private readonly svc: SettingsService) {}

  @Get()
  getAll() {
    return this.svc.getAll();
  }

  @Put(':key')
  set(@Param('key') key: string, @Body('value') value: string) {
    return this.svc.set(key, value);
  }
}
