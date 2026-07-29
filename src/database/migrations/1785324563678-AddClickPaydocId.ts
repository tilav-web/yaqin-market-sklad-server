import { MigrationInterface, QueryRunner } from "typeorm";

export class AddClickPaydocId1785324563678 implements MigrationInterface {
    name = 'AddClickPaydocId1785324563678'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "click_payment_transaction" ADD "clickPaydocId" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "click_payment_transaction" DROP COLUMN "clickPaydocId"`);
    }

}
