import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
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

  // Authenticated: registers + LINKS this device's token to the logged-in user
  // (attaches a token that may have been registered anonymously before login).
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async register(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RegisterDeviceDto,
  ) {
    await this.push.registerToken(
      user.sub,
      dto.token,
      dto.platform ?? 'android',
    );
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregister(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UnregisterDeviceDto,
  ) {
    await this.push.removeToken(user.sub, dto.token);
  }
}

/** Public device registration — the app registers its token before login. */
@ApiTags('devices')
@Controller('devices')
export class PublicDevicesController {
  constructor(private readonly push: PushService) {}

  @Public()
  @Post('anonymous')
  @HttpCode(HttpStatus.NO_CONTENT)
  async registerAnonymous(@Body() dto: RegisterDeviceDto) {
    await this.push.registerToken(null, dto.token, dto.platform ?? 'android');
  }
}
