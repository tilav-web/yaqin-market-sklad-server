import { MigrationInterface, QueryRunner } from "typeorm";

export class UserProfileFields1784742008798 implements MigrationInterface {
    name = 'UserProfileFields1784742008798'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."users_gender_enum" AS ENUM('male', 'female')`);
        await queryRunner.query(`ALTER TABLE "users" ADD "firstName" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "users" ADD "lastName" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "users" ADD "birthDate" date`);
        await queryRunner.query(`ALTER TABLE "users" ADD "gender" "public"."users_gender_enum"`);
        await queryRunner.query(`ALTER TABLE "users" ADD "email" character varying(255)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "gender"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "birthDate"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "lastName"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "firstName"`);
        await queryRunner.query(`DROP TYPE "public"."users_gender_enum"`);
    }

}
