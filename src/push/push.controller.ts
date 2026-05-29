import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { PushService } from './push.service';

class RegisterDeviceDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxx]' })
  @IsString()
  @MaxLength(256)
  token!: string;

  @ApiProperty({ required: false, example: 'android' })
  @IsOptional()
  @IsString()
  platform?: string;
}

class UnregisterDeviceDto {
  @ApiProperty()
  @IsString()
  @MaxLength(256)
  token!: string;
}

@ApiBearerAuth()
@ApiTags('devices')
@Controller('users/me/devices')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async register(@CurrentUser() user: JwtPayload, @Body() dto: RegisterDeviceDto) {
    await this.push.registerToken(user.sub, dto.token, dto.platform ?? 'android');
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregister(@Body() dto: UnregisterDeviceDto) {
    await this.push.removeToken(dto.token);
  }
}
