import { MigrationInterface, QueryRunner } from "typeorm";

export class AnalyticsEvents1783326969341 implements MigrationInterface {
    name = 'AnalyticsEvents1783326969341'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."analytics_events_type_enum" AS ENUM('product_view', 'add_to_cart')`);
        await queryRunner.query(`CREATE TABLE "analytics_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" "public"."analytics_events_type_enum" NOT NULL, "userId" uuid, "shopId" uuid NOT NULL, "productVariantId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5d643d67a09b55653e98616f421" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_2eaecd729184255b9128dd851e" ON "analytics_events"  ("shopId", "createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_1413b837e8bec77307f42c3022" ON "analytics_events"  ("type", "createdAt") `);
        await queryRunner.query(`ALTER TABLE "debts" ALTER COLUMN "lines" SET DEFAULT '[]'::jsonb`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "roles" SET DEFAULT '["customer"]'::jsonb`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "favoriteShopIds" SET DEFAULT '[]'::jsonb`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "favoriteProductIds" SET DEFAULT '[]'::jsonb`);
        await queryRunner.query(`ALTER TABLE "notifications" ALTER COLUMN "data" SET DEFAULT '{}'::jsonb`);
        await queryRunner.query(`ALTER TABLE "shops" ALTER COLUMN "photos" SET DEFAULT '[]'::jsonb`);
        await queryRunner.query(`ALTER TABLE "shops" ALTER COLUMN "workingHours" SET DEFAULT '[]'::jsonb`);
        await queryRunner.query(`ALTER TABLE "shops" ALTER COLUMN "holidays" SET DEFAULT '[]'::jsonb`);
        await queryRunner.query(`ALTER TABLE "shops" ALTER COLUMN "deliveryZone" SET DEFAULT '{"maxKm":2,"freeKm":2,"pricingType":"flat","pricePerStep":0}'::jsonb`);
        await queryRunner.query(`ALTER TABLE "shops" ALTER COLUMN "blockedUserIds" SET DEFAULT '[]'::jsonb`);
        await queryRunner.query(`ALTER TABLE "global_products" ALTER COLUMN "photos" SET DEFAULT '[]'::jsonb`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "timeline" SET DEFAULT '[]'::jsonb`);
        await queryRunner.query(`ALTER TABLE "shop_staff" ALTER COLUMN "permissions" SET DEFAULT '[]'::jsonb`);
        await queryRunner.query(`ALTER TABLE "staff_invitations" ALTER COLUMN "permissions" SET DEFAULT '[]'::jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "staff_invitations" ALTER COLUMN "permissions" SET DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "shop_staff" ALTER COLUMN "permissions" SET DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "timeline" SET DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "global_products" ALTER COLUMN "photos" SET DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "shops" ALTER COLUMN "blockedUserIds" SET DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "shops" ALTER COLUMN "deliveryZone" SET DEFAULT '{"maxKm": 2, "freeKm": 2, "pricingType": "flat", "pricePerStep": 0}'`);
        await queryRunner.query(`ALTER TABLE "shops" ALTER COLUMN "holidays" SET DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "shops" ALTER COLUMN "workingHours" SET DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "shops" ALTER COLUMN "photos" SET DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "notifications" ALTER COLUMN "data" SET DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "favoriteProductIds" SET DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "favoriteShopIds" SET DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "roles" SET DEFAULT '["customer"]'`);
        await queryRunner.query(`ALTER TABLE "debts" ALTER COLUMN "lines" SET DEFAULT '[]'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1413b837e8bec77307f42c3022"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2eaecd729184255b9128dd851e"`);
        await queryRunner.query(`DROP TABLE "analytics_events"`);
        await queryRunner.query(`DROP TYPE "public"."analytics_events_type_enum"`);
    }

}
