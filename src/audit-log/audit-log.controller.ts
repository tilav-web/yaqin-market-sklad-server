import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/role.enum';
import { AuditLogService } from './audit-log.service';
import { AdminListAuditLogQuery } from './dto/audit-log.dto';

@ApiBearerAuth()
@ApiTags('admin-audit-log')
@Roles(Role.Admin)
@Controller('admin/audit-log')
export class AdminAuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  list(@Query() query: AdminListAuditLogQuery) {
    return this.auditLog.list(query);
  }
}
