import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrganizationOnboarding1787737300000 implements MigrationInterface {
  name = 'OrganizationOnboarding1787737300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "OnboardingStartedAt" timestamptz',
    );
    await queryRunner.query(
      'ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "OnboardingCompletedAt" timestamptz',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "organizations" DROP COLUMN IF EXISTS "OnboardingCompletedAt"',
    );
    await queryRunner.query(
      'ALTER TABLE "organizations" DROP COLUMN IF EXISTS "OnboardingStartedAt"',
    );
  }
}
