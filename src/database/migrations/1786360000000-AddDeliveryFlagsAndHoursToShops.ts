import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeliveryFlagsAndHoursToShops1786360000000 implements MigrationInterface {
  name = 'AddDeliveryFlagsAndHoursToShops1786360000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "isDeliveryEnabled" boolean NOT NULL DEFAULT true;`,
    );
    await queryRunner.query(
      `ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "isPickupEnabled" boolean NOT NULL DEFAULT true;`,
    );
    await queryRunner.query(
      `ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "deliveryHours" jsonb NOT NULL DEFAULT '[]'::jsonb;`,
    );
    await queryRunner.query(
      `ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "phone" character varying(32);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shops" DROP COLUMN IF EXISTS "phone";`,
    );
    await queryRunner.query(
      `ALTER TABLE "shops" DROP COLUMN IF EXISTS "deliveryHours";`,
    );
    await queryRunner.query(
      `ALTER TABLE "shops" DROP COLUMN IF EXISTS "isPickupEnabled";`,
    );
    await queryRunner.query(
      `ALTER TABLE "shops" DROP COLUMN IF EXISTS "isDeliveryEnabled";`,
    );
  }
}
