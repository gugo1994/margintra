import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProtectPricingHistory1787738600000 implements MigrationInterface {
  name = 'ProtectPricingHistory1787738600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION marginos_protect_pricing_facts() RETURNS trigger AS $$
      BEGIN
        IF ROW(NEW."Provider",NEW."Model",NEW."PricingModel",NEW."InputPricePerMillion",
          NEW."OutputPricePerMillion",NEW."Currency",NEW."EffectiveFrom",NEW."Version",
          NEW."SourceType",NEW."SourceReference") IS DISTINCT FROM
          ROW(OLD."Provider",OLD."Model",OLD."PricingModel",OLD."InputPricePerMillion",
          OLD."OutputPricePerMillion",OLD."Currency",OLD."EffectiveFrom",OLD."Version",
          OLD."SourceType",OLD."SourceReference") THEN
          RAISE EXCEPTION 'Historical pricing facts are immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER "TR_ai_model_pricing_facts_immutable"
        BEFORE UPDATE ON ai_model_pricing FOR EACH ROW
        EXECUTE FUNCTION marginos_protect_pricing_facts();
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TR_ai_model_pricing_facts_immutable" ON ai_model_pricing;
      DROP FUNCTION IF EXISTS marginos_protect_pricing_facts();
    `);
  }
}
