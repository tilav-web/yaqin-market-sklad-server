import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AdminRoles } from '../admin-auth/decorators/admin-roles.decorator';
import { AdminJwtGuard } from '../admin-auth/guards/admin-jwt.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminRole } from '../admin-users/entities/admin-user.entity';
import { AuditLogService } from './audit-log.service';
import { AdminListAuditLogQuery } from './dto/audit-log.dto';

@ApiBearerAuth()
@ApiTags('Admin Audit Log')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SuperAdmin, AdminRole.Admin)
@Controller('admin/audit-log')
export class AdminAuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  list(@Query() query: AdminListAuditLogQuery) {
    return this.auditLog.list(query);
  }
}
