import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import {
  AdjustStockDto,
  CreateProductFamilyDto,
  CreateProductVariantDto,
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
  listVariants(@Param('shopId', ParseUUIDPipe) shopId: string) {
    return this.products.listVariants(shopId);
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
  feed(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.products.feedNearby({
      latitude: Number(lat),
      longitude: Number(lng),
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      q,
      categoryId,
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
