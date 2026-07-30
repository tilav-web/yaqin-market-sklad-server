import { MigrationInterface, QueryRunner } from "typeorm";

export class UserAddressArchive1785398400000 implements MigrationInterface {
    name = 'UserAddressArchive1785398400000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_addresses" ADD "isArchived" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_addresses" DROP COLUMN "isArchived"`);
    }

}
