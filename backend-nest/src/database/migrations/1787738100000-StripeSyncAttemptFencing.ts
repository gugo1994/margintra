import { MigrationInterface, QueryRunner } from 'typeorm';

export class StripeSyncAttemptFencing1787738100000 implements MigrationInterface {
  name = 'StripeSyncAttemptFencing1787738100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "stripe_connections" ADD COLUMN IF NOT EXISTS "ActiveSyncAttemptToken" uuid NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "stripe_connections" DROP COLUMN IF EXISTS "ActiveSyncAttemptToken"',
    );
  }
}
