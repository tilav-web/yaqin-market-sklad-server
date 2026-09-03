import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMarkingCodesToOrderItems1788470000000 implements MigrationInterface {
  name = 'AddMarkingCodesToOrderItems1788470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "markingCodes" jsonb NOT NULL DEFAULT '[]'::jsonb;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP COLUMN IF EXISTS "markingCodes";`,
    );
  }
}
