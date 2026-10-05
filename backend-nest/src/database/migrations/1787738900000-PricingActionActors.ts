import { MigrationInterface, QueryRunner } from 'typeorm';

export class PricingActionActors1787738900000 implements MigrationInterface {
  name = 'PricingActionActors1787738900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ai_model_pricing ADD COLUMN "CreatedBy" varchar(100);
      ALTER TABLE ai_model_pricing ADD COLUMN "ActivatedBy" varchar(100);
      ALTER TABLE ai_model_pricing ADD COLUMN "RetiredBy" varchar(100);
      UPDATE ai_model_pricing SET "CreatedBy"="OperatorSource",
        "ActivatedBy"=CASE WHEN "ActivatedAt" IS NOT NULL THEN "OperatorSource" ELSE NULL END,
        "RetiredBy"=CASE WHEN "RetiredAt" IS NOT NULL THEN "OperatorSource" ELSE NULL END;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ai_model_pricing DROP COLUMN IF EXISTS "RetiredBy";
      ALTER TABLE ai_model_pricing DROP COLUMN IF EXISTS "ActivatedBy";
      ALTER TABLE ai_model_pricing DROP COLUMN IF EXISTS "CreatedBy";
    `);
  }
}
