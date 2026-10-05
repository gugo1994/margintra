import { MigrationInterface, QueryRunner } from 'typeorm';

export class RevenueSnapshotSequence1787738300000 implements MigrationInterface {
  name = 'RevenueSnapshotSequence1787738300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customer_revenue_snapshots"
        ADD COLUMN IF NOT EXISTS "Sequence" integer NULL;

      WITH ordered AS (
        SELECT "Id",
          ROW_NUMBER() OVER (
            PARTITION BY "OrganizationId", "CustomerId"
            ORDER BY "EffectiveFrom", "CreatedAt", "Id"
          )::integer AS sequence
        FROM "customer_revenue_snapshots"
      )
      UPDATE "customer_revenue_snapshots" snapshot
      SET "Sequence"=ordered.sequence
      FROM ordered
      WHERE snapshot."Id"=ordered."Id" AND snapshot."Sequence" IS NULL;

      ALTER TABLE "customer_revenue_snapshots"
        ALTER COLUMN "Sequence" SET NOT NULL;
      DROP INDEX IF EXISTS "IDX_revenue_history_customer_effective";
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_revenue_history_customer_sequence"
        ON "customer_revenue_snapshots" ("OrganizationId", "CustomerId", "Sequence");
      CREATE INDEX IF NOT EXISTS "IDX_revenue_history_point_in_time"
        ON "customer_revenue_snapshots"
          ("OrganizationId", "CustomerId", "EffectiveFrom" DESC, "Sequence" DESC);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_revenue_history_point_in_time";
      DROP INDEX IF EXISTS "IDX_revenue_history_customer_sequence";
      ALTER TABLE "customer_revenue_snapshots" DROP COLUMN IF EXISTS "Sequence";
    `);
  }
}
