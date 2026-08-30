import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Anti-fraud location-evidence layer, phase 2: a courier's live GPS trail
 * is now persisted (not just cached in Redis for 60s) so a delivery dispute
 * has a real route to check against. bigserial PK (not uuid) and no FK to
 * orders — deliberate deviations from the rest of the codebase: this is
 * high-volume, time-ordered, insert-only data whose daily retention delete
 * (RiskPingService.purgeOldPings, risk_ping_retention_days) range-scans
 * independently of the order it came from.
 */
export class CourierLocationPings1786307155509 implements MigrationInterface {
  name = 'CourierLocationPings1786307155509';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "courier_location_pings" (
                "id" BIGSERIAL PRIMARY KEY,
                "orderId" uuid NOT NULL,
                "courierUserId" uuid NOT NULL,
                "shopId" uuid,
                "latitude" double precision NOT NULL,
                "longitude" double precision NOT NULL,
                "accuracy" real,
                "mocked" boolean,
                "source" character varying(16) NOT NULL DEFAULT 'background',
                "deviceId" character varying(64),
                "capturedAt" TIMESTAMP WITH TIME ZONE,
                "receivedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "segmentKm" double precision,
                "segmentKmh" double precision
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_clp_order_received" ON "courier_location_pings" ("orderId", "receivedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_clp_courier_received" ON "courier_location_pings" ("courierUserId", "receivedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_clp_received" ON "courier_location_pings" ("receivedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_clp_received"`);
    await queryRunner.query(`DROP INDEX "IDX_clp_courier_received"`);
    await queryRunner.query(`DROP INDEX "IDX_clp_order_received"`);
    await queryRunner.query(`DROP TABLE "courier_location_pings"`);
  }
}
