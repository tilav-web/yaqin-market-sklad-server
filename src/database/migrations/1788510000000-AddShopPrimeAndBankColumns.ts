import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShopPrimeAndBankColumns1788510000000 implements MigrationInterface {
  name = 'AddShopPrimeAndBankColumns1788510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shops"
      ADD COLUMN IF NOT EXISTS "isPrime" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "primeBadgeText" character varying(64),
      ADD COLUMN IF NOT EXISTS "ownerOrdersSeenAt" timestamp with time zone,
      ADD COLUMN IF NOT EXISTS "bankAccountId" uuid,
      ADD COLUMN IF NOT EXISTS "bankAccountNumber" character varying(32),
      ADD COLUMN IF NOT EXISTS "bankMfo" character varying(16),
      ADD COLUMN IF NOT EXISTS "bankName" character varying(128),
      ADD COLUMN IF NOT EXISTS "bankAccountHolderName" character varying(128),
      ADD COLUMN IF NOT EXISTS "serviceRatingAverage" double precision,
      ADD COLUMN IF NOT EXISTS "serviceRatingCount" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "deactivatedByDebt" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "deliveryPolygon" jsonb,
      ADD COLUMN IF NOT EXISTS "freeDeliveryPolygon" jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shops"
      DROP COLUMN IF EXISTS "freeDeliveryPolygon",
      DROP COLUMN IF EXISTS "deliveryPolygon",
      DROP COLUMN IF EXISTS "deactivatedByDebt",
      DROP COLUMN IF EXISTS "serviceRatingCount",
      DROP COLUMN IF EXISTS "serviceRatingAverage",
      DROP COLUMN IF EXISTS "bankAccountHolderName",
      DROP COLUMN IF EXISTS "bankName",
      DROP COLUMN IF EXISTS "bankMfo",
      DROP COLUMN IF EXISTS "bankAccountNumber",
      DROP COLUMN IF EXISTS "bankAccountId",
      DROP COLUMN IF EXISTS "ownerOrdersSeenAt",
      DROP COLUMN IF EXISTS "primeBadgeText",
      DROP COLUMN IF EXISTS "isPrime";
    `);
  }
}
