import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators/public.decorator';
import { AdminUser } from '../admin-users/entities/admin-user.entity';
import { AdminAuthService } from './admin-auth.service';
import { CurrentAdmin } from './decorators/current-admin.decorator';
import { AdminChangePasswordDto } from './dto/change-password.dto';
import {
  AdminForgotPasswordRequestDto,
  AdminForgotPasswordResetDto,
} from './dto/forgot-password.dto';
import { AdminLoginDto, AdminRefreshTokenDto } from './dto/admin-login.dto';
import { AdminJwtGuard } from './guards/admin-jwt.guard';

@ApiTags('Admin Auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly authService: AdminAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin panelga username va parol orqali kirish' })
  login(@Body() dto: AdminLoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin refresh token orqali yangi token olish' })
  refresh(@Body() dto: AdminRefreshTokenDto) {
    return this.authService.refreshToken(dto);
  }

  @Get('me')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tizimga kirgan xodim profil ma\'lumotlarini olish' })
  getProfile(@CurrentAdmin() admin: AdminUser) {
    const { passwordHash: _, ...safeAdmin } = admin;
    return safeAdmin;
  }

  @Public()
  @Post('forgot-password/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Parolni unutganda telefon raqamga SMS OTP so\'rash' })
  requestPasswordResetOtp(@Body() dto: AdminForgotPasswordRequestDto) {
    return this.authService.requestPasswordResetOtp(dto);
  }

  @Public()
  @Post('forgot-password/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SMS OTP kod orqali parolni yangilash' })
  verifyPasswordReset(@Body() dto: AdminForgotPasswordResetDto) {
    return this.authService.verifyPasswordReset(dto);
  }

  @Post('change-password')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xodim o\'z parolini o\'zgartirishi' })
  changePassword(
    @CurrentAdmin('id') adminId: string,
    @Body() dto: AdminChangePasswordDto,
  ) {
    return this.authService.changePassword(adminId, dto);
  }
}
