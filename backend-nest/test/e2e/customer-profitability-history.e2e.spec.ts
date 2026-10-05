import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  AiUsageEventEntity,
  CustomerEntity,
  CustomerRevenueSnapshotEntity,
  OrganizationGuardrailVersionEntity,
  UsageIngestionInboxEntity,
} from '../../src/database/entities';
import {
  AiCostSource,
  AiProvider,
  InboxProcessingStatus,
  StripeCustomerStatus,
} from '../../src/common/enums/domain.enums';
import { AuthSession, TestApp } from '../support/test-app';

describe('customer profitability history', () => {
  const fixture = new TestApp();
  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());

  const monthStart = (offset: number) => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  };

  const getHistory = (session: AuthSession, customerId: string, months?: number) => {
    const call = request(fixture.server())
      .get(`/api/v1/analytics/profitability/customers/${customerId}/history`)
      .set('Authorization', fixture.auth(session.token));
    return months === undefined ? call : call.query({ months });
  };

  const getCustomHistory = (session: AuthSession, customerId: string, start: Date, end: Date) =>
    request(fixture.server())
      .get(`/api/v1/analytics/profitability/customers/${customerId}/history`)
      .query({ start: start.toISOString(), end: end.toISOString() })
      .set('Authorization', fixture.auth(session.token));

  async function usage(session: AuthSession, customerId: string, cost: string, occurredAt: Date) {
    await fixture.dataSource.manager.save(
      fixture.dataSource.manager.create(AiUsageEventEntity, {
        id: randomUUID(),
        organizationId: session.organizationId,
        customerId,
        provider: AiProvider.OpenAI,
        model: 'history-model',
        feature: 'history-feature',
        inputTokens: '1',
        outputTokens: '1',
        cost,
        currency: 'USD',
        costSource: AiCostSource.Calculated,
        pricingVersion: 'persisted-old-version',
        pricingModel: 'history-model',
        pricingId: null,
        metadata: {},
        externalRequestId: randomUUID(),
        occurredAt,
        createdAt: new Date(),
      }),
    );
  }

  it('returns 12 ordered UTC buckets using period-end snapshots and persisted monthly costs', async () => {
    const session = await fixture.register('customer-history');
    const customer = await fixture.customer(session, `history-${Date.now()}`, 100);
    const baseline = await fixture.dataSource.manager.findOneByOrFail(
      CustomerRevenueSnapshotEntity,
      { organizationId: session.organizationId, customerId: customer.id },
    );
    baseline.effectiveFrom = monthStart(-13);
    await fixture.dataSource.manager.save(baseline);
    const guardrail = await fixture.dataSource.manager.findOneByOrFail(
      OrganizationGuardrailVersionEntity,
      { organizationId: session.organizationId },
    );
    guardrail.effectiveFrom = monthStart(-13);
    await fixture.dataSource.manager.save(guardrail);
    await fixture.dataSource.manager.save(
      fixture.dataSource.manager.create(CustomerRevenueSnapshotEntity, {
        id: randomUUID(),
        organizationId: session.organizationId,
        customerId: customer.id,
        revenue: '200.000000',
        currency: 'USD',
        effectiveFrom: monthStart(-1),
        sequence: 2,
        createdAt: new Date(),
      }),
    );

    const previousMonthInside = new Date(monthStart(-1).getTime() + 86_400_000);
    await usage(session, customer.id, '10.123456', previousMonthInside);
    await usage(session, customer.id, '3.000000', monthStart(0));
    await usage(session, customer.id, '99.000000', new Date(monthStart(-12).getTime() - 1));
    await fixture.dataSource.manager.save(
      fixture.dataSource.manager.create(UsageIngestionInboxEntity, {
        id: randomUUID(),
        organizationId: session.organizationId,
        externalRequestId: randomUUID(),
        customerExternalId: `history-${Date.now()}`,
        provider: AiProvider.OpenAI,
        model: 'unknown-history-model',
        feature: 'ignored',
        inputTokens: '1',
        outputTokens: '1',
        occurredAt: previousMonthInside,
        metadata: {},
        explicitCost: null,
        explicitCostCurrency: null,
        processingStatus: InboxProcessingStatus.PendingPricing,
        attemptCount: 1,
        nextAttemptAt: null,
        claimedAt: null,
        lastErrorCode: 'pricing_unavailable',
        lastErrorMessage: 'No verified pricing was effective.',
        processedAt: null,
        usageEventId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    const response = await getHistory(session, customer.id).expect(200);
    expect(response.body).toHaveLength(12);
    const starts = response.body.map((row: { periodStart: string }) => row.periodStart);
    expect(starts).toEqual([...starts].sort());
    expect(starts[0]).toBe(monthStart(-11).toISOString());
    const previous = response.body[10];
    const current = response.body[11];
    expect(previous).toMatchObject({
      periodStart: monthStart(-1).toISOString(),
      periodEnd: monthStart(0).toISOString(),
      revenue: 200,
      aiCost: 10.123456,
      grossProfit: 189.876544,
      usageEventCount: 1,
    });
    expect(current).toMatchObject({
      periodStart: monthStart(0).toISOString(),
      periodEnd: monthStart(1).toISOString(),
      revenue: 200,
      aiCost: 3,
      grossProfit: 197,
      usageEventCount: 1,
    });
  });

  it('preserves zero-revenue and deleted history semantics while enforcing tenant isolation', async () => {
    const owner = await fixture.register('zero-history');
    const outsider = await fixture.register('zero-history-outsider');
    const customer = await fixture.customer(owner, `zero-history-${Date.now()}`, 0);
    await usage(owner, customer.id, '5.000000', new Date(monthStart(0).getTime() + 1));
    await fixture.dataSource.manager.update(
      CustomerEntity,
      {
        id: customer.id,
        organizationId: owner.organizationId,
      },
      { stripeCustomerStatus: StripeCustomerStatus.Deleted },
    );

    const response = await getHistory(owner, customer.id, 2).expect(200);
    expect(response.body[0]).toMatchObject({
      revenue: 0,
      aiCost: 0,
      grossProfit: 0,
      grossMargin: null,
      status: 'noRevenue',
      usageEventCount: 0,
    });
    expect(response.body[1]).toMatchObject({
      revenue: 0,
      aiCost: 5,
      grossProfit: -5,
      grossMargin: null,
      status: 'critical',
      usageEventCount: 1,
    });
    await getHistory(outsider, customer.id, 2).expect(404);
  });

  it('supports bounded half-open UTC custom month ranges', async () => {
    const session = await fixture.register('custom-customer-history');
    const customer = await fixture.customer(session, `custom-history-${Date.now()}`, 100);
    const baseline = await fixture.dataSource.manager.findOneByOrFail(
      CustomerRevenueSnapshotEntity,
      { organizationId: session.organizationId, customerId: customer.id },
    );
    baseline.effectiveFrom = monthStart(-3);
    await fixture.dataSource.manager.save(baseline);
    const guardrail = await fixture.dataSource.manager.findOneByOrFail(
      OrganizationGuardrailVersionEntity,
      { organizationId: session.organizationId },
    );
    guardrail.effectiveFrom = monthStart(-3);
    await fixture.dataSource.manager.save(guardrail);
    await usage(session, customer.id, '0.300000', new Date(monthStart(-1).getTime() + 1));

    const response = await getCustomHistory(
      session,
      customer.id,
      monthStart(-1),
      monthStart(0),
    ).expect(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      periodStart: monthStart(-1).toISOString(),
      periodEnd: monthStart(0).toISOString(),
      revenue: 100,
      aiCost: 0.3,
      usageEventCount: 1,
    });

    await getCustomHistory(session, customer.id, monthStart(0), monthStart(-1)).expect(400);
    await getCustomHistory(session, customer.id, monthStart(-25), monthStart(0)).expect(400);
  });
});
