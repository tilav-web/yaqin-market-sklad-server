import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { FeedQueryDto } from './dto/feed-query.dto';
import {
  AdjustStockDto,
  CountStockDto,
  CreateProductFamilyDto,
  CreateProductVariantDto,
  ReceiveStockDto,
  UpdateProductVariantDto,
} from './dto/product.dto';
import { ProductsService } from './products.service';

@ApiBearerAuth()
@ApiTags('seller-products')
@Controller('seller/shops/:shopId/products')
export class SellerProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('families')
  listFamilies(@Param('shopId', ParseUUIDPipe) shopId: string) {
    return this.products.listFamilies(shopId);
  }

  @Post('families')
  createFamily(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: CreateProductFamilyDto,
  ) {
    return this.products.createFamily(user.sub, shopId, dto);
  }

  @Get('variants')
  listVariants(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('lowOnly') lowOnly?: string,
  ) {
    return this.products.listVariantsWithCost(user.sub, shopId, {
      search,
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
      lowOnly: lowOnly === 'true' || lowOnly === '1',
    });
  }

  @Post('variants')
  createVariant(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: CreateProductVariantDto,
  ) {
    return this.products.createVariant(user.sub, shopId, dto);
  }

  @Patch('variants/:variantId')
  updateVariant(
    @CurrentUser() user: JwtPayload,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateProductVariantDto,
  ) {
    return this.products.updateVariant(user.sub, variantId, dto);
  }

  @Delete('variants/:variantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteVariant(
    @CurrentUser() user: JwtPayload,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.products.deleteVariant(user.sub, variantId);
  }

  @Post('variants/:variantId/stock')
  adjustStock(
    @CurrentUser() user: JwtPayload,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: AdjustStockDto,
  ) {
    return this.products.adjustStock(user.sub, variantId, dto.delta, dto.reason);
  }

  // Formal stock receipt with cost ("Kirim") — creates a FIFO batch.
  @Post('variants/:variantId/receive')
  receiveStock(
    @CurrentUser() user: JwtPayload,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: ReceiveStockDto,
  ) {
    return this.products.receiveStock(user.sub, variantId, dto);
  }

  // Inventarizatsiya — set stock to a counted number, reconciled via FIFO.
  @Post('variants/:variantId/count')
  countStock(
    @CurrentUser() user: JwtPayload,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: CountStockDto,
  ) {
    return this.products.countStock(user.sub, variantId, dto.actualQty);
  }

  @Get('variants/:variantId/batches')
  listBatches(
    @CurrentUser() user: JwtPayload,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.products.listBatches(user.sub, variantId);
  }

  @Get('variants/:variantId/movements')
  listMovements(
    @CurrentUser() user: JwtPayload,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.products.listMovements(user.sub, variantId);
  }

  @Get('low-stock')
  listLowStock(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
  ) {
    return this.products.listLowStock(user.sub, shopId);
  }

  @Get('reviews')
  listReviews(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
  ) {
    return this.products.listShopReviews(user.sub, shopId);
  }
}

@ApiBearerAuth()
@ApiTags('global-catalog')
@Controller('catalog-global')
export class GlobalCatalogController {
  constructor(private readonly products: ProductsService) {}

