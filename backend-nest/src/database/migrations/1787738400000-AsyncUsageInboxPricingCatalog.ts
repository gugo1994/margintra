import { MigrationInterface, QueryRunner } from 'typeorm';

export class AsyncUsageInboxPricingCatalog1787738400000 implements MigrationInterface {
  name = 'AsyncUsageInboxPricingCatalog1787738400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "usage_ingestion_inbox" (
        "Id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "OrganizationId" uuid NOT NULL,
        "ExternalRequestId" varchar(300) NOT NULL,
        "CustomerExternalId" varchar(200) NOT NULL,
        "Provider" varchar(100) NOT NULL,
        "Model" varchar(200) NOT NULL,
        "Feature" varchar(200) NOT NULL,
        "InputTokens" bigint NOT NULL,
        "OutputTokens" bigint NOT NULL,
        "OccurredAt" timestamptz NOT NULL,
        "Metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "ExplicitCost" numeric(18,6),
        "ExplicitCostCurrency" varchar(3),
        "ProcessingStatus" varchar(30) NOT NULL,
        "AttemptCount" integer NOT NULL DEFAULT 0,
        "NextAttemptAt" timestamptz,
        "ClaimedAt" timestamptz,
        "LastErrorCode" varchar(80),
        "LastErrorMessage" varchar(300),
        "ProcessedAt" timestamptz,
        "UsageEventId" uuid,
        "CreatedAt" timestamptz NOT NULL,
        "UpdatedAt" timestamptz NOT NULL,
        CONSTRAINT "PK_usage_ingestion_inbox" PRIMARY KEY ("Id"),
        CONSTRAINT "FK_usage_inbox_organization" FOREIGN KEY ("OrganizationId")
          REFERENCES organizations("Id") ON DELETE CASCADE,
        CONSTRAINT "FK_usage_inbox_usage_event" FOREIGN KEY ("UsageEventId")
          REFERENCES ai_usage_events("Id") ON DELETE SET NULL
      );
      CREATE UNIQUE INDEX "UQ_usage_inbox_org_request"
        ON "usage_ingestion_inbox" ("OrganizationId", "ExternalRequestId");
      CREATE INDEX "IDX_usage_inbox_due" ON "usage_ingestion_inbox" ("NextAttemptAt", "CreatedAt")
        WHERE "ProcessingStatus" IN ('pending','failed');
      CREATE INDEX "IDX_usage_inbox_stale" ON "usage_ingestion_inbox" ("ClaimedAt")
        WHERE "ProcessingStatus"='processing';
      CREATE INDEX "IDX_usage_inbox_pending_pricing"
        ON "usage_ingestion_inbox" ("Provider", "Model", "OccurredAt")
        WHERE "ProcessingStatus"='pending_pricing';

      CREATE TABLE "ai_model_pricing" (
        "Id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "Provider" varchar(100) NOT NULL,
        "Model" varchar(200) NOT NULL,
        "InputPricePerMillion" numeric(18,8) NOT NULL,
        "OutputPricePerMillion" numeric(18,8) NOT NULL,
        "Currency" varchar(3) NOT NULL,
        "EffectiveFrom" timestamptz NOT NULL,
        "EffectiveTo" timestamptz,
        "Version" varchar(100) NOT NULL,
        "SourceType" varchar(30) NOT NULL,
        "SourceReference" varchar(500),
        "Status" varchar(20) NOT NULL,
        "LastVerifiedAt" timestamptz,
        "CreatedAt" timestamptz NOT NULL,
        "UpdatedAt" timestamptz NOT NULL,
        CONSTRAINT "PK_ai_model_pricing" PRIMARY KEY ("Id"),
        CONSTRAINT "CK_ai_model_pricing_range" CHECK ("EffectiveTo" IS NULL OR "EffectiveTo">"EffectiveFrom")
      );
      CREATE UNIQUE INDEX "UQ_ai_model_pricing_version"
        ON "ai_model_pricing" ("Provider", "Model", "Version");
      CREATE INDEX "IDX_ai_model_pricing_active_range"
        ON "ai_model_pricing" ("Provider", "Model", "EffectiveFrom")
        WHERE "Status"='active';

      ALTER TABLE ai_usage_events ADD COLUMN "PricingId" uuid;
      ALTER TABLE ai_usage_events ADD CONSTRAINT "FK_usage_pricing"
        FOREIGN KEY ("PricingId") REFERENCES ai_model_pricing("Id") ON DELETE RESTRICT;

      INSERT INTO ai_model_pricing
        ("Provider","Model","InputPricePerMillion","OutputPricePerMillion","Currency",
         "EffectiveFrom","EffectiveTo","Version","SourceType","SourceReference","Status",
         "LastVerifiedAt","CreatedAt","UpdatedAt")
      VALUES
        ('openai','gpt-5',1.25,10,'USD','2025-08-07T00:00:00Z',NULL,
         'openai-gpt5-2025-08-07','built_in_migration','existing MarginOS catalog','active',now(),now(),now()),
        ('openai','gpt-5-2025-08-07',1.25,10,'USD','2025-08-07T00:00:00Z',NULL,
         'openai-gpt5-2025-08-07','built_in_migration','existing MarginOS catalog','active',now(),now(),now()),
        ('openai','gpt-5-mini',0.25,2,'USD','2025-08-07T00:00:00Z',NULL,
         'openai-gpt5-2025-08-07','built_in_migration','existing MarginOS catalog','active',now(),now(),now()),
        ('openai','gpt-5-nano',0.05,0.40,'USD','2025-08-07T00:00:00Z',NULL,
         'openai-gpt5-2025-08-07','built_in_migration','existing MarginOS catalog','active',now(),now(),now());

      CREATE OR REPLACE FUNCTION marginos_protect_usage_inbox_facts() RETURNS trigger AS $$
      BEGIN
        IF ROW(NEW."OrganizationId",NEW."ExternalRequestId",NEW."CustomerExternalId",NEW."Provider",
          NEW."Model",NEW."Feature",NEW."InputTokens",NEW."OutputTokens",NEW."OccurredAt",NEW."Metadata",
          NEW."ExplicitCost",NEW."ExplicitCostCurrency") IS DISTINCT FROM
          ROW(OLD."OrganizationId",OLD."ExternalRequestId",OLD."CustomerExternalId",OLD."Provider",
          OLD."Model",OLD."Feature",OLD."InputTokens",OLD."OutputTokens",OLD."OccurredAt",OLD."Metadata",
          OLD."ExplicitCost",OLD."ExplicitCostCurrency") THEN
          RAISE EXCEPTION 'Accepted usage inbox facts are immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER "TR_usage_inbox_facts_immutable" BEFORE UPDATE ON usage_ingestion_inbox
        FOR EACH ROW EXECUTE FUNCTION marginos_protect_usage_inbox_facts();
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TR_usage_inbox_facts_immutable" ON usage_ingestion_inbox;
      DROP FUNCTION IF EXISTS marginos_protect_usage_inbox_facts();
      ALTER TABLE ai_usage_events DROP CONSTRAINT IF EXISTS "FK_usage_pricing";
      ALTER TABLE ai_usage_events DROP COLUMN IF EXISTS "PricingId";
      DROP TABLE IF EXISTS usage_ingestion_inbox;
      DROP TABLE IF EXISTS ai_model_pricing;
    `);
  }
}
