import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSellerApplicationFields1786370000000 implements MigrationInterface {
  name = 'AddSellerApplicationFields1786370000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "seller_applications" ADD COLUMN IF NOT EXISTS "companyName" character varying(255);`,
    );
    await queryRunner.query(
      `ALTER TABLE "seller_applications" ADD COLUMN IF NOT EXISTS "entityType" character varying(64);`,
    );
    await queryRunner.query(
      `ALTER TABLE "seller_applications" ADD COLUMN IF NOT EXISTS "legalAddress" character varying(512);`,
    );
    await queryRunner.query(
      `ALTER TABLE "seller_applications" ADD COLUMN IF NOT EXISTS "bankCardNumber" character varying(32);`,
    );
    await queryRunner.query(
      `ALTER TABLE "seller_applications" ADD COLUMN IF NOT EXISTS "bankCardHolderName" character varying(128);`,
    );
    await queryRunner.query(
      `ALTER TABLE "seller_applications" ADD COLUMN IF NOT EXISTS "soliqConfirmed" boolean NOT NULL DEFAULT false;`,
    );
    await queryRunner.query(
      `ALTER TABLE "seller_applications" ADD COLUMN IF NOT EXISTS "ofertaAccepted" boolean NOT NULL DEFAULT false;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "seller_applications" DROP COLUMN IF EXISTS "ofertaAccepted";`,
    );
    await queryRunner.query(
      `ALTER TABLE "seller_applications" DROP COLUMN IF EXISTS "soliqConfirmed";`,
    );
    await queryRunner.query(
      `ALTER TABLE "seller_applications" DROP COLUMN IF EXISTS "bankCardHolderName";`,
    );
    await queryRunner.query(
      `ALTER TABLE "seller_applications" DROP COLUMN IF EXISTS "bankCardNumber";`,
    );
    await queryRunner.query(
      `ALTER TABLE "seller_applications" DROP COLUMN IF EXISTS "legalAddress";`,
    );
    await queryRunner.query(
      `ALTER TABLE "seller_applications" DROP COLUMN IF EXISTS "entityType";`,
    );
    await queryRunner.query(
      `ALTER TABLE "seller_applications" DROP COLUMN IF EXISTS "companyName";`,
    );
  }
}
