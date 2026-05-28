import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Review } from '../orders/entities/review.entity';
import { Shop } from '../shops/entities/shop.entity';
import { InventoryMovement } from './entities/inventory-movement.entity';
import { ProductFamily } from './entities/product-family.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { CatalogController, SellerProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProductFamily, ProductVariant, InventoryMovement, Shop, Review])],
  controllers: [SellerProductsController, CatalogController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
