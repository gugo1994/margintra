import { QueryRunner } from 'typeorm';
import { NestBackendBaseline1787737000000 } from '../../src/database/migrations/1787737000000-NestBackendBaseline';
import { AutomaticUsageIngestion1787737200000 } from '../../src/database/migrations/1787737200000-AutomaticUsageIngestion';
import { CustomerRevenueHistory1787737400000 } from '../../src/database/migrations/1787737400000-CustomerRevenueHistory';
import { BudgetGuardrails1787737500000 } from '../../src/database/migrations/1787737500000-BudgetGuardrails';
import { HistoricalGuardrails1787737600000 } from '../../src/database/migrations/1787737600000-HistoricalGuardrails';
import { AlertNotifications1787737700000 } from '../../src/database/migrations/1787737700000-AlertNotifications';
import { DurableUsageAcceptance1787737800000 } from '../../src/database/migrations/1787737800000-DurableUsageAcceptance';
import { UsageReplayScheduling1787737900000 } from '../../src/database/migrations/1787737900000-UsageReplayScheduling';
import { PostgreSqlScalingIndexes1787738000000 } from '../../src/database/migrations/1787738000000-PostgreSqlScalingIndexes';

describe('Nest migration ownership baseline', () => {
  it('records an existing pre-Nest schema without diffing or rewriting it', async () => {
    const log = jest.fn();
    const runner = {
      hasTable: jest.fn().mockResolvedValue(true),
      connection: { driver: { createSchemaBuilder: () => ({ log }) } },
      query: jest.fn(),
      createForeignKey: jest.fn(),
    } as unknown as QueryRunner;
    await new NestBackendBaseline1787737000000().up(runner);
    expect(log).not.toHaveBeenCalled();
    expect(runner.query).not.toHaveBeenCalled();
    expect(runner.createForeignKey).not.toHaveBeenCalled();
  });

  it('adds automatic ingestion fields and a tenant-owned hashed-key table forward-only', async () => {
    const runner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner;
    await new AutomaticUsageIngestion1787737200000().up(runner);
    const sql = String((runner.query as jest.Mock).mock.calls[0][0]);
    expect(sql).toContain('ingestion_api_keys');
    expect(sql).toContain('SecretHash');
    expect(sql).toContain('FK_ingestion_keys_organization');
    expect(sql).toContain('PricingVersion');
    expect(sql).not.toContain('DROP TABLE');
  });

  it('creates entity schema and all tenant-safe foreign keys for an empty database', async () => {
    const runner = {
      hasTable: jest.fn().mockResolvedValue(false),
      connection: {
        driver: {
          createSchemaBuilder: () => ({
            log: jest
              .fn()
              .mockResolvedValue({ upQueries: [{ query: 'CREATE TABLE test', parameters: [] }] }),
          }),
        },
      },
      query: jest.fn().mockResolvedValue(undefined),
      createForeignKey: jest.fn().mockResolvedValue(undefined),
    } as unknown as QueryRunner;
    await new NestBackendBaseline1787737000000().up(runner);
    expect(runner.query).toHaveBeenCalledWith('CREATE TABLE test', []);
    expect(runner.createForeignKey).toHaveBeenCalledTimes(14);
  });

  it('creates append-only revenue history and safely baselines existing customers', async () => {
    const runner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner;
    await new CustomerRevenueHistory1787737400000().up(runner);
    const sql = String((runner.query as jest.Mock).mock.calls[0][0]);
    expect(sql).toContain('customer_revenue_snapshots');
    expect(sql).toContain('FK_revenue_history_customer_tenant');
    expect(sql).toContain('COALESCE(c."RevenueUpdatedAt", c."CreatedAt")');
    expect(sql).toContain('WHERE NOT EXISTS');
    expect(sql).not.toContain('UPDATE "customer_revenue_snapshots"');
    expect(sql).not.toContain('DELETE FROM "customer_revenue_snapshots"');
  });

  it('adds organization defaults and nullable customer guardrail overrides forward-only', async () => {
    const runner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner;
    await new BudgetGuardrails1787737500000().up(runner);
    const sql = String((runner.query as jest.Mock).mock.calls[0][0]);
    expect(sql).toContain('BudgetWarningThreshold');
    expect(sql).toContain('BudgetCriticalThreshold');
    expect(sql).toContain('TargetGrossMarginOverride');
    expect(sql).not.toContain('DROP COLUMN');
  });

  it('creates and baselines immutable organization and customer guardrail history', async () => {
    const runner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner;
    await new HistoricalGuardrails1787737600000().up(runner);
    const sql = String((runner.query as jest.Mock).mock.calls[0][0]);
    expect(sql).toContain('organization_guardrail_versions');
    expect(sql).toContain('customer_guardrail_versions');
    expect(sql).toContain('FK_customer_guardrails_customer_tenant');
    expect(sql).toContain('WHERE NOT EXISTS');
    expect(sql).not.toContain('UPDATE "organization_guardrail_versions"');
    expect(sql).not.toContain('DELETE FROM "customer_guardrail_versions"');
  });

  it('creates tenant-owned notification preferences and durable delivery attempts', async () => {
    const runner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner;
    await new AlertNotifications1787737700000().up(runner);
    const sql = String((runner.query as jest.Mock).mock.calls[0][0]);
    expect(sql).toContain('notification_preferences');
    expect(sql).toContain('notification_deliveries');
    expect(sql).toContain('FK_notification_delivery_alert_tenant');
    expect(sql).toContain('UQ_notification_delivery_transition');
    expect(sql).toContain('WHERE NOT EXISTS');
    expect(sql).not.toContain('DROP TABLE');
  });

  it('adds separate replay state and immutable accepted usage facts', async () => {
    const runner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner;
    await new DurableUsageAcceptance1787737800000().up(runner);
    const sql = String((runner.query as jest.Mock).mock.calls[0][0]);
    expect(sql).toContain('usage_event_processing');
    expect(sql).toContain('IDX_usage_processing_replay');
    expect(sql).toContain('TR_usage_event_immutable');
    expect(sql).toContain('SELECT u."OrganizationId", u."Id", \'processed\'');
    expect(sql).toContain('WHERE NOT EXISTS');
  });

  it('adds bounded replay scheduling and stale-claim recovery fields', async () => {
    const runner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner;
    await new UsageReplayScheduling1787737900000().up(runner);
    const sql = String((runner.query as jest.Mock).mock.calls[0][0]);
    expect(sql).toContain('NextRetryAt');
    expect(sql).toContain('ClaimedAt');
    expect(sql).toContain('Retryable');
    expect(sql).toContain('IDX_usage_processing_due');
  });

  it('adds only query-matched partial indexes for worker due and stale claim paths', async () => {
    const runner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner;
    await new PostgreSqlScalingIndexes1787738000000().up(runner);
    const sql = String((runner.query as jest.Mock).mock.calls[0][0]);
    expect(sql).toContain('IDX_usage_processing_retry_due');
    expect(sql).toContain('IDX_usage_processing_stale_claim');
    expect(sql).toContain('IDX_notification_pending_due');
    expect(sql).toContain('IDX_notification_stale_claim');
    expect(sql).toContain('WHERE "Status"=\'processing\'');
  });

  it('never drops an inherited schema on rollback', async () => {
    await expect(new NestBackendBaseline1787737000000().down()).resolves.toBeUndefined();
  });
});
