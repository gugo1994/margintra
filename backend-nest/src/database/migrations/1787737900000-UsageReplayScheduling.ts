import { MigrationInterface, QueryRunner } from 'typeorm';

export class UsageReplayScheduling1787737900000 implements MigrationInterface {
  name = 'UsageReplayScheduling1787737900000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "usage_event_processing" ADD COLUMN IF NOT EXISTS "NextRetryAt" timestamptz;
      ALTER TABLE "usage_event_processing" ADD COLUMN IF NOT EXISTS "ClaimedAt" timestamptz;
      ALTER TABLE "usage_event_processing" ADD COLUMN IF NOT EXISTS "Retryable" boolean NOT NULL DEFAULT true;
      UPDATE "usage_event_processing" SET "NextRetryAt"=now()
        WHERE "Status" IN ('pending','failed') AND "NextRetryAt" IS NULL AND "Retryable"=true;
      CREATE INDEX IF NOT EXISTS "IDX_usage_processing_due"
        ON "usage_event_processing" ("Status", "NextRetryAt", "ClaimedAt")
        WHERE "Status" IN ('pending','failed','processing');
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_usage_processing_due";
      ALTER TABLE "usage_event_processing" DROP COLUMN IF EXISTS "Retryable";
      ALTER TABLE "usage_event_processing" DROP COLUMN IF EXISTS "ClaimedAt";
      ALTER TABLE "usage_event_processing" DROP COLUMN IF EXISTS "NextRetryAt";
    `);
  }
}
