import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTaxReportsTable1788500000000 implements MigrationInterface {
  name = 'CreateTaxReportsTable1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tax_reports" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "reportType" character varying(32) NOT NULL,
        "period" character varying(16) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "dueDate" character varying(10) NOT NULL,
        "submittedAt" TIMESTAMP WITH TIME ZONE,
        "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "notes" text,
        "submissionConfirmation" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tax_reports_id" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "IDX_tax_reports_type_period" ON "tax_reports" ("reportType", "period");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_tax_reports_type_period";
      DROP TABLE IF EXISTS "tax_reports";
    `);
  }
}
