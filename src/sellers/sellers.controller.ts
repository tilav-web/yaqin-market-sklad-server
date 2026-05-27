import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { AdminGuard } from '../auth/guards/admin.guard';
import { SellerApplicationStatus } from './entities/seller-application.entity';
import { CreateSellerApplicationDto, RejectApplicationDto } from './dto/seller-application.dto';
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
  @UseGuards(AdminGuard)
  @Get('admin/applications')
  adminList(@Query('status') status?: SellerApplicationStatus) {
    return this.sellers.listAllApplications(status);
  }

  @UseGuards(AdminGuard)
  @Get('admin/applications/:id')
  adminGet(@Param('id', ParseUUIDPipe) id: string) {
    return this.sellers.getApplication(id);
  }

  @UseGuards(AdminGuard)
  @Post('admin/applications/:id/approve')
  adminApprove(@CurrentUser() admin: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.sellers.approve(id, admin.sub);
  }

  @UseGuards(AdminGuard)
  @Post('admin/applications/:id/reject')
  adminReject(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectApplicationDto,
  ) {
    return this.sellers.reject(id, admin.sub, dto.reason);
  }
}
