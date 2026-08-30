import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../auth/decorators/public.decorator';
import { UploadsService } from './uploads.service';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  // Authenticated: upload an image, returns a public URL served back via this API.
  @ApiBearerAuth()
  @Post('image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadImage(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ url: string }> {
    if (!file) throw new BadRequestException('Fayl yuborilmadi');
    if (!ALLOWED.includes(file.mimetype)) {
      throw new BadRequestException('Faqat JPG, PNG yoki WEBP rasm');
    }
    const key = await this.uploads.upload(file.buffer, file.mimetype);
    // Host-independent path. The client resolves it against its current API
    // host, so images survive host/network changes and app restarts.
    return { url: `/api/uploads/${key}` };
  }

  // Public: stream the image so <Image> tags can load it without auth.
  // Wildcard so nested keys work too (e.g. seed/shop-0.jpg, apk/...).
  @Public()
  @Get('*key')
  async getImage(
    @Param('key') key: string | string[],
    @Res() res: Response,
  ): Promise<void> {
    const objectKey = Array.isArray(key) ? key.join('/') : key;
    try {
      const { stream, contentType, size } =
        await this.uploads.getObject(objectKey);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', size);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      stream.pipe(res);
    } catch {
      throw new NotFoundException('Rasm topilmadi');
    }
  }
}
