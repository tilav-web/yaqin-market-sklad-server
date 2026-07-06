import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/role.enum';
import { AdminListComplaintsQuery, CreateComplaintDto, ResolveComplaintDto } from './dto/complaint.dto';
import { ComplaintsService } from './complaints.service';

/** Customer-facing: file a dispute on a delivered order (SPEC.md §8.5, §21). */
@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders')
export class OrderComplaintController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Post(':id/complaint')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateComplaintDto,
  ) {
    return this.complaints.createComplaint(user.sub, id, dto);
  }
}

@ApiBearerAuth()
@ApiTags('admin-complaints')
@Roles(Role.Admin)
@Controller('admin/complaints')
export class AdminComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get()
  list(@Query() query: AdminListComplaintsQuery) {
    return this.complaints.adminList(query);
  }

  @Post(':id/resolve')
  resolve(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveComplaintDto,
  ) {
    return this.complaints.adminResolve(id, user.sub, dto.resolution);
  }
}
