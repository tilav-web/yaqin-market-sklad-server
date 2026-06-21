import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Review } from '../orders/entities/review.entity';
import { PushModule } from '../push/push.module';
import { SettingsModule } from '../settings/settings.module';
import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { User } from '../users/entities/user.entity';
import { GlobalProduct } from './entities/global-product.entity';
import { InventoryMovement } from './entities/inventory-movement.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { StockBatch } from './entities/stock-batch.entity';
import {
  AdminGlobalCatalogController,
  CatalogController,
  GlobalCatalogController,
  SellerCatalogController,
  SellerProductsController,
  SellerProductsExtraController,
} from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductVariant,
      InventoryMovement,
      StockBatch,
      GlobalProduct,
      Shop,
      ShopStaff,
      Review,
      User,
    ]),
    PushModule,
    SettingsModule,
  ],
  controllers: [
    SellerProductsController,
    SellerProductsExtraController,
    SellerCatalogController,
    GlobalCatalogController,
    CatalogController,
    AdminGlobalCatalogController,
  ],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
