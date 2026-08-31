import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSellerBankAccounts1788200000000 implements MigrationInterface {
  name = 'AddSellerBankAccounts1788200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create seller_bank_accounts table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "seller_bank_accounts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "accountNumber" character varying(32) NOT NULL,
        "mfo" character varying(16) NOT NULL,
        "bankName" character varying(128) NOT NULL,
        "accountHolderName" character varying(128) NOT NULL,
        "isDefault" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_seller_bank_accounts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_seller_bank_accounts_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_seller_bank_accounts_userId" ON "seller_bank_accounts" ("userId")
    `);

    // 2. Add bank fields to shops
    await queryRunner.query(`
      ALTER TABLE "shops"
      ADD COLUMN IF NOT EXISTS "bankAccountId" uuid,
      ADD COLUMN IF NOT EXISTS "bankAccountNumber" character varying(32),
      ADD COLUMN IF NOT EXISTS "bankMfo" character varying(16),
      ADD COLUMN IF NOT EXISTS "bankName" character varying(128),
      ADD COLUMN IF NOT EXISTS "bankAccountHolderName" character varying(128)
    `);

    // 3. Add bank fields to seller_profiles
    await queryRunner.query(`
      ALTER TABLE "seller_profiles"
      ADD COLUMN IF NOT EXISTS "bankAccountNumber" character varying(32),
      ADD COLUMN IF NOT EXISTS "bankMfo" character varying(16),
      ADD COLUMN IF NOT EXISTS "bankName" character varying(128),
      ADD COLUMN IF NOT EXISTS "bankAccountHolderName" character varying(128)
    `);

    // 4. Add bank fields to seller_applications
    await queryRunner.query(`
      ALTER TABLE "seller_applications"
      ADD COLUMN IF NOT EXISTS "bankAccountNumber" character varying(32),
      ADD COLUMN IF NOT EXISTS "bankMfo" character varying(16),
      ADD COLUMN IF NOT EXISTS "bankName" character varying(128),
      ADD COLUMN IF NOT EXISTS "bankAccountHolderName" character varying(128)
    `);

    // 5. Add bank fields to withdrawal_requests and make bankCardNumber nullable
    await queryRunner.query(`
      ALTER TABLE "withdrawal_requests"
      ADD COLUMN IF NOT EXISTS "shopId" uuid,
      ADD COLUMN IF NOT EXISTS "bankAccountNumber" character varying(32),
      ADD COLUMN IF NOT EXISTS "bankMfo" character varying(16),
      ADD COLUMN IF NOT EXISTS "bankName" character varying(128),
      ADD COLUMN IF NOT EXISTS "recipientName" character varying(128),
      ALTER COLUMN "bankCardNumber" DROP NOT NULL,
      ALTER COLUMN "bankCardHolderName" DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "seller_bank_accounts"`);
  }
}
