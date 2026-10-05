import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoricalGuardrails1787737600000 implements MigrationInterface {
  name = 'HistoricalGuardrails1787737600000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "organization_guardrail_versions" (
        "Id" uuid NOT NULL DEFAULT gen_random_uuid(), "OrganizationId" uuid NOT NULL,
        "TargetGrossMargin" numeric(5,2) NOT NULL, "WarningThreshold" numeric(5,2) NOT NULL,
        "CriticalThreshold" numeric(5,2) NOT NULL, "EffectiveFrom" timestamptz NOT NULL,
        "CreatedAt" timestamptz NOT NULL, CONSTRAINT "PK_organization_guardrail_versions" PRIMARY KEY ("Id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_org_guardrails_effective"
        ON "organization_guardrail_versions" ("OrganizationId", "EffectiveFrom");
      ALTER TABLE "organization_guardrail_versions" ADD CONSTRAINT "FK_org_guardrails_organization"
        FOREIGN KEY ("OrganizationId") REFERENCES "organizations"("Id") ON DELETE CASCADE;
      CREATE TABLE IF NOT EXISTS "customer_guardrail_versions" (
        "Id" uuid NOT NULL DEFAULT gen_random_uuid(), "OrganizationId" uuid NOT NULL,
        "CustomerId" uuid NOT NULL, "TargetGrossMarginOverride" numeric(5,2),
        "WarningThresholdOverride" numeric(5,2), "CriticalThresholdOverride" numeric(5,2),
        "EffectiveFrom" timestamptz NOT NULL, "CreatedAt" timestamptz NOT NULL,
        CONSTRAINT "PK_customer_guardrail_versions" PRIMARY KEY ("Id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_customer_guardrails_effective"
        ON "customer_guardrail_versions" ("OrganizationId", "CustomerId", "EffectiveFrom");
      ALTER TABLE "customer_guardrail_versions" ADD CONSTRAINT "FK_customer_guardrails_customer_tenant"
        FOREIGN KEY ("CustomerId", "OrganizationId") REFERENCES "customers"("Id", "OrganizationId") ON DELETE CASCADE;
      INSERT INTO "organization_guardrail_versions"
        ("OrganizationId", "TargetGrossMargin", "WarningThreshold", "CriticalThreshold", "EffectiveFrom", "CreatedAt")
      SELECT o."Id", o."TargetGrossMargin", o."BudgetWarningThreshold", o."BudgetCriticalThreshold", o."CreatedAt", now()
      FROM "organizations" o WHERE NOT EXISTS (
        SELECT 1 FROM "organization_guardrail_versions" v WHERE v."OrganizationId"=o."Id");
      INSERT INTO "customer_guardrail_versions"
        ("OrganizationId", "CustomerId", "TargetGrossMarginOverride", "WarningThresholdOverride", "CriticalThresholdOverride", "EffectiveFrom", "CreatedAt")
      SELECT c."OrganizationId", c."Id", c."TargetGrossMarginOverride", c."BudgetWarningThresholdOverride",
        c."BudgetCriticalThresholdOverride", c."CreatedAt", now()
      FROM "customers" c WHERE NOT EXISTS (
        SELECT 1 FROM "customer_guardrail_versions" v
        WHERE v."OrganizationId"=c."OrganizationId" AND v."CustomerId"=c."Id");
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "customer_guardrail_versions"; DROP TABLE IF EXISTS "organization_guardrail_versions";',
    );
  }
}
