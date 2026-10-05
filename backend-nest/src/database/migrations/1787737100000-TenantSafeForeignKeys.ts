import { MigrationInterface, QueryRunner } from 'typeorm';

/** Restores and strengthens relational integrity after migration ownership handoff. */
export class TenantSafeForeignKeys1787737100000 implements MigrationInterface {
  name = 'TenantSafeForeignKeys1787737100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UX_customers_Id_OrganizationId"
        ON "customers" ("Id", "OrganizationId");
      CREATE UNIQUE INDEX IF NOT EXISTS "UX_stripe_connections_Id_OrganizationId"
        ON "stripe_connections" ("Id", "OrganizationId");

      DO $$ BEGIN
        ALTER TABLE "organization_members" ADD CONSTRAINT "FK_members_organization"
          FOREIGN KEY ("OrganizationId") REFERENCES "organizations"("Id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        ALTER TABLE "organization_members" ADD CONSTRAINT "FK_members_user"
          FOREIGN KEY ("UserId") REFERENCES "users"("Id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        ALTER TABLE "customers" ADD CONSTRAINT "FK_customers_organization"
          FOREIGN KEY ("OrganizationId") REFERENCES "organizations"("Id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        ALTER TABLE "ai_usage_events" ADD CONSTRAINT "FK_usage_customer_tenant"
          FOREIGN KEY ("CustomerId", "OrganizationId")
          REFERENCES "customers"("Id", "OrganizationId") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        ALTER TABLE "margin_snapshots" ADD CONSTRAINT "FK_snapshots_customer_tenant"
          FOREIGN KEY ("CustomerId", "OrganizationId")
          REFERENCES "customers"("Id", "OrganizationId") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        ALTER TABLE "margin_alerts" ADD CONSTRAINT "FK_alerts_customer_tenant"
          FOREIGN KEY ("CustomerId", "OrganizationId")
          REFERENCES "customers"("Id", "OrganizationId") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        ALTER TABLE "stripe_connections" ADD CONSTRAINT "FK_connections_organization"
          FOREIGN KEY ("OrganizationId") REFERENCES "organizations"("Id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "FK_subscriptions_customer_tenant"
          FOREIGN KEY ("CustomerId", "OrganizationId")
          REFERENCES "customers"("Id", "OrganizationId") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        ALTER TABLE "stripe_webhook_events" ADD CONSTRAINT "FK_webhooks_connection_tenant"
          FOREIGN KEY ("StripeConnectionId", "OrganizationId")
          REFERENCES "stripe_connections"("Id", "OrganizationId") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stripe_webhook_events" DROP CONSTRAINT IF EXISTS "FK_webhooks_connection_tenant";
      ALTER TABLE "billing_subscriptions" DROP CONSTRAINT IF EXISTS "FK_subscriptions_customer_tenant";
      ALTER TABLE "stripe_connections" DROP CONSTRAINT IF EXISTS "FK_connections_organization";
      ALTER TABLE "margin_alerts" DROP CONSTRAINT IF EXISTS "FK_alerts_customer_tenant";
      ALTER TABLE "margin_snapshots" DROP CONSTRAINT IF EXISTS "FK_snapshots_customer_tenant";
      ALTER TABLE "ai_usage_events" DROP CONSTRAINT IF EXISTS "FK_usage_customer_tenant";
      ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "FK_customers_organization";
      ALTER TABLE "organization_members" DROP CONSTRAINT IF EXISTS "FK_members_user";
      ALTER TABLE "organization_members" DROP CONSTRAINT IF EXISTS "FK_members_organization";
      DROP INDEX IF EXISTS "UX_stripe_connections_Id_OrganizationId";
      DROP INDEX IF EXISTS "UX_customers_Id_OrganizationId";
    `);
  }
}
