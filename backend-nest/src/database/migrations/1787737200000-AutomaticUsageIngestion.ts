import { MigrationInterface, QueryRunner } from 'typeorm';

export class AutomaticUsageIngestion1787737200000 implements MigrationInterface {
  name = 'AutomaticUsageIngestion1787737200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ai_usage_events" ADD COLUMN IF NOT EXISTS "Currency" varchar(3) NOT NULL DEFAULT 'USD';
      ALTER TABLE "ai_usage_events" ADD COLUMN IF NOT EXISTS "CostSource" varchar(20) NOT NULL DEFAULT 'explicit';
      ALTER TABLE "ai_usage_events" ADD COLUMN IF NOT EXISTS "PricingVersion" varchar(100);
      ALTER TABLE "ai_usage_events" ADD COLUMN IF NOT EXISTS "PricingModel" varchar(200);
      ALTER TABLE "ai_usage_events" ADD COLUMN IF NOT EXISTS "Metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;
      CREATE INDEX IF NOT EXISTS "IDX_usage_org_occurred" ON "ai_usage_events" ("OrganizationId", "OccurredAt");
      CREATE INDEX IF NOT EXISTS "IDX_usage_org_provider_occurred" ON "ai_usage_events" ("OrganizationId", "Provider", "OccurredAt");
      CREATE INDEX IF NOT EXISTS "IDX_usage_org_feature_occurred" ON "ai_usage_events" ("OrganizationId", "Feature", "OccurredAt");

      CREATE TABLE IF NOT EXISTS "ingestion_api_keys" (
        "Id" uuid PRIMARY KEY,
        "OrganizationId" uuid NOT NULL,
        "Name" varchar(100) NOT NULL,
        "KeyId" varchar(24) NOT NULL,
        "KeyPrefix" varchar(40) NOT NULL,
        "SecretHash" varchar(200) NOT NULL,
        "Status" varchar(20) NOT NULL,
        "CreatedAt" timestamptz NOT NULL,
        "RevokedAt" timestamptz,
        "LastUsedAt" timestamptz
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "UX_ingestion_keys_key_id" ON "ingestion_api_keys" ("KeyId");
      CREATE INDEX IF NOT EXISTS "IDX_ingestion_keys_org_created" ON "ingestion_api_keys" ("OrganizationId", "CreatedAt");
      DO $$ BEGIN
        ALTER TABLE "ingestion_api_keys" ADD CONSTRAINT "FK_ingestion_keys_organization"
          FOREIGN KEY ("OrganizationId") REFERENCES "organizations"("Id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "ingestion_api_keys";
      DROP INDEX IF EXISTS "IDX_usage_org_feature_occurred";
      DROP INDEX IF EXISTS "IDX_usage_org_provider_occurred";
      DROP INDEX IF EXISTS "IDX_usage_org_occurred";
      ALTER TABLE "ai_usage_events" DROP COLUMN IF EXISTS "Metadata";
      ALTER TABLE "ai_usage_events" DROP COLUMN IF EXISTS "PricingModel";
      ALTER TABLE "ai_usage_events" DROP COLUMN IF EXISTS "PricingVersion";
      ALTER TABLE "ai_usage_events" DROP COLUMN IF EXISTS "CostSource";
      ALTER TABLE "ai_usage_events" DROP COLUMN IF EXISTS "Currency";
    `);
  }
}
