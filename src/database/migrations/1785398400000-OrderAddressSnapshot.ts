import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Orders now carry an immutable jsonb snapshot of the delivery address taken
 * at order time, and the FK to user_addresses is dropped — users can freely
 * edit/delete saved addresses without touching order history.
 */
export class OrderAddressSnapshot1785398400000 implements MigrationInterface {
  name = 'OrderAddressSnapshot1785398400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" ADD "deliveryAddress" jsonb`);
    // Backfill existing orders from the address rows they still point to.
    await queryRunner.query(`
            UPDATE "orders" o SET "deliveryAddress" = jsonb_build_object(
                'label', a."label",
                'address', a."address",
                'latitude', a."latitude",
                'longitude', a."longitude",
                'entrance', a."entrance",
                'floor', a."floor",
                'apartment', a."apartment",
                'intercom', a."intercom"
            )
            FROM "user_addresses" a
            WHERE o."deliveryAddressId" = a."id"
        `);
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_749e5d7152b6cde429099a99530"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Orders whose address was deleted after the FK was dropped can't be
    // re-linked — null them out so the constraint can be restored.
    await queryRunner.query(`
            UPDATE "orders" SET "deliveryAddressId" = NULL
            WHERE "deliveryAddressId" IS NOT NULL
              AND "deliveryAddressId" NOT IN (SELECT "id" FROM "user_addresses")
        `);
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_749e5d7152b6cde429099a99530" FOREIGN KEY ("deliveryAddressId") REFERENCES "user_addresses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN "deliveryAddress"`,
    );
  }
}
