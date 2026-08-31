import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserDeletedStatusAndDeletedAt1788300000000 implements MigrationInterface {
  name = 'AddUserDeletedStatusAndDeletedAt1788300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deletedAt" timestamp with time zone;`,
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'users_status_enum') THEN
          ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'deleted';
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "deletedAt";`);
  }
}
