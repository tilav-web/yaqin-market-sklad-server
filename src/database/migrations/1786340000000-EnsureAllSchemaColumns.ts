import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnsureAllSchemaColumns1786340000000 implements MigrationInterface {
  name = 'EnsureAllSchemaColumns1786340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Orders table
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "providerFeeAmount" integer NOT NULL DEFAULT 0;`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "providerFeePercentSnapshot" double precision;`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "reRequestedAt" timestamp with time zone;`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refundedAt" timestamp with time zone;`,
    );

    // Global Products table
    await queryRunner.query(
      `ALTER TABLE "global_products" ADD COLUMN IF NOT EXISTS "taxCategoryId" uuid;`,
    );
    await queryRunner.query(
      `ALTER TABLE "global_products" ADD COLUMN IF NOT EXISTS "slug" varchar(256);`,
    );

    // Seller Applications table
    await queryRunner.query(
      `ALTER TABLE "seller_applications" ADD COLUMN IF NOT EXISTS "stir" varchar(16);`,
    );
    await queryRunner.query(
      `ALTER TABLE "seller_applications" ADD COLUMN IF NOT EXISTS "entityType" varchar(64);`,
    );

    // Fiscal Receipts table (if any)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tax_categories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(256) NOT NULL,
        "ikpuCode" character varying(64) NOT NULL,
        "packageCode" character varying(64),
        "vatPercent" double precision NOT NULL DEFAULT 12,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
        "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tax_categories_id" PRIMARY KEY ("id")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op for safety
  }
}
