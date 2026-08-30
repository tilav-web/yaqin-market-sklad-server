import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClickPaymentTransactionError1785214490098 implements MigrationInterface {
  name = 'ClickPaymentTransactionError1785214490098';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "click_payment_transaction" ADD "errorCode" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "click_payment_transaction" ADD "errorNote" character varying`,
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
      `ALTER TABLE "debts" ALTER COLUMN "lines" SET DEFAULT '[]'::jsonb`,
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
      `ALTER TABLE "shop_staff_presets" ALTER COLUMN "permissions" SET DEFAULT '[]'::jsonb`,
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
      `ALTER TABLE "shop_staff_presets" ALTER COLUMN "permissions" SET DEFAULT '[]'`,
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
      `ALTER TABLE "debts" ALTER COLUMN "lines" SET DEFAULT '[]'`,
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
      `ALTER TABLE "click_payment_transaction" DROP COLUMN "errorNote"`,
    );
    await queryRunner.query(
      `ALTER TABLE "click_payment_transaction" DROP COLUMN "errorCode"`,
    );
  }
}
