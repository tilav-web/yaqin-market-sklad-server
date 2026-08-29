import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMultiLingualFieldsToGlobalProducts1786325000000 implements MigrationInterface {
  name = 'AddMultiLingualFieldsToGlobalProducts1786325000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "global_products"
      ADD COLUMN IF NOT EXISTS "nameUzLatn" character varying(256) NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS "nameUzCyrl" character varying(256) NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS "nameRu" character varying(256) NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS "descriptionUzLatn" text,
      ADD COLUMN IF NOT EXISTS "descriptionUzCyrl" text,
      ADD COLUMN IF NOT EXISTS "descriptionRu" text
    `);

    // Backfill existing data
    await queryRunner.query(`
      UPDATE "global_products"
      SET "nameUzLatn" = "name",
          "nameRu" = "name",
          "descriptionUzLatn" = "description",
          "descriptionRu" = "description"
      WHERE "nameUzLatn" = ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "global_products"
      DROP COLUMN IF EXISTS "descriptionRu",
      DROP COLUMN IF EXISTS "descriptionUzCyrl",
      DROP COLUMN IF EXISTS "descriptionUzLatn",
      DROP COLUMN IF EXISTS "nameRu",
      DROP COLUMN IF EXISTS "nameUzCyrl",
      DROP COLUMN IF EXISTS "nameUzLatn"
    `);
  }
}
