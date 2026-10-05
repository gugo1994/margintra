import { MigrationInterface, QueryRunner } from 'typeorm';

export class PricingCanonicalModel1787738500000 implements MigrationInterface {
  name = 'PricingCanonicalModel1787738500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ai_model_pricing ADD COLUMN IF NOT EXISTS "PricingModel" varchar(200);
      UPDATE ai_model_pricing SET "PricingModel"=CASE
        WHEN "Provider"='openai' AND "Model"='gpt-5-2025-08-07' THEN 'gpt-5'
        ELSE "Model" END
      WHERE "PricingModel" IS NULL;
      ALTER TABLE ai_model_pricing ALTER COLUMN "PricingModel" SET NOT NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE ai_model_pricing DROP COLUMN IF EXISTS "PricingModel"');
  }
}
