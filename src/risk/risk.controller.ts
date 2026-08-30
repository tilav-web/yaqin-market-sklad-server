import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/entities/admin-audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/role.enum';
import { AdminListRiskFlagsQuery, ReviewRiskFlagDto } from './dto/risk.dto';
import { RiskFlagStatus } from './entities/risk-flag.entity';
import { RiskService } from './risk.service';

@ApiBearerAuth()
@ApiTags('admin-risk')
@Roles(Role.Admin)
@Controller('admin/risk')
export class AdminRiskController {
  constructor(
    private readonly risk: RiskService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get('flags')
  list(@Query() query: AdminListRiskFlagsQuery) {
    return this.risk.list(query);
  }

  @Get('flags/open-count')
  openCount() {
    return this.risk.openCount();
  }

  @Patch('flags/:id/review')
  async review(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewRiskFlagDto,
  ) {
    const status =
      dto.status === 'confirmed'
        ? RiskFlagStatus.Confirmed
        : RiskFlagStatus.Dismissed;
    const flag = await this.risk.review(id, status, admin.sub, dto.note);
    if (!flag) throw new NotFoundException('Signal topilmadi');
    void this.auditLog.record({
      adminUserId: admin.sub,
      action: AuditAction.RiskFlagReviewed,
      targetType: 'risk_flag',
      targetId: id,
      reason: dto.note,
      metadata: { rule: flag.rule, status: flag.status },
    });
    return flag;
  }

  @Get('orders/:orderId/evidence')
  async orderEvidence(@Param('orderId', ParseUUIDPipe) orderId: string) {
    const evidence = await this.risk.orderEvidence(orderId);
    if (!evidence) throw new BadRequestException('Buyurtma topilmadi');
    return evidence;
  }
}
