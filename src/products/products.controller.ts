import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
