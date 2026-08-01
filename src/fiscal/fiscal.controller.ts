import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/role.enum';
import {
  FiscalReceiptStatus,
  FiscalReceiptType,
} from './entities/fiscal-receipt.entity';
import {
  AssignTaxCategoryDto,
  CreateTaxCategoryDto,
  UpdateTaxCategoryDto,
} from './dto/fiscal.dto';
import { FiscalService } from './fiscal.service';

@ApiBearerAuth()
@ApiTags('admin-fiscal')
@Controller('admin/fiscal')
@Roles(Role.Admin)
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}

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
}
