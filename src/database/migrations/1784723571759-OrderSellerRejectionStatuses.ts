import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderSellerRejectionStatuses1784723571759 implements MigrationInterface {
  name = 'OrderSellerRejectionStatuses1784723571759';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."orders_status_enum" ADD VALUE 'seller_no_response'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."orders_status_enum" ADD VALUE 'seller_rejected'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."orders_status_enum_old" AS ENUM('new', 'accepted', 'preparing', 'delivering', 'delivered', 'cancelled')`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ALTER COLUMN "status" TYPE "public"."orders_status_enum_old" USING "status"::"text"::"public"."orders_status_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'new'`,
    );
    await queryRunner.query(`DROP TYPE "public"."orders_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."orders_status_enum_old" RENAME TO "orders_status_enum"`,
    );
  }
}
