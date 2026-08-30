import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderComplaints1783326705653 implements MigrationInterface {
  name = 'OrderComplaints1783326705653';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."order_complaints_status_enum" AS ENUM('open', 'resolved')`,
    );
    await queryRunner.query(
      `CREATE TABLE "order_complaints" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "customerId" uuid NOT NULL, "shopId" uuid NOT NULL, "reason" character varying(256) NOT NULL, "description" text, "status" "public"."order_complaints_status_enum" NOT NULL DEFAULT 'open', "resolution" text, "resolvedByAdminId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "resolvedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ef3e87f5fc7797546c819035e4c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fa8cff72bbab578a03022d9c95" ON "order_complaints"  ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0d21708188f6d995f637b08a07" ON "order_complaints"  ("shopId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9b75df80c67bf2d8380f57b4f9" ON "order_complaints"  ("orderId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "debts" ALTER COLUMN "lines" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "roles" SET DEFAULT '["customer"]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "favoriteShopIds" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "favoriteProductIds" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ALTER COLUMN "data" SET DEFAULT '{}'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "shops" ALTER COLUMN "photos" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "shops" ALTER COLUMN "workingHours" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "shops" ALTER COLUMN "holidays" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "shops" ALTER COLUMN "deliveryZone" SET DEFAULT '{"maxKm":2,"freeKm":2,"pricingType":"flat","pricePerStep":0}'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "shops" ALTER COLUMN "blockedUserIds" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "global_products" ALTER COLUMN "photos" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ALTER COLUMN "timeline" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "shop_staff" ALTER COLUMN "permissions" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_invitations" ALTER COLUMN "permissions" SET DEFAULT '[]'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "staff_invitations" ALTER COLUMN "permissions" SET DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "shop_staff" ALTER COLUMN "permissions" SET DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ALTER COLUMN "timeline" SET DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "global_products" ALTER COLUMN "photos" SET DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "shops" ALTER COLUMN "blockedUserIds" SET DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "shops" ALTER COLUMN "deliveryZone" SET DEFAULT '{"maxKm": 2, "freeKm": 2, "pricingType": "flat", "pricePerStep": 0}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "shops" ALTER COLUMN "holidays" SET DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "shops" ALTER COLUMN "workingHours" SET DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "shops" ALTER COLUMN "photos" SET DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ALTER COLUMN "data" SET DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "favoriteProductIds" SET DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "favoriteShopIds" SET DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "roles" SET DEFAULT '["customer"]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "debts" ALTER COLUMN "lines" SET DEFAULT '[]'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9b75df80c67bf2d8380f57b4f9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0d21708188f6d995f637b08a07"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fa8cff72bbab578a03022d9c95"`,
    );
    await queryRunner.query(`DROP TABLE "order_complaints"`);
    await queryRunner.query(
      `DROP TYPE "public"."order_complaints_status_enum"`,
    );
  }
}
