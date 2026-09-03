import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { Role } from '../auth/role.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { SetSettingValueDto } from './dto/setting.dto';
import { SettingsService } from './settings.service';

@Controller('admin/settings')
@Roles(Role.Admin)
export class SettingsController {
  constructor(private readonly svc: SettingsService) {}

  @Get()
  getAll() {
    return this.svc.getAll();
  }

  /**
   * Marja-kalkulyator: admin panel komissiya maydonini o'zgartirganda shu
   * endpoint bilan jonli breakdown/ogohlantirish ko'rsatadi.
   * ?commission=2 — saqlanmagan qiymatni sinab ko'rish; bo'sh — joriy sozlama.
   */
  @Get('economics')
  economics(@Query('commission') commission?: string) {
    const n =
      commission != null && commission.trim() !== ''
        ? Number(commission)
        : undefined;
    return this.svc.computeEconomics(Number.isFinite(n) ? n : undefined);
  }

  /**
   * Davlat Soliq & E-IMZO integratsiyasi holati
   */
  @Get('soliq/status')
  getSoliqStatus() {
    return this.svc.getSoliqStatus();
  }

  /**
   * E-IMZO (.pfx / .p12) kalit faylini va parolini yuklash
   */
  @Post('soliq/upload-key')
  @UseInterceptors(FileInterceptor('file'))
  uploadSoliqKey(
    @UploadedFile() file: Express.Multer.File,
    @Body('password') password: string,
    @Body('operatorTin') operatorTin?: string,
  ) {
    return this.svc.saveSoliqKey(
      file.buffer,
      file.originalname,
      password,
      operatorTin,
    );
  }

  /**
   * Soliq API sessiya/Bearer tokenini qo'lda yoki brauzer orqali saqlash
   */
  @Post('soliq/set-token')
  setSoliqToken(
    @Body('token') token: string,
    @Body('expiresInHours') expiresInHours?: number,
  ) {
    return this.svc.setSoliqToken(token, expiresInHours);
  }

  /**
   * Davlat Soliq ulanishini va STIR tekshirishni test qilish
   */
  @Get('soliq/test')
  testSoliqConnection(
    @Query('tin') tin?: string,
    @Query('token') token?: string,
  ) {
    return this.svc.testSoliqConnection(tin, token);
  }

  /**
   * Sotuvchilar uchun ommaviy oferta PDF shartnomasini yuklash
   */
  @Post('upload-oferta-pdf')
  @UseInterceptors(FileInterceptor('file'))
  uploadOfertaPdf(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('PDF fayl tanlanmadi');
    return this.svc.uploadOfertaPdf(file.buffer, file.originalname);
  }

  @Put(':key')
  set(@Param('key') key: string, @Body() body: SetSettingValueDto) {
    return this.svc.set(key, body.value, body.force ?? false);
  }
}
