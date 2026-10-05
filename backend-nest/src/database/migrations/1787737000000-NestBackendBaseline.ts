import { MigrationInterface, QueryRunner, TableForeignKey } from 'typeorm';

/**
 * Establishes the NestJS handoff on both empty databases and databases already
 * created by the pre-Nest backend. Schema-builder queries are generated from the entity
 * metadata registered on this migration's DataSource and executed transactionally.
 */
export class NestBackendBaseline1787737000000 implements MigrationInterface {
  name = 'NestBackendBaseline1787737000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Existing installations were created by the final EF migration and are
    // already authoritative. Recording the baseline must not diff or rewrite it.
    if (await queryRunner.hasTable('organizations')) return;

    const schema = await queryRunner.connection.driver.createSchemaBuilder().log();
    for (const query of schema.upQueries) {
      await queryRunner.query(query.query, query.parameters);
    }

    const foreignKeys: Array<[string, string, string, string]> = [
      ['organization_members', 'OrganizationId', 'organizations', 'Id'],
      ['organization_members', 'UserId', 'users', 'Id'],
      ['customers', 'OrganizationId', 'organizations', 'Id'],
      ['ai_usage_events', 'OrganizationId', 'organizations', 'Id'],
      ['ai_usage_events', 'CustomerId', 'customers', 'Id'],
      ['margin_snapshots', 'OrganizationId', 'organizations', 'Id'],
      ['margin_snapshots', 'CustomerId', 'customers', 'Id'],
      ['margin_alerts', 'OrganizationId', 'organizations', 'Id'],
      ['margin_alerts', 'CustomerId', 'customers', 'Id'],
      ['stripe_connections', 'OrganizationId', 'organizations', 'Id'],
      ['billing_subscriptions', 'OrganizationId', 'organizations', 'Id'],
      ['billing_subscriptions', 'CustomerId', 'customers', 'Id'],
      ['stripe_webhook_events', 'OrganizationId', 'organizations', 'Id'],
      ['stripe_webhook_events', 'StripeConnectionId', 'stripe_connections', 'Id'],
    ];
    for (const [table, column, referencedTable, referencedColumn] of foreignKeys) {
      await queryRunner.createForeignKey(
        table,
        new TableForeignKey({
          columnNames: [column],
          referencedTableName: referencedTable,
          referencedColumnNames: [referencedColumn],
          onDelete: 'CASCADE',
        }),
      );
    }
  }

  down(): Promise<void> {
    // A handoff baseline must never drop an existing production schema.
    return Promise.resolve();
  }
}
