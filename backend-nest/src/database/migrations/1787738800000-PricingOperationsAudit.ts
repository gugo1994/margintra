import { MigrationInterface, QueryRunner } from 'typeorm';

export class PricingOperationsAudit1787738800000 implements MigrationInterface {
  name = 'PricingOperationsAudit1787738800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ai_model_pricing ADD COLUMN "OperatorSource" varchar(100);
      ALTER TABLE ai_model_pricing ADD COLUMN "ActivatedAt" timestamptz;
      ALTER TABLE ai_model_pricing ADD COLUMN "RetiredAt" timestamptz;
      UPDATE ai_model_pricing SET "ActivatedAt"=COALESCE("LastVerifiedAt","CreatedAt"),
        "OperatorSource"='built-in migration'
      WHERE "Status"='active' AND "ActivatedAt" IS NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ai_model_pricing DROP COLUMN IF EXISTS "RetiredAt";
      ALTER TABLE ai_model_pricing DROP COLUMN IF EXISTS "ActivatedAt";
      ALTER TABLE ai_model_pricing DROP COLUMN IF EXISTS "OperatorSource";
    `);
  }
}
