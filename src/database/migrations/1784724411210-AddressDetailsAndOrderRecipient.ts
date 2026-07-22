import { MigrationInterface, QueryRunner } from "typeorm";

export class AddressDetailsAndOrderRecipient1784724411210 implements MigrationInterface {
    name = 'AddressDetailsAndOrderRecipient1784724411210'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_addresses" ADD "entrance" character varying(32)`);
        await queryRunner.query(`ALTER TABLE "user_addresses" ADD "floor" character varying(32)`);
        await queryRunner.query(`ALTER TABLE "user_addresses" ADD "apartment" character varying(32)`);
        await queryRunner.query(`ALTER TABLE "user_addresses" ADD "intercom" character varying(32)`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "recipientPhone" character varying(32)`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "courierComment" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "courierComment"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "recipientPhone"`);
        await queryRunner.query(`ALTER TABLE "user_addresses" DROP COLUMN "intercom"`);
        await queryRunner.query(`ALTER TABLE "user_addresses" DROP COLUMN "apartment"`);
        await queryRunner.query(`ALTER TABLE "user_addresses" DROP COLUMN "floor"`);
        await queryRunner.query(`ALTER TABLE "user_addresses" DROP COLUMN "entrance"`);
    }

}
