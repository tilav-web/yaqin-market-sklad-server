import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNormalizedFavoritesAndCleanUserSchema1788400000000 implements MigrationInterface {
  name = 'CreateNormalizedFavoritesAndCleanUserSchema1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create user_favorite_shops table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_favorite_shops" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "shopId" uuid NOT NULL,
        "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_favorite_shops_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_favorite_shops_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_favorite_shops_shop" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_user_favorite_shops_user_shop" UNIQUE ("userId", "shopId")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_favorite_shops_shopId" ON "user_favorite_shops" ("shopId");`,
    );

    // 2. Create user_favorite_products table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_favorite_products" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "productId" uuid NOT NULL,
        "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_favorite_products_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_favorite_products_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_favorite_products_product" FOREIGN KEY ("productId") REFERENCES "product_variants"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_user_favorite_products_user_product" UNIQUE ("userId", "productId")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_favorite_products_productId" ON "user_favorite_products" ("productId");`,
    );

    // 3. Drop deprecated columns from users table
    await queryRunner.query(`
      ALTER TABLE "users" 
        DROP COLUMN IF EXISTS "favoriteShopIds",
        DROP COLUMN IF EXISTS "favoriteProductIds",
        DROP COLUMN IF EXISTS "courierRatingAverage",
        DROP COLUMN IF EXISTS "courierRatingCount",
        DROP COLUMN IF EXISTS "isSellerApproved",
        DROP COLUMN IF EXISTS "isAdmin";
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_favorite_products";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_favorite_shops";`);
  }
}
