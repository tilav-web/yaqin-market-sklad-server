import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRegionsAndDistricts1788490000000 implements MigrationInterface {
  name = 'CreateRegionsAndDistricts1788490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "regions" (
        "id" uuid NOT NULL,
        "code" character varying(64) NOT NULL,
        "name" jsonb NOT NULL DEFAULT '{"uz":"","kr":"","ru":""}'::jsonb,
        "centerLat" double precision NOT NULL,
        "centerLng" double precision NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_regions_code" UNIQUE ("code"),
        CONSTRAINT "PK_regions_id" PRIMARY KEY ("id")
      );

      CREATE TABLE IF NOT EXISTS "districts" (
        "id" uuid NOT NULL,
        "regionId" uuid NOT NULL,
        "regionCode" character varying(64) NOT NULL,
        "nameKey" character varying(128) NOT NULL,
        "name" jsonb NOT NULL DEFAULT '{"uz":"","kr":"","ru":""}'::jsonb,
        "isCity" boolean NOT NULL DEFAULT false,
        "centerLat" double precision NOT NULL,
        "centerLng" double precision NOT NULL,
        "boundary" jsonb NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_districts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_districts_region" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS "IDX_districts_regionId" ON "districts" ("regionId");

      ALTER TABLE "shops"
      ADD COLUMN IF NOT EXISTS "districtId" uuid,
      ADD CONSTRAINT "FK_shops_district" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS "IDX_shops_districtId" ON "shops" ("districtId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_shops_districtId";
      ALTER TABLE "shops" DROP CONSTRAINT IF EXISTS "FK_shops_district";
      ALTER TABLE "shops" DROP COLUMN IF EXISTS "districtId";
      DROP TABLE IF EXISTS "districts";
      DROP TABLE IF EXISTS "regions";
    `);
  }
}
