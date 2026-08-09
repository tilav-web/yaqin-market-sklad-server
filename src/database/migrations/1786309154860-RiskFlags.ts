import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Anti-fraud layer, phase 4: the risk_flags queue and device_accounts
 * identity table. `risk_flags.dedupeKey` is unique — RiskFlagsService.raise()
 * upserts against it (INSERT ... ON CONFLICT DO UPDATE occurrences+1),
 * counting repeat misbehaviour instead of appending a row per event, which
 * would drown the admin queue given how often Doze/battery-optimisation
 * kills background location on common UZ Android devices.
 *
 * device_accounts is a plain (deviceId, userId) append-only pair table —
 * deliberately separate from device_tokens (unique per push token, and
 * overwritten on every login) so `device_shared_across_accounts` has an
 * honest history to count against.
 */
export class RiskFlags1786309154860 implements MigrationInterface {
    name = 'RiskFlags1786309154860'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "risk_flags_rule_enum" AS ENUM(
            'mocked_location', 'delivered_far_from_address', 'delivered_without_evidence',
            'pickup_far_from_shop', 'impossible_travel', 'not_received_complaint',
            'low_courier_rating', 'corroborated_false_delivery', 'address_far_from_device',
            'shop_relocated_after_orders', 'device_shared_across_accounts'
        )`);
        await queryRunner.query(`CREATE TYPE "risk_flags_severity_enum" AS ENUM('low', 'medium', 'high')`);
        await queryRunner.query(`CREATE TYPE "risk_flags_status_enum" AS ENUM('open', 'confirmed', 'dismissed')`);
        await queryRunner.query(`CREATE TYPE "risk_flags_subjecttype_enum" AS ENUM('user', 'shop', 'order', 'device')`);

        await queryRunner.query(`
            CREATE TABLE "risk_flags" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "rule" "risk_flags_rule_enum" NOT NULL,
                "severity" "risk_flags_severity_enum" NOT NULL,
                "status" "risk_flags_status_enum" NOT NULL DEFAULT 'open',
                "subjectType" "risk_flags_subjecttype_enum" NOT NULL,
                "subjectId" character varying(64) NOT NULL,
                "orderId" uuid,
                "shopId" uuid,
                "deviceId" character varying(64),
                "summary" character varying(256) NOT NULL,
                "details" jsonb,
                "dedupeKey" character varying(160) NOT NULL,
                "occurrences" integer NOT NULL DEFAULT 1,
                "firstSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "reviewedByAdminId" uuid,
                "reviewedAt" TIMESTAMP WITH TIME ZONE,
                "reviewNote" text,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_risk_flags_dedupeKey" UNIQUE ("dedupeKey"),
                CONSTRAINT "PK_risk_flags" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_risk_flags_status_severity_lastSeen" ON "risk_flags" ("status", "severity", "lastSeenAt")`);
        await queryRunner.query(`CREATE INDEX "IDX_risk_flags_subject" ON "risk_flags" ("subjectType", "subjectId")`);
        await queryRunner.query(`CREATE INDEX "IDX_risk_flags_orderId" ON "risk_flags" ("orderId")`);

        await queryRunner.query(`
            CREATE TABLE "device_accounts" (
                "deviceId" character varying(64) NOT NULL,
                "userId" uuid NOT NULL,
                "firstSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_device_accounts" PRIMARY KEY ("deviceId", "userId")
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_device_accounts_userId" ON "device_accounts" ("userId")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_device_accounts_userId"`);
        await queryRunner.query(`DROP TABLE "device_accounts"`);

        await queryRunner.query(`DROP INDEX "IDX_risk_flags_orderId"`);
        await queryRunner.query(`DROP INDEX "IDX_risk_flags_subject"`);
        await queryRunner.query(`DROP INDEX "IDX_risk_flags_status_severity_lastSeen"`);
        await queryRunner.query(`DROP TABLE "risk_flags"`);

        await queryRunner.query(`DROP TYPE "risk_flags_subjecttype_enum"`);
        await queryRunner.query(`DROP TYPE "risk_flags_status_enum"`);
        await queryRunner.query(`DROP TYPE "risk_flags_severity_enum"`);
        await queryRunner.query(`DROP TYPE "risk_flags_rule_enum"`);
    }

}
