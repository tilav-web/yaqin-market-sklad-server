import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/decorators/current-user.decorator';
import { ConfirmImportDto, DateRangeQueryDto, InventoryExportQueryDto } from './dto/excel.dto';
import { ExcelService, XLSX_CONTENT_TYPE } from './excel.service';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB

@ApiBearerAuth()
@ApiTags('seller-excel')
@Controller('seller/shops/:shopId/products/excel')
export class ExcelController {
  constructor(private readonly excel: ExcelService) {}

  @Get('template')
  async template(@Res() res: Response) {
    const buf = await this.excel.downloadTemplate();
    sendXlsx(res, buf, 'shablon.xlsx');
  }

  @Get('export/inventory')
  async exportInventory(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Query() query: InventoryExportQueryDto,
    @Res() res: Response,
  ) {
    const buf = await this.excel.exportInventory(user.sub, shopId, query);
    sendXlsx(res, buf, 'sklad-holati.xlsx');
  }

  @Get('export/orders')
  async exportOrders(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Query() query: DateRangeQueryDto,
    @Res() res: Response,
  ) {
    const buf = await this.excel.exportOrders(user.sub, shopId, query.from, query.to);
    sendXlsx(res, buf, 'buyurtmalar.xlsx');
  }

  @Get('export/movements')
  async exportMovements(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Query() query: DateRangeQueryDto,
    @Res() res: Response,
  ) {
    const buf = await this.excel.exportMovements(user.sub, shopId, query.from, query.to);
    sendXlsx(res, buf, 'kirim-chiqim-tarixi.xlsx');
  }

  /** Upload a filled-in `.xlsx` for validation — does NOT create anything yet. */
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES } }))
  async previewImport(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('Fayl yuborilmadi');
    return this.excel.previewImport(user.sub, shopId, file.buffer);
  }

  /** Commit the (optionally seller-edited) rows returned by preview. */
  @Post('import/confirm')
  async confirmImport(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: ConfirmImportDto,
  ) {
    return this.excel.confirmImport(user.sub, shopId, dto.rows);
  }
}

function sendXlsx(res: Response, buf: Buffer, filename: string): void {
  res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
}
