import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminUsersTable1786320000000 implements MigrationInterface {
  name = 'CreateAdminUsersTable1786320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."admin_users_role_enum" AS ENUM(
        'super_admin', 'admin', 'moderator', 'support', 'finance', 'content_manager'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "admin_users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "username" character varying(64) NOT NULL,
        "passwordHash" character varying(255) NOT NULL,
        "firstName" character varying(64) NOT NULL,
        "lastName" character varying(64) NOT NULL,
        "phone" character varying(32),
        "email" character varying(255),
        "role" "public"."admin_users_role_enum" NOT NULL DEFAULT 'admin',
        "permissions" jsonb NOT NULL DEFAULT '[]',
        "isActive" boolean NOT NULL DEFAULT true,
        "isProtected" boolean NOT NULL DEFAULT false,
        "avatarUrl" character varying(512),
        "lastLoginAt" TIMESTAMP WITH TIME ZONE,
        "createdByAdminId" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_admin_users_username" UNIQUE ("username"),
        CONSTRAINT "UQ_admin_users_phone" UNIQUE ("phone"),
        CONSTRAINT "PK_admin_users_id" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "admin_users"`);
    await queryRunner.query(`DROP TYPE "public"."admin_users_role_enum"`);
  }
}
