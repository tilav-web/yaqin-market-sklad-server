import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMultiLingualFieldsToAllEntities1786326000000 implements MigrationInterface {
  name = 'AddMultiLingualFieldsToAllEntities1786326000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. global_products: name & description to jsonb
    await queryRunner.query(`
      ALTER TABLE "global_products"
      ALTER COLUMN "name" TYPE jsonb USING (
        CASE
          WHEN jsonb_typeof(to_jsonb("name")) = 'object' THEN "name"::jsonb
          ELSE jsonb_build_object('uz', coalesce("nameUzLatn", "name"::text, ''), 'kr', coalesce("nameUzCyrl", ''), 'ru', coalesce("nameRu", "name"::text, ''))
        END
      ),
      ALTER COLUMN "description" TYPE jsonb USING (
        CASE
          WHEN "description" IS NULL THEN NULL
          WHEN jsonb_typeof(to_jsonb("description")) = 'object' THEN "description"::jsonb
          ELSE jsonb_build_object('uz', coalesce("descriptionUzLatn", "description"::text, ''), 'kr', coalesce("descriptionUzCyrl", ''), 'ru', coalesce("descriptionRu", "description"::text, ''))
        END
      );
    `);

    // 2. categories: name to jsonb
    await queryRunner.query(`
      ALTER TABLE "categories"
      ADD COLUMN IF NOT EXISTS "name" jsonb DEFAULT '{"uz":"","kr":"","ru":""}'::jsonb;

      UPDATE "categories"
      SET "name" = jsonb_build_object('uz', coalesce("nameUzLatn", ''), 'kr', coalesce("nameUzCyrl", ''), 'ru', coalesce("nameRu", ''))
      WHERE "name" IS NULL OR "name" = '{"uz":"","kr":"","ru":""}'::jsonb;
    `);

    // 3. prime_plans: name & description to jsonb
    await queryRunner.query(`
      ALTER TABLE "prime_plans"
      ALTER COLUMN "name" TYPE jsonb USING (
        CASE
          WHEN jsonb_typeof(to_jsonb("name")) = 'object' THEN "name"::jsonb
          ELSE jsonb_build_object('uz', "name"::text, 'kr', "name"::text, 'ru', "name"::text)
        END
      ),
      ALTER COLUMN "description" TYPE jsonb USING (
        CASE
          WHEN "description" IS NULL THEN NULL
          WHEN jsonb_typeof(to_jsonb("description")) = 'object' THEN "description"::jsonb
          ELSE jsonb_build_object('uz', "description"::text, 'kr', "description"::text, 'ru', "description"::text)
        END
      );
    `);

    // 4. notification_templates: title & body to jsonb
    await queryRunner.query(`
      ALTER TABLE "notification_templates"
      ALTER COLUMN "title" TYPE jsonb USING (
        CASE
          WHEN jsonb_typeof(to_jsonb("title")) = 'object' THEN "title"::jsonb
          ELSE jsonb_build_object('uz', "title"::text, 'kr', "title"::text, 'ru', "title"::text)
        END
      ),
      ALTER COLUMN "body" TYPE jsonb USING (
        CASE
          WHEN jsonb_typeof(to_jsonb("body")) = 'object' THEN "body"::jsonb
          ELSE jsonb_build_object('uz', "body"::text, 'kr', "body"::text, 'ru', "body"::text)
        END
      );
    `);

    // 5. chat_templates: text to jsonb
    await queryRunner.query(`
      ALTER TABLE "chat_templates"
      ALTER COLUMN "text" TYPE jsonb USING (
        CASE
          WHEN jsonb_typeof(to_jsonb("text")) = 'object' THEN "text"::jsonb
          ELSE jsonb_build_object('uz', "text"::text, 'kr', "text"::text, 'ru', "text"::text)
        END
      );
    `);

    // 6. promotions: name to jsonb
    await queryRunner.query(`
      ALTER TABLE "promotions"
      ALTER COLUMN "name" TYPE jsonb USING (
        CASE
          WHEN jsonb_typeof(to_jsonb("name")) = 'object' THEN "name"::jsonb
          ELSE jsonb_build_object('uz', "name"::text, 'kr', "name"::text, 'ru', "name"::text)
        END
      );
    `);

    // 7. app_releases: notes to jsonb
    await queryRunner.query(`
      ALTER TABLE "app_releases"
      ALTER COLUMN "notes" TYPE jsonb USING (
        CASE
          WHEN "notes" IS NULL THEN NULL
          WHEN jsonb_typeof(to_jsonb("notes")) = 'object' THEN "notes"::jsonb
          ELSE jsonb_build_object('uz', "notes"::text, 'kr', "notes"::text, 'ru', "notes"::text)
        END
      );
    `);

    // 8. tax_categories: create table if not exists, otherwise alter title to jsonb
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tax_categories" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "title" jsonb NOT NULL DEFAULT '{"uz":"","kr":"","ru":""}'::jsonb,
        "mxikCode" varchar(32) NOT NULL,
        "packageCode" varchar(32),
        "unitCode" varchar(32),
        "markingRequired" boolean NOT NULL DEFAULT false,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS "IDX_tax_categories_mxik" ON "tax_categories" ("mxikCode");

      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'tax_categories' AND column_name = 'title' AND data_type != 'jsonb'
        ) THEN
          ALTER TABLE "tax_categories"
          ALTER COLUMN "title" TYPE jsonb USING (
            CASE
              WHEN jsonb_typeof(to_jsonb("title")) = 'object' THEN "title"::jsonb
              ELSE jsonb_build_object('uz', "title"::text, 'kr', "title"::text, 'ru', "title"::text)
            END
          );
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tax_categories" ALTER COLUMN "title" TYPE varchar(256) USING ("title"->>'uz');
      ALTER TABLE "app_releases" ALTER COLUMN "notes" TYPE text USING ("notes"->>'uz');
      ALTER TABLE "promotions" ALTER COLUMN "name" TYPE varchar(128) USING ("name"->>'uz');
      ALTER TABLE "chat_templates" ALTER COLUMN "text" TYPE text USING ("text"->>'uz');
      ALTER TABLE "notification_templates" ALTER COLUMN "body" TYPE varchar(512) USING ("body"->>'uz'), ALTER COLUMN "title" TYPE varchar(128) USING ("title"->>'uz');
      ALTER TABLE "prime_plans" ALTER COLUMN "description" TYPE text USING ("description"->>'uz'), ALTER COLUMN "name" TYPE varchar(64) USING ("name"->>'uz');
      ALTER TABLE "global_products" ALTER COLUMN "description" TYPE text USING ("description"->>'uz'), ALTER COLUMN "name" TYPE varchar(256) USING ("name"->>'uz');
    `);
  }
}
