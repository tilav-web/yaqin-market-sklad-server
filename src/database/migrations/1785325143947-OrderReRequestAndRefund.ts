import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderReRequestAndRefund1785325143947 implements MigrationInterface {
  name = 'OrderReRequestAndRefund1785325143947';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "reRequestedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "refundedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "refundedAt"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "reRequestedAt"`);
  }
}
