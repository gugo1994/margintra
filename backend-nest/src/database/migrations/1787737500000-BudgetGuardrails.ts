import { MigrationInterface, QueryRunner } from 'typeorm';

export class BudgetGuardrails1787737500000 implements MigrationInterface {
  name = 'BudgetGuardrails1787737500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN IF NOT EXISTS "BudgetWarningThreshold" numeric(5,2) NOT NULL DEFAULT 80,
        ADD COLUMN IF NOT EXISTS "BudgetCriticalThreshold" numeric(5,2) NOT NULL DEFAULT 100;
      ALTER TABLE "customers"
        ADD COLUMN IF NOT EXISTS "TargetGrossMarginOverride" numeric(5,2),
        ADD COLUMN IF NOT EXISTS "BudgetWarningThresholdOverride" numeric(5,2),
        ADD COLUMN IF NOT EXISTS "BudgetCriticalThresholdOverride" numeric(5,2);
      ALTER TABLE "organizations"
        ADD CONSTRAINT "CK_organizations_budget_thresholds"
        CHECK ("BudgetWarningThreshold">=0 AND "BudgetWarningThreshold"<"BudgetCriticalThreshold" AND "BudgetCriticalThreshold"<=100);
      ALTER TABLE "customers"
        ADD CONSTRAINT "CK_customers_target_override"
        CHECK ("TargetGrossMarginOverride" IS NULL OR ("TargetGrossMarginOverride">0 AND "TargetGrossMarginOverride"<100));
      ALTER TABLE "customers"
        ADD CONSTRAINT "CK_customers_budget_overrides"
        CHECK (("BudgetWarningThresholdOverride" IS NULL OR "BudgetWarningThresholdOverride">=0)
          AND ("BudgetCriticalThresholdOverride" IS NULL OR "BudgetCriticalThresholdOverride"<=100));
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "CK_customers_budget_overrides";
      ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "CK_customers_target_override";
      ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "CK_organizations_budget_thresholds";
      ALTER TABLE "customers" DROP COLUMN IF EXISTS "BudgetCriticalThresholdOverride";
      ALTER TABLE "customers" DROP COLUMN IF EXISTS "BudgetWarningThresholdOverride";
      ALTER TABLE "customers" DROP COLUMN IF EXISTS "TargetGrossMarginOverride";
      ALTER TABLE "organizations" DROP COLUMN IF EXISTS "BudgetCriticalThreshold";
      ALTER TABLE "organizations" DROP COLUMN IF EXISTS "BudgetWarningThreshold";
    `);
  }
}
