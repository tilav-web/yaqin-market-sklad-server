import { MigrationInterface, QueryRunner } from 'typeorm';

export class SavedCardLabel1784738902863 implements MigrationInterface {
  name = 'SavedCardLabel1784738902863';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "saved_card" ADD "label" character varying(40)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "saved_card" DROP COLUMN "label"`);
  }
}
