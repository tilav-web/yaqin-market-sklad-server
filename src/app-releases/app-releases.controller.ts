import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../auth/role.enum';
import { AppReleasesService } from './app-releases.service';
import { CreateReleaseDto } from './dto/app-release.dto';

const APK_MAX_BYTES = 200 * 1024 * 1024; // 200 MB

@ApiTags('app-releases')
@Controller('app-releases')
export class AppReleasesController {
  constructor(private readonly releases: AppReleasesService) {}

  // Public: latest version metadata for the download button.
  @Public()
  @Get('latest')
  async latest() {
    const r = await this.releases.getLatest();
    if (!r) return null;
    return {
      id: r.id,
      version: r.version,
      notes: r.notes,
      sizeBytes: r.sizeBytes,
      createdAt: r.createdAt,
      downloadUrl: '/api/app-releases/latest/download',
    };
  }

  // Public: stream the latest APK binary as a file download.
  @Public()
  @Get('latest/download')
  async download(@Res() res: Response): Promise<void> {
    const r = await this.releases.getLatest();
    if (!r) throw new NotFoundException('Hozircha versiya mavjud emas');
    const { stream, size } = await this.releases.getApkStream(r.fileKey);
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Length', size);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="yaqin-market-${r.version}.apk"`,
    );
    stream.pipe(res);
  }
}

@ApiBearerAuth()
@ApiTags('admin-app-releases')
@UseGuards(RolesGuard)
@Roles(Role.Admin)
@Controller('admin/app-releases')
export class AdminAppReleasesController {
  constructor(private readonly releases: AppReleasesService) {}

  @Get()
  list() {
    return this.releases.list();
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: APK_MAX_BYTES } }))
  async create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateReleaseDto,
  ) {
    if (!file) throw new BadRequestException('APK fayli yuborilmadi');
    const name = file.originalname?.toLowerCase() ?? '';
    if (!name.endsWith('.apk') && file.mimetype !== 'application/vnd.android.package-archive') {
      throw new BadRequestException('Faqat .apk fayl yuklash mumkin');
    }
    return this.releases.create(dto.version, dto.notes, file.buffer);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.releases.remove(id);
  }
}