  /** Scan a barcode → shared catalogue entry (name/brand/photo/unit) or 404. */
  @Get('by-barcode/:barcode')
  async byBarcode(@Param('barcode') barcode: string) {
    const found = await this.products.lookupGlobalByBarcode(barcode);
    if (!found) throw new NotFoundException('Bu barkod katalogda topilmadi');
    return found;
  }
}

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly products: ProductsService) {}

  /**
   * Global product feed for the customer Home tab.
   * Returns products from every shop whose delivery zone reaches `lat`/`lng`,
   * decorated with shop name, distance and computed delivery fee.
   */
  @Public()
  @Get('products')
  feed(@Query() query: FeedQueryDto) {
    let categoryIds: string[] = [];
    if (query.categoryIds) {
      categoryIds = query.categoryIds.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (query.categoryId) {
      categoryIds = [query.categoryId];
    }
    return this.products.feedNearby({
      latitude: query.lat,
      longitude: query.lng,
      page: query.page,
      limit: query.limit,
      q: query.q,
      categoryIds,
      sort: query.sort,
      onlyDiscounted: query.onlyDiscounted,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
    });
  }

  @Public()
  @Get('products/:variantId')
  variantDetail(@Param('variantId', ParseUUIDPipe) variantId: string) {
    return this.products.getVariantDetail(variantId);
  }

  @Public()
  @Get('products/:variantId/reviews')
  variantReviews(@Param('variantId', ParseUUIDPipe) variantId: string) {
    return this.products.listVariantReviews(variantId);
  }

  @Public()
  @Get('shops/:shopId/products')
  shopCatalog(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.products.listShopCatalog(shopId, q, categoryId);
  }

  @Public()
  @Get('shops/:shopId/products/families/:familyId/variants')
  familyVariants(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('familyId', ParseUUIDPipe) familyId: string,
  ) {
    return this.products.getVariantsFromFamily(shopId, familyId);
  }
}

// ─── Seller: katalog + kengaytirilgan sklad operatsiyalari ───────────────────

@ApiBearerAuth()
@ApiTags('seller-catalog')
@Controller('seller/shops/:shopId/catalog')
export class SellerCatalogController {
  constructor(private readonly products: ProductsService) {}

  @Get('search')
  searchGlobal(@Query('q') q = '', @Query('limit') limit = '20') {
    return this.products.searchGlobalCatalog(q, Number(limit));
  }

  @Post('clone')
  cloneFromCatalog(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: {
      globalProductId: string;
      price: number;
      stock: number;
      costPrice?: number;
      discountPrice?: number;
      expiryDate?: string;
      lowStockThreshold?: number;
      criticalThreshold?: number;
    },
  ) {
    return this.products.cloneFromGlobalCatalog(user.sub, shopId, dto);
  }
}

@ApiBearerAuth()
@ApiTags('seller-products-extra')
@Controller('seller/shops/:shopId/products')
export class SellerProductsExtraController {
  constructor(private readonly products: ProductsService) {}

  @Post('variants/:variantId/duplicate')
  duplicate(
    @CurrentUser() user: JwtPayload,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.products.duplicateVariant(user.sub, variantId);
  }

  @Post('bulk-price')
  bulkPrice(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: {
      scope: 'all' | 'category' | 'selected';
      categoryId?: string;
      variantIds?: string[];
      adjustType: 'percent' | 'fixed';
      adjustValue: number;
      direction: 'increase' | 'decrease';
    },
  ) {
    return this.products.bulkPriceUpdate(user.sub, shopId, dto);
  }

  @Get('expiring')
  listExpiring(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Query('days') days?: string,
  ) {
    return this.products.listExpiring(user.sub, shopId, days ? Number(days) : undefined);
  }
}

// ─── Admin: Global katalog boshqaruvi ────────────────────────────────────────

@ApiBearerAuth()
@ApiTags('admin-catalog')
@Controller('admin/catalog')
export class AdminGlobalCatalogController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.products.adminListGlobalProducts({
      q,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      activeOnly: activeOnly === 'true',
    });
  }

  @Post()
  create(@Body() dto: {
    name: string;
    barcode?: string;
    brand?: string;
    categoryId?: string;
    defaultUnitType?: 'piece' | 'kg' | 'liter' | 'gram' | 'pack';
    defaultUnitSize?: number;
    photos?: string[];
    description?: string;
    groupName?: string;
  }) {
    return this.products.adminCreateGlobalProduct(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<{
      name: string;
      barcode: string | null;
      brand: string | null;
      categoryId: string | null;
      defaultUnitType: 'piece' | 'kg' | 'liter' | 'gram' | 'pack';
      defaultUnitSize: number;
      photos: string[];
      description: string | null;
      groupName: string | null;
      isActive: boolean;
    }>,
  ) {
    return this.products.adminUpdateGlobalProduct(id, dto);
  }

  @Get(':id/stats')
  stats(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.adminGetGlobalProductStats(id);
  }
}
