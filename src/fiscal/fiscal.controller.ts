import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/role.enum';
import { sendXlsx } from '../common/xlsx.util';
import {
  FiscalReceiptStatus,
  FiscalReceiptType,
} from './entities/fiscal-receipt.entity';
import {
  ApplyTasnifDto,
  AssignTaxCategoryDto,
  CreateTaxCategoryDto,
  ExportTaxExcelDto,
  SubmitTaxReportDto,
  UpdateTaxCategoryDto,
} from './dto/fiscal.dto';
import { FiscalService } from './fiscal.service';
import { SoliqSyncService } from './soliq-sync.service';
import { TasnifService } from './tasnif.service';

@ApiBearerAuth()
@ApiTags('admin-fiscal')
@Controller('admin/fiscal')
@Roles(Role.Admin)
export class FiscalController {
  constructor(
    private readonly fiscal: FiscalService,
    private readonly tasnif: TasnifService,
    private readonly soliqSync: SoliqSyncService,
  ) {}

  /* ─── Cheklar ─── */

  @Get('receipts')
  listReceipts(
    @Query('status') status?: FiscalReceiptStatus,
    @Query('type') type?: FiscalReceiptType,
    @Query('orderId') orderId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.fiscal.listReceipts({
      status,
      type,
      orderId,
      page: page ? parseInt(page, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 30,
    });
  }

  @Get('receipts/stats')
  stats() {
    return this.fiscal.stats();
  }

  @Get('receipts/:id')
  getReceipt(@Param('id', ParseUUIDPipe) id: string) {
    return this.fiscal.getReceipt(id);
  }

  /** MXIK/STIR to'ldirilgandan keyin incomplete chekni qayta qurish. */
  @Post('receipts/:id/rebuild')
  rebuild(@Param('id', ParseUUIDPipe) id: string) {
    return this.fiscal.rebuildReceipt(id);
  }

  /* ─── Soliq toifalari (MXIK katalogi) ─── */

  @Get('tax-categories')
  listTaxCategories() {
    return this.fiscal.listTaxCategories();
  }

  @Post('tax-categories')
  createTaxCategory(@Body() dto: CreateTaxCategoryDto) {
    return this.fiscal.createTaxCategory(dto);
  }

  @Patch('tax-categories/:id')
  updateTaxCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaxCategoryDto,
  ) {
    return this.fiscal.updateTaxCategory(id, dto);
  }

  /* ─── Mahsulot ↔ toifa biriktirish ─── */

  @Get('products-missing-tax-info')
  productsMissingTaxInfo(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.fiscal.productsMissingTaxInfo(
      page ? parseInt(page, 10) : 0,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Patch('products/:globalProductId/tax-category')
  assignTaxCategory(
    @Param('globalProductId', ParseUUIDPipe) globalProductId: string,
    @Body() dto: AssignTaxCategoryDto,
  ) {
    return this.fiscal.assignTaxCategory(
      globalProductId,
      dto.taxCategoryId ?? null,
    );
  }

  /* ─── Tasnif (soliq katalogi) qidiruv va taklif ─── */

  /** Erkin qidiruv — toifa yaratishda MXIK topish uchun. */
  @Get('tasnif-search')
  tasnifSearch(@Query('text') text: string) {
    if (!text?.trim()) throw new BadRequestException('text parametri kerak');
    return this.tasnif.search(text, 10);
  }

  /** Mahsulot uchun taklif: barcode bo'yicha aniq, bo'lmasa nomi bo'yicha. */
  @Get('products/:globalProductId/tasnif-suggest')
  async tasnifSuggest(
    @Param('globalProductId', ParseUUIDPipe) globalProductId: string,
  ) {
    const product = await this.fiscal.getGlobalProduct(globalProductId);
    const nameStr =
      typeof product.name === 'object' ? product.name?.uz || '' : product.name;
    return this.tasnif.suggestForProduct({
      barcode: product.barcode,
      name: nameStr,
    });
  }

  /** Taklifni bir bosishda qo'llash: toifa (topilsa mavjudi) + biriktirish. */
  @Post('products/:globalProductId/apply-tasnif')
  applyTasnif(
    @Param('globalProductId', ParseUUIDPipe) globalProductId: string,
    @Body() dto: ApplyTasnifDto,
  ) {
    return this.fiscal.applyTasnifSuggestion(globalProductId, dto);
  }

  /* ─── MCHJ Soliq Hisobotlari & Taqvim ─── */

  /** Soliq taqvimi, yaqinlashayotgan muddatlar va MCHJ holati */
  @Get('tax-reports/calendar')
  getTaxCalendar() {
    return this.fiscal.getTaxCalendar();
  }

  /** Direktor (yagona xodim) 0.25 stavka oylik va soliqlari hisob-kitobi */
  @Get('tax-reports/calculate-salary')
  calculateSalary(
    @Query('baseSalary') baseSalary?: string,
    @Query('rate') rate?: string,
  ) {
    return this.fiscal.calculateSalaryTax({
      baseSalary: baseSalary ? parseFloat(baseSalary) : undefined,
      rate: rate ? parseFloat(rate) : undefined,
    });
  }

  /** Oylik/Kvartallik Foyda solig'i va QQS hisob-kitobi */
  @Get('tax-reports/calculate-profit-vat')
  calculateProfitVat(
    @Query('period') period?: string,
    @Query('additionalExpenses') additionalExpenses?: string,
    @Query('manualRevenue') manualRevenue?: string,
  ) {
    return this.fiscal.calculateProfitAndVat({
      period,
      additionalExpenses: additionalExpenses
        ? parseFloat(additionalExpenses)
        : undefined,
      manualRevenue: manualRevenue ? parseFloat(manualRevenue) : undefined,
    });
  }

  /** To'ldirilgan hisobotni topshirilgan deb tasdiqlash va saqlash */
  @Post('tax-reports/submit')
  submitTaxReport(@Body() dto: SubmitTaxReportDto) {
    return this.fiscal.submitTaxReport(dto);
  }

  /** Topshirilgan hisobotlar tarixi va arxivi */
  @Get('tax-reports/history')
  getTaxReportHistory() {
    return this.fiscal.getTaxReportHistory();
  }

  /** Soliq 11101_20 shablonini to'ldirilgan holda Excel (.xlsx) sifatida yuklab olish */
  @Post('tax-reports/export-excel')
  async exportTaxExcel(@Body() dto: ExportTaxExcelDto, @Res() res: Response) {
    const buf = await this.fiscal.generate11101Excel(dto);
    sendXlsx(res, buf, `soliq_11101_20_${dto.period || 'hisobot'}.xlsx`);
  }

  /** my.soliq.uz bilan E-IMZO kaliti orqali live hisobotlar holatini sinxronlash */
  @Get('tax-reports/sync-soliq')
  @Post('tax-reports/sync-soliq')
  syncSoliq() {
    return this.soliqSync.syncReportStatuses();
  }
}
