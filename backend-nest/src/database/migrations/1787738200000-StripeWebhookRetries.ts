import { MigrationInterface, QueryRunner } from 'typeorm';

export class StripeWebhookRetries1787738200000 implements MigrationInterface {
  name = 'StripeWebhookRetries1787738200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stripe_webhook_events"
        ADD COLUMN IF NOT EXISTS "Retryable" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "AttemptCount" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "NextAttemptAt" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "ClaimedAt" timestamptz NULL;
      CREATE INDEX IF NOT EXISTS "IDX_stripe_webhook_retry_due"
        ON "stripe_webhook_events" ("NextAttemptAt", "ReceivedAt")
        WHERE "Retryable"=true AND "ProcessingStatus"='Failed';
      CREATE INDEX IF NOT EXISTS "IDX_stripe_webhook_stale_claim"
        ON "stripe_webhook_events" ("ClaimedAt")
        WHERE "Retryable"=true AND "ProcessingStatus"='Processing';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_stripe_webhook_stale_claim";
      DROP INDEX IF EXISTS "IDX_stripe_webhook_retry_due";
      ALTER TABLE "stripe_webhook_events"
        DROP COLUMN IF EXISTS "ClaimedAt",
        DROP COLUMN IF EXISTS "NextAttemptAt",
        DROP COLUMN IF EXISTS "AttemptCount",
        DROP COLUMN IF EXISTS "Retryable";
    `);
  }
}
