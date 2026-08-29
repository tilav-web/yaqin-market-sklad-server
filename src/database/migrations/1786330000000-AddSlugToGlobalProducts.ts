import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSlugToGlobalProducts1786330000000 implements MigrationInterface {
  name = 'AddSlugToGlobalProducts1786330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add slug column if it does not exist
    await queryRunner.query(`
      ALTER TABLE "global_products"
      ADD COLUMN IF NOT EXISTS "slug" varchar(256);
    `);

    // 2. Backfill existing products with unique slugs
    await queryRunner.query(`
      DO $$
      DECLARE
        r RECORD;
        base_slug text;
        final_slug text;
        counter integer;
      BEGIN
        FOR r IN (
          SELECT id,
                 COALESCE(
                   NULLIF(trim(name->>'uz'), ''),
                   NULLIF(trim(name->>'ru'), ''),
                   id::text
                 ) AS raw_name
          FROM "global_products"
          WHERE "slug" IS NULL OR "slug" = ''
        ) LOOP
          -- Simple normalization to clean slug
          base_slug := lower(regexp_replace(r.raw_name, '[^a-zA-Z0-9]+', '-', 'g'));
          base_slug := regexp_replace(base_slug, '^-+|-+$', '', 'g');
          IF base_slug = '' OR base_slug IS NULL THEN
            base_slug := 'product-' || substr(r.id::text, 1, 8);
          END IF;

          final_slug := base_slug;
          counter := 1;

          -- Ensure uniqueness across existing global_products
          WHILE EXISTS (
            SELECT 1 FROM "global_products"
            WHERE "slug" = final_slug AND id != r.id
          ) LOOP
            counter := counter + 1;
            final_slug := base_slug || '-' || counter;
          END LOOP;

          UPDATE "global_products"
          SET "slug" = final_slug
          WHERE id = r.id;
        END LOOP;
      END $$;
    `);

    // 3. Create unique index on slug
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_global_products_slug" ON "global_products" ("slug");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_global_products_slug";
      ALTER TABLE "global_products" DROP COLUMN IF EXISTS "slug";
    `);
  }
}
