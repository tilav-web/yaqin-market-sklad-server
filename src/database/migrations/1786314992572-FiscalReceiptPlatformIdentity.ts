import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * FISKAL_SOLIQ_REFERENCE.md audit finding: platform_stir/platform_legal_name
 * settings were checked for presence but never actually attached to the
 * FiscalReceipt itself — a real OFD integration needs the operator's own
 * identity on the receipt, not just the seller's (komitent) STIR. Snapshot
 * columns, mirroring the existing sellerStir/sellerName pattern.
 */
export class FiscalReceiptPlatformIdentity1786314992572 implements MigrationInterface {
    name = 'FiscalReceiptPlatformIdentity1786314992572'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "fiscal_receipts" ADD "platformStir" character varying(16)`);
        await queryRunner.query(`ALTER TABLE "fiscal_receipts" ADD "platformLegalName" character varying(256)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "fiscal_receipts" DROP COLUMN "platformLegalName"`);
        await queryRunner.query(`ALTER TABLE "fiscal_receipts" DROP COLUMN "platformStir"`);
    }

}
