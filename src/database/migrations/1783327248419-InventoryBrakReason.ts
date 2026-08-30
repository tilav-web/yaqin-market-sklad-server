import { MigrationInterface, QueryRunner } from 'typeorm';

export class InventoryBrakReason1783327248419 implements MigrationInterface {
  name = 'InventoryBrakReason1783327248419';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."inventory_movements_brakreasoncode_enum" AS ENUM('expired', 'damaged', 'stolen', 'other')`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_movements" ADD "brakReasonCode" "public"."inventory_movements_brakreasoncode_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_movements" ADD "brakReasonNote" text`,
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
      `ALTER TYPE "public"."inventory_movements_type_enum" ADD VALUE 'damaged'`,
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
      `CREATE TYPE "public"."inventory_movements_type_enum_old" AS ENUM('in', 'sold', 'returned', 'expired', 'adjusted')`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_movements" ALTER COLUMN "type" TYPE "public"."inventory_movements_type_enum_old" USING "type"::"text"::"public"."inventory_movements_type_enum_old"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."inventory_movements_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."inventory_movements_type_enum_old" RENAME TO "inventory_movements_type_enum"`,
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
      `ALTER TABLE "inventory_movements" DROP COLUMN "brakReasonNote"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_movements" DROP COLUMN "brakReasonCode"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."inventory_movements_brakreasoncode_enum"`,
    );
  }
}
