import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminRoles } from '../admin-auth/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { AdminJwtGuard } from '../admin-auth/guards/admin-jwt.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminUsersService } from './admin-users.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { ListAdminUsersQueryDto } from './dto/list-admin-users.dto';
import {
  ResetAdminPasswordDto,
  UpdateAdminUserDto,
} from './dto/update-admin-user.dto';
import { AdminRole, AdminUser } from './entities/admin-user.entity';

@ApiTags('Admin Staff Management')
@Controller('admin/staff')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
@ApiBearerAuth()
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  @AdminRoles(AdminRole.SuperAdmin, AdminRole.Admin)
  @ApiOperation({ summary: "Platforma xodimlari ro'yxatini olish" })
  findAll(@Query() query: ListAdminUsersQueryDto) {
    return this.service.findAll(query);
  }

  @Post()
  @AdminRoles(AdminRole.SuperAdmin)
  @ApiOperation({ summary: "Yangi xodim qo'shish (faqat SuperAdmin)" })
  async create(
    @Body() dto: CreateAdminUserDto,
    @CurrentAdmin('id') currentAdminId: string,
  ) {
    const admin = await this.service.create(dto, currentAdminId);
    const { passwordHash: _, ...safeAdmin } = admin;
    return safeAdmin;
  }

  @Get(':id')
  @AdminRoles(AdminRole.SuperAdmin, AdminRole.Admin)
  @ApiOperation({ summary: "Xodim ma'lumotlarini olish" })
  async findOne(@Param('id') id: string) {
    const admin = await this.service.findById(id);
    const { passwordHash: _, ...safeAdmin } = admin;
    return safeAdmin;
  }

  @Patch(':id')
  @AdminRoles(AdminRole.SuperAdmin)
  @ApiOperation({ summary: "Xodim ma'lumotlarini tahrirlash" })
  async update(@Param('id') id: string, @Body() dto: UpdateAdminUserDto) {
    const admin = await this.service.update(id, dto);
    const { passwordHash: _, ...safeAdmin } = admin;
    return safeAdmin;
  }

  @Patch(':id/status')
  @AdminRoles(AdminRole.SuperAdmin)
  @ApiOperation({ summary: 'Xodim holatini faol/nofaol qilish' })
  async setStatus(
    @Param('id') id: string,
    @Body('isActive') isActive: boolean,
    @CurrentAdmin('id') currentAdminId: string,
  ) {
    const admin = await this.service.setStatus(
      id,
      Boolean(isActive),
      currentAdminId,
    );
    const { passwordHash: _, ...safeAdmin } = admin;
    return safeAdmin;
  }

  @Post(':id/reset-password')
  @AdminRoles(AdminRole.SuperAdmin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Xodim parolini majburiy o'zgartirish (SuperAdmin tomonidan)",
  })
  async resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetAdminPasswordDto,
  ) {
    await this.service.resetPassword(id, dto);
    return { success: true, message: 'Xodim paroli muvaffaqiyatli yangilandi' };
  }
}
