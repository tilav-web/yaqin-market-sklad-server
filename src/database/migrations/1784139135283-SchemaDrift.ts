import { MigrationInterface, QueryRunner } from "typeorm";

export class SchemaDrift1784139135283 implements MigrationInterface {
    name = 'SchemaDrift1784139135283'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."admin_audit_logs_action_enum" AS ENUM('user_promoted', 'user_demoted', 'user_blocked', 'user_unblocked', 'shop_activated', 'shop_deactivated', 'balance_adjusted', 'transaction_force_settled', 'transaction_force_refunded', 'debt_forgiven', 'debt_extended', 'prime_subscription_extended', 'order_commission_exempted', 'order_commission_exempt_removed')`);
        await queryRunner.query(`CREATE TABLE "admin_audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "adminUserId" uuid NOT NULL, "action" "public"."admin_audit_logs_action_enum" NOT NULL, "targetType" character varying(32) NOT NULL, "targetId" uuid, "reason" text, "metadata" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_de7a8fc2fbb525484c71a86bb96" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_51f63a5b02e9c59bf8641564c5" ON "admin_audit_logs"  ("createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_a414f493b967837453f2bac395" ON "admin_audit_logs"  ("targetType", "targetId") `);
        await queryRunner.query(`CREATE TABLE "payable_charges" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shopId" uuid NOT NULL, "accountId" uuid NOT NULL, "amount" integer NOT NULL, "description" character varying(256), "dueDate" date, "note" text, "createdByUserId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b06207c1da13fee8ff87ab0a601" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_630a84c60f55c38d55a640b5a4" ON "payable_charges"  ("shopId", "accountId") `);
        await queryRunner.query(`CREATE INDEX "IDX_bfa9e1b77dac64d0faeed6925b" ON "payable_charges"  ("shopId") `);
        await queryRunner.query(`CREATE TABLE "payable_payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shopId" uuid NOT NULL, "accountId" uuid NOT NULL, "amount" integer NOT NULL, "note" text, "createdByUserId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_804a7db274670a10807209d4e8b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3754e4d770e4252c36c9ab7242" ON "payable_payments"  ("shopId", "accountId") `);
        await queryRunner.query(`CREATE INDEX "IDX_235300f1f0c04e0fef5cc58b06" ON "payable_payments"  ("shopId") `);
        await queryRunner.query(`CREATE TABLE "supplier_accounts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shopId" uuid NOT NULL, "name" character varying(128) NOT NULL, "category" character varying(24) NOT NULL, "phone" character varying(32), "note" text, "isArchived" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e02bcf29da65cc92cc9156c40f0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_22a1c93e77420db3d1d40a03dc" ON "supplier_accounts"  ("shopId") `);
        await queryRunner.query(`CREATE TABLE "shop_staff_presets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shopId" uuid NOT NULL, "name" character varying(64) NOT NULL, "permissions" jsonb NOT NULL DEFAULT '[]'::jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_b394f8df67071d269923ead99e5" UNIQUE ("shopId", "name"), CONSTRAINT "PK_3285f71233d37dfb7cdef8e75b0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_be8f328e921693e960f8891444" ON "shop_staff_presets"  ("shopId") `);
        await queryRunner.query(`ALTER TABLE "product_variants" ADD "lastLowStockAlertAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "product_variants" ADD "lastExpiryAlertAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "commissionRateSnapshot" double precision`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "commissionExempt" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "reviewReminderSentAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "paidUnacceptedAlertSentAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "inventory_movements" ADD "beforePrice" integer`);
        await queryRunner.query(`ALTER TABLE "inventory_movements" ADD "afterPrice" integer`);
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
        await queryRunner.query(`ALTER TYPE "public"."inventory_movements_type_enum" ADD VALUE 'price_changed'`);
        await queryRunner.query(`ALTER TABLE "shop_staff" ALTER COLUMN "permissions" SET DEFAULT '[]'::jsonb`);
        await queryRunner.query(`ALTER TABLE "staff_invitations" ALTER COLUMN "permissions" SET DEFAULT '[]'::jsonb`);
        await queryRunner.query(`ALTER TABLE "shop_staff_presets" ADD CONSTRAINT "FK_be8f328e921693e960f8891444a" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "shop_staff_presets" DROP CONSTRAINT "FK_be8f328e921693e960f8891444a"`);
        await queryRunner.query(`ALTER TABLE "staff_invitations" ALTER COLUMN "permissions" SET DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "shop_staff" ALTER COLUMN "permissions" SET DEFAULT '[]'`);
        await queryRunner.query(`CREATE TYPE "public"."inventory_movements_type_enum_old" AS ENUM('in', 'sold', 'returned', 'expired', 'adjusted', 'damaged')`);
        await queryRunner.query(`ALTER TABLE "inventory_movements" ALTER COLUMN "type" TYPE "public"."inventory_movements_type_enum_old" USING "type"::"text"::"public"."inventory_movements_type_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."inventory_movements_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."inventory_movements_type_enum_old" RENAME TO "inventory_movements_type_enum"`);
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
        await queryRunner.query(`ALTER TABLE "inventory_movements" DROP COLUMN "afterPrice"`);
        await queryRunner.query(`ALTER TABLE "inventory_movements" DROP COLUMN "beforePrice"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "paidUnacceptedAlertSentAt"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "reviewReminderSentAt"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "commissionExempt"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "commissionRateSnapshot"`);
        await queryRunner.query(`ALTER TABLE "product_variants" DROP COLUMN "lastExpiryAlertAt"`);
        await queryRunner.query(`ALTER TABLE "product_variants" DROP COLUMN "lastLowStockAlertAt"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_be8f328e921693e960f8891444"`);
        await queryRunner.query(`DROP TABLE "shop_staff_presets"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_22a1c93e77420db3d1d40a03dc"`);
        await queryRunner.query(`DROP TABLE "supplier_accounts"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_235300f1f0c04e0fef5cc58b06"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3754e4d770e4252c36c9ab7242"`);
        await queryRunner.query(`DROP TABLE "payable_payments"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bfa9e1b77dac64d0faeed6925b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_630a84c60f55c38d55a640b5a4"`);
        await queryRunner.query(`DROP TABLE "payable_charges"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a414f493b967837453f2bac395"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_51f63a5b02e9c59bf8641564c5"`);
        await queryRunner.query(`DROP TABLE "admin_audit_logs"`);
        await queryRunner.query(`DROP TYPE "public"."admin_audit_logs_action_enum"`);
    }

}
