import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClickCardToken1784613400773 implements MigrationInterface {
  name = 'ClickCardToken1784613400773';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."saved_card_status_enum" AS ENUM('pending_verify', 'active')`,
    );
    await queryRunner.query(
      `CREATE TABLE "saved_card" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "cardToken" character varying NOT NULL, "cardNumberMasked" character varying, "phoneNumber" character varying, "status" "public"."saved_card_status_enum" NOT NULL DEFAULT 'pending_verify', "isDefault" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_73405b87f9d637649472890d5c7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_62e7c9a9845f6c32dc0561a337" ON "saved_card"  ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "click_payment_transaction" ADD "clickPaymentId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "saved_card" ADD CONSTRAINT "FK_62e7c9a9845f6c32dc0561a3372" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "saved_card" DROP CONSTRAINT "FK_62e7c9a9845f6c32dc0561a3372"`,
    );
    await queryRunner.query(
      `ALTER TABLE "click_payment_transaction" DROP COLUMN "clickPaymentId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_62e7c9a9845f6c32dc0561a337"`,
    );
    await queryRunner.query(`DROP TABLE "saved_card"`);
    await queryRunner.query(`DROP TYPE "public"."saved_card_status_enum"`);
  }
}
