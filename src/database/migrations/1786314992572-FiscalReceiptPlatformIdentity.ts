import { MigrationInterface, QueryRunner } from 'typeorm';

export class FiscalReceiptPlatformIdentity1786314992572 implements MigrationInterface {
  name = 'FiscalReceiptPlatformIdentity1786314992572';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enums if they do not exist
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."fiscal_receipts_type_enum" AS ENUM('sale', 'refund');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."fiscal_receipts_status_enum" AS ENUM(
          'incomplete', 'pending', 'sent', 'confirmed', 'failed'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create table if it does not exist
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fiscal_receipts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "orderId" uuid NOT NULL,
        "type" "public"."fiscal_receipts_type_enum" NOT NULL DEFAULT 'sale',
        "originalReceiptId" uuid,
        "status" "public"."fiscal_receipts_status_enum" NOT NULL DEFAULT 'pending',
        "provider" character varying(32) NOT NULL DEFAULT 'none',
        "sellerStir" character varying(16),
        "sellerName" character varying(128),
        "sellerVatPayer" boolean NOT NULL DEFAULT false,
        "platformStir" character varying(16),
        "platformLegalName" character varying(256),
        "lines" jsonb NOT NULL DEFAULT '[]',
        "totalAmount" integer NOT NULL,
        "totalVatAmount" integer NOT NULL DEFAULT 0,
        "cashAmount" integer NOT NULL DEFAULT 0,
        "cardAmount" integer NOT NULL DEFAULT 0,
        "missingFields" jsonb NOT NULL DEFAULT '[]',
        "fiscalSign" character varying(64),
        "fiscalReceiptNumber" character varying(64),
        "terminalId" character varying(64),
        "qrUrl" character varying(512),
        "attempts" integer NOT NULL DEFAULT 0,
        "lastError" text,
        "sentAt" TIMESTAMP WITH TIME ZONE,
        "confirmedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fiscal_receipts_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fiscal_receipts_orderId" ON "fiscal_receipts" ("orderId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fiscal_receipts_status" ON "fiscal_receipts" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fiscal_receipts_type_status" ON "fiscal_receipts" ("type", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "fiscal_receipts"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."fiscal_receipts_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."fiscal_receipts_type_enum"`);
  }
}
