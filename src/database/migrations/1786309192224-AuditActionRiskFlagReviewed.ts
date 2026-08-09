import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds the 'risk_flag_reviewed' value to the admin_audit_logs action enum —
 * kept as its own migration (not bundled into RiskFlags) since
 * `ALTER TYPE ... ADD VALUE` historically couldn't run in the same
 * transaction that then USES the new value; keeping it isolated avoids that
 * class of problem regardless of the Postgres version deployed.
 */
export class AuditActionRiskFlagReviewed1786309192224 implements MigrationInterface {
    name = 'AuditActionRiskFlagReviewed1786309192224'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."admin_audit_logs_action_enum" ADD VALUE IF NOT EXISTS 'risk_flag_reviewed'`);
    }

    public async down(): Promise<void> {
        // Postgres has no DROP VALUE for enums — rolling back this value
        // would require recreating the type and rewriting the column, which
        // is destructive if any row already uses it. Left as a no-op.
    }

}
