import { MigrationInterface, QueryRunner } from 'typeorm';
export class AlertNotifications1787737700000 implements MigrationInterface {
  name = 'AlertNotifications1787737700000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_preferences" (
        "Id" uuid NOT NULL DEFAULT gen_random_uuid(), "OrganizationId" uuid NOT NULL,
        "EmailEnabled" boolean NOT NULL DEFAULT false, "WarningAlertsEnabled" boolean NOT NULL DEFAULT true,
        "CriticalAlertsEnabled" boolean NOT NULL DEFAULT true, "RecoveryAlertsEnabled" boolean NOT NULL DEFAULT true,
        "Recipients" jsonb NOT NULL DEFAULT '[]'::jsonb, "CreatedAt" timestamptz NOT NULL,
        "UpdatedAt" timestamptz NOT NULL, CONSTRAINT "PK_notification_preferences" PRIMARY KEY ("Id"),
        CONSTRAINT "UQ_notification_preferences_org" UNIQUE ("OrganizationId"),
        CONSTRAINT "FK_notification_preferences_org" FOREIGN KEY ("OrganizationId") REFERENCES "organizations"("Id") ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_margin_alert_id_tenant" ON "margin_alerts" ("Id", "OrganizationId");
      CREATE TABLE IF NOT EXISTS "notification_deliveries" (
        "Id" uuid NOT NULL DEFAULT gen_random_uuid(), "OrganizationId" uuid NOT NULL, "AlertId" uuid NOT NULL,
        "Channel" varchar(20) NOT NULL, "Recipient" varchar(320) NOT NULL, "Transition" varchar(40) NOT NULL,
        "Status" varchar(20) NOT NULL, "AttemptCount" integer NOT NULL DEFAULT 0,
        "LastAttemptAt" timestamptz, "NextAttemptAt" timestamptz, "SentAt" timestamptz,
        "FailureReason" varchar(300), "CreatedAt" timestamptz NOT NULL,
        CONSTRAINT "PK_notification_deliveries" PRIMARY KEY ("Id"),
        CONSTRAINT "FK_notification_deliveries_org" FOREIGN KEY ("OrganizationId") REFERENCES "organizations"("Id") ON DELETE CASCADE,
        CONSTRAINT "FK_notification_delivery_alert_tenant" FOREIGN KEY ("AlertId", "OrganizationId")
          REFERENCES "margin_alerts"("Id", "OrganizationId") ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_notification_delivery_transition"
        ON "notification_deliveries" ("OrganizationId", "AlertId", "Channel", "Recipient", "Transition");
      CREATE INDEX IF NOT EXISTS "IDX_notification_delivery_due" ON "notification_deliveries" ("Status", "NextAttemptAt");
      INSERT INTO "notification_preferences" ("OrganizationId", "EmailEnabled", "WarningAlertsEnabled", "CriticalAlertsEnabled", "RecoveryAlertsEnabled", "Recipients", "CreatedAt", "UpdatedAt")
      SELECT o."Id", false, true, true, true, '[]'::jsonb, now(), now() FROM "organizations" o
      WHERE NOT EXISTS (SELECT 1 FROM "notification_preferences" p WHERE p."OrganizationId"=o."Id");
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "notification_deliveries"; DROP TABLE IF EXISTS "notification_preferences";',
    );
  }
}
