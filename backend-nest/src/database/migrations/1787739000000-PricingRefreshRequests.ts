import { MigrationInterface, QueryRunner } from 'typeorm';

export class PricingRefreshRequests1787739000000 implements MigrationInterface {
  name = 'PricingRefreshRequests1787739000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "pricing_refresh_requests" (
        "Provider" varchar(100) NOT NULL,
        "RequestedModels" text[] NOT NULL DEFAULT '{}',
        "RequestedAt" timestamptz NOT NULL,
        "NextAttemptAt" timestamptz NOT NULL,
        "ClaimedAt" timestamptz,
        "AttemptCount" integer NOT NULL DEFAULT 0,
        "LastAttemptAt" timestamptz,
        "LastSuccessfulAt" timestamptz,
        "LastErrorCategory" varchar(80),
        "CreatedAt" timestamptz NOT NULL,
        "UpdatedAt" timestamptz NOT NULL,
        CONSTRAINT "PK_pricing_refresh_requests" PRIMARY KEY ("Provider")
      );
      CREATE INDEX "IDX_pricing_refresh_requests_due"
        ON "pricing_refresh_requests" ("NextAttemptAt") WHERE "ClaimedAt" IS NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "pricing_refresh_requests"');
  }
}
