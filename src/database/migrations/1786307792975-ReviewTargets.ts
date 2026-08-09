import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Anti-fraud/customer-signal layer, phase 3: reviews can now target the
 * courier or the shop's delivery experience, not just a product.
 * `productVariantId` becomes nullable (only set for target='product');
 * `courierUserId`/`shopId` are the equivalents for the other two targets.
 * Existing rows backfill to target='product' via the column default — they
 * already all had a productVariantId, so nothing else changes for them.
 *
 * Shop.ratingAverage/ratingCount are LEFT UNTOUCHED (still product-review
 * derived) — the new serviceRatingAverage/serviceRatingCount pair is a
 * separate, additive signal for the shop/delivery experience specifically,
 * so introducing this doesn't retroactively zero out any shop's existing
 * product-quality rating.
 */
export class ReviewTargets1786307792975 implements MigrationInterface {
    name = 'ReviewTargets1786307792975'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "reviews_target_enum" AS ENUM('product', 'courier', 'shop')`);
        await queryRunner.query(`ALTER TABLE "reviews" ADD "target" "reviews_target_enum" NOT NULL DEFAULT 'product'`);
        await queryRunner.query(`ALTER TABLE "reviews" ALTER COLUMN "productVariantId" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "reviews" ADD "courierUserId" uuid`);
        await queryRunner.query(`ALTER TABLE "reviews" ADD "shopId" uuid`);
        await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "FK_reviews_courierUserId" FOREIGN KEY ("courierUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "FK_reviews_shopId" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE INDEX "IDX_reviews_courierUserId" ON "reviews" ("courierUserId")`);
        await queryRunner.query(`CREATE INDEX "IDX_reviews_shopId" ON "reviews" ("shopId")`);

        await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT "UQ_b1232b6a0f3690cb66b823eeadd"`);
        await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "UQ_reviews_user_order_target_variant" UNIQUE ("userId", "orderId", "target", "productVariantId")`);

        await queryRunner.query(`ALTER TABLE "users" ADD "courierRatingAverage" double precision`);
        await queryRunner.query(`ALTER TABLE "users" ADD "courierRatingCount" integer NOT NULL DEFAULT 0`);

        await queryRunner.query(`ALTER TABLE "shops" ADD "serviceRatingAverage" double precision`);
        await queryRunner.query(`ALTER TABLE "shops" ADD "serviceRatingCount" integer NOT NULL DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "shops" DROP COLUMN "serviceRatingCount"`);
        await queryRunner.query(`ALTER TABLE "shops" DROP COLUMN "serviceRatingAverage"`);

        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "courierRatingCount"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "courierRatingAverage"`);

        await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT "UQ_reviews_user_order_target_variant"`);
        // Rows with target != 'product' can't satisfy the old constraint's
        // implicit NOT NULL productVariantId — callers must delete/backfill
        // them before rolling back this migration.
        await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "UQ_b1232b6a0f3690cb66b823eeadd" UNIQUE ("userId", "productVariantId", "orderId")`);

        await queryRunner.query(`DROP INDEX "IDX_reviews_shopId"`);
        await queryRunner.query(`DROP INDEX "IDX_reviews_courierUserId"`);
        await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT "FK_reviews_shopId"`);
        await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT "FK_reviews_courierUserId"`);
        await queryRunner.query(`ALTER TABLE "reviews" DROP COLUMN "shopId"`);
        await queryRunner.query(`ALTER TABLE "reviews" DROP COLUMN "courierUserId"`);
        await queryRunner.query(`ALTER TABLE "reviews" ALTER COLUMN "productVariantId" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "reviews" DROP COLUMN "target"`);
        await queryRunner.query(`DROP TYPE "reviews_target_enum"`);
    }

}
