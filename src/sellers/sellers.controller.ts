import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/role.enum';
import { SellerApplicationStatus } from './entities/seller-application.entity';
import { ApproveApplicationDto, CreateSellerApplicationDto, RejectApplicationDto } from './dto/seller-application.dto';
import { SellersService } from './sellers.service';

@ApiBearerAuth()
@ApiTags('sellers')
@Controller('sellers')
export class SellersController {
  constructor(private readonly sellers: SellersService) {}

  // Customer side
  @Post('apply')
  apply(@CurrentUser() user: JwtPayload, @Body() dto: CreateSellerApplicationDto) {
    return this.sellers.submitApplication(user.sub, dto);
  }

  @Get('my-applications')
  myApplications(@CurrentUser() user: JwtPayload) {
    return this.sellers.listMyApplications(user.sub);
  }

  // Admin side
  @Roles(Role.Admin)
  @Get('admin/applications')
  adminList(@Query('status') status?: SellerApplicationStatus) {
    return this.sellers.listAllApplications(status);
  }

  @Roles(Role.Admin)
  @Get('admin/applications/:id')
  adminGet(@Param('id', ParseUUIDPipe) id: string) {
    return this.sellers.getApplication(id);
  }

  @Roles(Role.Admin)
  @Post('admin/applications/:id/approve')
  adminApprove(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveApplicationDto,
  ) {
    return this.sellers.approve(id, admin.sub, dto);
  }

  @Roles(Role.Admin)
  @Post('admin/applications/:id/reject')
  adminReject(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectApplicationDto,
  ) {
    return this.sellers.reject(id, admin.sub, dto.reason);
  }

  /* ─── Seller Profile (admin) ─── */

  @Roles(Role.Admin)
  @Get('admin/profiles/:userId')
  getProfile(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.sellers.getProfile(userId);
  }

  @Roles(Role.Admin)
  @Put('admin/profiles/:userId')
  upsertProfile(
    @CurrentUser() admin: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: {
      fullName?: string;
      passportOrPinfl?: string;
      stir?: string;
      entityType?: string;
      bankCardNumber?: string;
      bankCardHolderName?: string;
      contractNumber?: string;
      contractDate?: string;
      adminNotes?: string;
      verify?: boolean;
    },
  ) {
    const { verify, ...dto } = body;
    return this.sellers.upsertProfile(userId, admin.sub, dto, verify);
  }
}
