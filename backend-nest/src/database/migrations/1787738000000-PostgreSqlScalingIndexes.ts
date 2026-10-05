import { MigrationInterface, QueryRunner } from 'typeorm';

export class PostgreSqlScalingIndexes1787738000000 implements MigrationInterface {
  name = 'PostgreSqlScalingIndexes1787738000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_usage_processing_due";
      DROP INDEX IF EXISTS "IDX_usage_processing_replay";
      CREATE INDEX IF NOT EXISTS "IDX_usage_processing_retry_due"
        ON "usage_event_processing" ("NextRetryAt", "CreatedAt")
        WHERE "Retryable"=true AND "Status" IN ('pending','failed');
      CREATE INDEX IF NOT EXISTS "IDX_usage_processing_stale_claim"
        ON "usage_event_processing" ("ClaimedAt") WHERE "Status"='processing';

      DROP INDEX IF EXISTS "IDX_notification_delivery_due";
      CREATE INDEX IF NOT EXISTS "IDX_notification_pending_due"
        ON "notification_deliveries" ("NextAttemptAt", "CreatedAt") WHERE "Status"='pending';
      CREATE INDEX IF NOT EXISTS "IDX_notification_stale_claim"
        ON "notification_deliveries" ("LastAttemptAt") WHERE "Status"='processing';
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_usage_processing_retry_due";
      DROP INDEX IF EXISTS "IDX_usage_processing_stale_claim";
      CREATE INDEX IF NOT EXISTS "IDX_usage_processing_due"
        ON "usage_event_processing" ("Status", "NextRetryAt", "ClaimedAt")
        WHERE "Status" IN ('pending','failed','processing');
      CREATE INDEX IF NOT EXISTS "IDX_usage_processing_replay"
        ON "usage_event_processing" ("OrganizationId", "Status", "UpdatedAt");
      DROP INDEX IF EXISTS "IDX_notification_pending_due";
      DROP INDEX IF EXISTS "IDX_notification_stale_claim";
      CREATE INDEX IF NOT EXISTS "IDX_notification_delivery_due"
        ON "notification_deliveries" ("Status", "NextAttemptAt");
    `);
  }
}
