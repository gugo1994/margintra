import { MigrationInterface, QueryRunner } from 'typeorm';

export class CustomerRevenueHistory1787737400000 implements MigrationInterface {
  name = 'CustomerRevenueHistory1787737400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_revenue_snapshots" (
        "Id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "OrganizationId" uuid NOT NULL,
        "CustomerId" uuid NOT NULL,
        "Revenue" numeric(18,6) NOT NULL,
        "Currency" varchar(3) NOT NULL,
        "EffectiveFrom" timestamptz NOT NULL,
        "CreatedAt" timestamptz NOT NULL,
        CONSTRAINT "PK_customer_revenue_snapshots" PRIMARY KEY ("Id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_revenue_history_customer_effective"
        ON "customer_revenue_snapshots" ("OrganizationId", "CustomerId", "EffectiveFrom");
      DO $$ BEGIN
        ALTER TABLE "customer_revenue_snapshots" ADD CONSTRAINT "FK_revenue_history_customer_tenant"
          FOREIGN KEY ("CustomerId", "OrganizationId")
          REFERENCES "customers"("Id", "OrganizationId") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      INSERT INTO "customer_revenue_snapshots"
        ("OrganizationId", "CustomerId", "Revenue", "Currency", "EffectiveFrom", "CreatedAt")
      SELECT c."OrganizationId", c."Id", c."MonthlyRevenue", c."Currency",
        COALESCE(c."RevenueUpdatedAt", c."CreatedAt"), now()
      FROM "customers" c
      WHERE NOT EXISTS (
        SELECT 1 FROM "customer_revenue_snapshots" r
        WHERE r."OrganizationId"=c."OrganizationId" AND r."CustomerId"=c."Id"
      );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "customer_revenue_snapshots"');
  }
}
