import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Anti-fraud location-evidence layer, phase 1: the two decisive moments in a
 * delivery (dispatch, delivered) plus checkout now carry an immutable jsonb
 * snapshot of the device fix that confirmed them (see
 * server/src/geo/location-evidence.ts). `deliveredByUserId` records which
 * User actually tapped "Yetkazildi" on the shop side, distinct from the
 * mutable `assignedStaffId` — needed later to attribute a courier rating.
 *
 * `user_addresses.pinEvidence`/`pinSetCount` and `shops.pinEvidence`/
 * `relocatedAt` are added now but NOT populated yet — they're wired up in a
 * later phase (address/shop pin re-verification). No backfill for any of
 * these columns: historic orders/addresses/shops genuinely have no evidence,
 * and leaving them null is more honest than a fabricated backfill.
 */
export class OrderLocationEvidence1786303073706 implements MigrationInterface {
    name = 'OrderLocationEvidence1786303073706'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" ADD "orderEvidence" jsonb`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "dispatchedEvidence" jsonb`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "deliveredEvidence" jsonb`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "deliveredByUserId" uuid`);

        await queryRunner.query(`ALTER TABLE "user_addresses" ADD "pinEvidence" jsonb`);
        await queryRunner.query(`ALTER TABLE "user_addresses" ADD "pinSetCount" integer NOT NULL DEFAULT 0`);

        await queryRunner.query(`ALTER TABLE "shops" ADD "pinEvidence" jsonb`);
        await queryRunner.query(`ALTER TABLE "shops" ADD "relocatedAt" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "shops" DROP COLUMN "relocatedAt"`);
        await queryRunner.query(`ALTER TABLE "shops" DROP COLUMN "pinEvidence"`);

        await queryRunner.query(`ALTER TABLE "user_addresses" DROP COLUMN "pinSetCount"`);
        await queryRunner.query(`ALTER TABLE "user_addresses" DROP COLUMN "pinEvidence"`);

        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "deliveredByUserId"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "deliveredEvidence"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "dispatchedEvidence"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "orderEvidence"`);
    }

}
