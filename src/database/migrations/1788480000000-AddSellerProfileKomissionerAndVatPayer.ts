import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSellerProfileKomissionerAndVatPayer1788480000000 implements MigrationInterface {
  name = 'AddSellerProfileKomissionerAndVatPayer1788480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "seller_profiles"
      ADD COLUMN IF NOT EXISTS "vatPayer" boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS "komissionerStatus" varchar(16) DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS "komissionerConfirmedAt" timestamptz,
      ADD COLUMN IF NOT EXISTS "komissionerConfirmedByAdminId" uuid;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "seller_profiles"
      DROP COLUMN IF EXISTS "komissionerConfirmedByAdminId",
      DROP COLUMN IF EXISTS "komissionerConfirmedAt",
      DROP COLUMN IF EXISTS "komissionerStatus",
      DROP COLUMN IF EXISTS "vatPayer";
    `);
  }
}
