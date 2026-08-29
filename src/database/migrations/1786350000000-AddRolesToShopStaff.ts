import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRolesToShopStaff1786350000000 implements MigrationInterface {
  name = 'AddRolesToShopStaff1786350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shop_staff" ADD COLUMN IF NOT EXISTS "roles" jsonb NOT NULL DEFAULT '[]'::jsonb;`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_invitations" ADD COLUMN IF NOT EXISTS "roles" jsonb NOT NULL DEFAULT '[]'::jsonb;`,
    );
    // Backfill existing staff preset into roles array if roles is empty
    await queryRunner.query(`
      UPDATE "shop_staff"
      SET "roles" = CASE
        WHEN "preset" = 'kassir' THEN '["cashier"]'::jsonb
        WHEN "preset" = 'sklad' OR "preset" = 'omborchi' THEN '["storekeeper"]'::jsonb
        WHEN "preset" = 'yetkazib_beruvchi' OR "preset" = 'kuryer' THEN '["courier"]'::jsonb
        WHEN "preset" = 'menejer' THEN '["manager"]'::jsonb
        WHEN "preset" IS NOT NULL AND "preset" != '' THEN jsonb_build_array("preset")
        ELSE '[]'::jsonb
      END
      WHERE "roles" = '[]'::jsonb OR "roles" IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shop_staff" DROP COLUMN IF EXISTS "roles";`);
    await queryRunner.query(`ALTER TABLE "staff_invitations" DROP COLUMN IF EXISTS "roles";`);
  }
}
