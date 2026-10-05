import { MigrationInterface, QueryRunner } from 'typeorm';

export class DurableUsageAcceptance1787737800000 implements MigrationInterface {
  name = 'DurableUsageAcceptance1787737800000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_usage_event_id_tenant"
        ON "ai_usage_events" ("Id", "OrganizationId");
      CREATE TABLE IF NOT EXISTS "usage_event_processing" (
        "Id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "OrganizationId" uuid NOT NULL,
        "UsageEventId" uuid NOT NULL,
        "Status" varchar(20) NOT NULL,
        "ProcessedAt" timestamptz,
        "FailureCount" integer NOT NULL DEFAULT 0,
        "LastFailureCategory" varchar(80),
        "LastAttemptAt" timestamptz,
        "CreatedAt" timestamptz NOT NULL,
        "UpdatedAt" timestamptz NOT NULL,
        CONSTRAINT "PK_usage_event_processing" PRIMARY KEY ("Id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_usage_processing_event_tenant"
        ON "usage_event_processing" ("OrganizationId", "UsageEventId");
      CREATE INDEX IF NOT EXISTS "IDX_usage_processing_replay"
        ON "usage_event_processing" ("OrganizationId", "Status", "UpdatedAt");
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='FK_usage_processing_event_tenant') THEN
          ALTER TABLE "usage_event_processing" ADD CONSTRAINT "FK_usage_processing_event_tenant"
            FOREIGN KEY ("UsageEventId", "OrganizationId")
            REFERENCES "ai_usage_events"("Id", "OrganizationId") ON DELETE CASCADE;
        END IF;
      END $$;
      INSERT INTO "usage_event_processing"
        ("OrganizationId", "UsageEventId", "Status", "ProcessedAt", "FailureCount",
         "LastFailureCategory", "LastAttemptAt", "CreatedAt", "UpdatedAt")
      SELECT u."OrganizationId", u."Id", 'processed', u."CreatedAt", 0, NULL,
        u."CreatedAt", u."CreatedAt", u."CreatedAt"
      FROM "ai_usage_events" u
      WHERE NOT EXISTS (SELECT 1 FROM "usage_event_processing" p
        WHERE p."OrganizationId"=u."OrganizationId" AND p."UsageEventId"=u."Id");
      CREATE OR REPLACE FUNCTION marginos_reject_usage_event_update() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Accepted usage event facts are immutable';
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS "TR_usage_event_immutable" ON "ai_usage_events";
      CREATE TRIGGER "TR_usage_event_immutable" BEFORE UPDATE ON "ai_usage_events"
        FOR EACH ROW EXECUTE FUNCTION marginos_reject_usage_event_update();
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TR_usage_event_immutable" ON "ai_usage_events";
      DROP FUNCTION IF EXISTS marginos_reject_usage_event_update();
      DROP TABLE IF EXISTS "usage_event_processing";
    `);
  }
}
