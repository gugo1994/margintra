import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AiUsageEventEntity, UsageIngestionInboxEntity } from '../../src/database/entities';
import {
  AiCostSource,
  AiProvider,
  InboxProcessingStatus,
} from '../../src/common/enums/domain.enums';
import { AuthSession, TestApp } from '../support/test-app';

describe('customer profitability forecast', () => {
  const fixture = new TestApp();
  const asOf = new Date('2026-09-10T12:00:00.000Z');
  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());

  async function usage(session: AuthSession, customerId: string, cost: string, occurredAt: string) {
    await fixture.dataSource.manager.save(
      fixture.dataSource.manager.create(AiUsageEventEntity, {
        id: randomUUID(),
        organizationId: session.organizationId,
        customerId,
        provider: AiProvider.OpenAI,
        model: 'forecast-model',
        feature: 'forecast',
        inputTokens: '1',
        outputTokens: '1',
        cost,
        currency: 'USD',
        costSource: AiCostSource.Calculated,
        pricingVersion: 'persisted-price-version',
        pricingModel: 'forecast-model',
        pricingId: null,
        metadata: {},
        externalRequestId: randomUUID(),
        occurredAt: new Date(occurredAt),
        createdAt: new Date(),
      }),
    );
  }

  it('uses persisted costs, a seven-day zero-filled average, UTC boundaries, and projects month end', async () => {
    const session = await fixture.register('forecast-velocity');
    const customer = await fixture.customer(session, `forecast-velocity-${Date.now()}`, 1000);
    await usage(session, customer.id, '99.000000', '2026-08-31T23:59:59.999Z');
    await usage(session, customer.id, '1.000000', '2026-09-01T00:00:00.000Z');
    await usage(session, customer.id, '7.000000', '2026-09-04T08:00:00.000Z');
    await usage(session, customer.id, '7.000000', '2026-09-10T09:00:00.000Z');
    await fixture.dataSource.manager.save(
      fixture.dataSource.manager.create(UsageIngestionInboxEntity, {
        id: randomUUID(),
        organizationId: session.organizationId,
        externalRequestId: randomUUID(),
        customerExternalId: 'ignored-pending-pricing',
        provider: AiProvider.OpenAI,
        model: 'unpriced-model',
        feature: 'forecast',
        inputTokens: '999999',
        outputTokens: '999999',
        occurredAt: new Date('2026-09-10T10:00:00Z'),
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

    const result = await fixture.dashboard.customerProfitabilityForecast(
      session.organizationId,
      customer.id,
      asOf,
    );
    expect(result).toMatchObject({
      forecastStatus: 'available',
      revenue: 1000,
      currentMonthAiCost: 15,
      recentWindowDays: 7,
      recentDailyAverageCost: 2,
      projectedMonthEndAiCost: 55,
      allowedAiBudget: 300,
      remainingBudget: 285,
      projectedRemainingBudget: 245,
      projectedGrossProfit: 945,
      projectedGrossMargin: 94.5,
      budgetExhausted: false,
      budgetExhaustionDate: null,
    });
  });

  it('returns insufficient data rather than fabricating a projection', async () => {
    const session = await fixture.register('forecast-insufficient');
    const customer = await fixture.customer(session, `forecast-insufficient-${Date.now()}`, 100);
    await usage(session, customer.id, '5.000000', '2026-09-09T12:00:00.000Z');
    const result = await fixture.dashboard.customerProfitabilityForecast(
      session.organizationId,
      customer.id,
      asOf,
    );
    expect(result).toMatchObject({
      forecastStatus: 'insufficient_data',
      currentMonthAiCost: 5,
      recentWindowDays: 2,
      recentDailyAverageCost: 2.5,
      projectedMonthEndAiCost: null,
      projectedRemainingBudget: null,
      projectedGrossProfit: null,
      projectedGrossMargin: null,
      budgetExhaustionDate: null,
    });
  });

  it('reports already exhausted, projected in-month exhaustion, and zero-revenue semantics', async () => {
    const session = await fixture.register('forecast-budget');
    const exhausted = await fixture.customer(session, `forecast-exhausted-${Date.now()}`, 100);
    const projected = await fixture.customer(session, `forecast-projected-${Date.now()}`, 100);
    const zero = await fixture.customer(session, `forecast-zero-${Date.now()}`, 0);
    await usage(session, exhausted.id, '35.000000', '2026-09-04T08:00:00.000Z');
    await usage(session, projected.id, '7.000000', '2026-09-04T08:00:00.000Z');
    await usage(session, projected.id, '7.000000', '2026-09-10T08:00:00.000Z');
    await usage(session, zero.id, '7.000000', '2026-09-04T08:00:00.000Z');

    const exhaustedResult = await fixture.dashboard.customerProfitabilityForecast(
      session.organizationId,
      exhausted.id,
      asOf,
    );
    expect(exhaustedResult).toMatchObject({
      budgetExhausted: true,
      budgetExhaustionDate: '2026-09-10T00:00:00.000Z',
    });
    const projectedResult = await fixture.dashboard.customerProfitabilityForecast(
      session.organizationId,
      projected.id,
      asOf,
    );
    expect(projectedResult).toMatchObject({
      budgetExhausted: false,
      budgetExhaustionDate: '2026-09-18T00:00:00.000Z',
    });
    const zeroResult = await fixture.dashboard.customerProfitabilityForecast(
      session.organizationId,
      zero.id,
      asOf,
    );
    expect(zeroResult).toMatchObject({
      revenue: 0,
      allowedAiBudget: 0,
      projectedGrossMargin: null,
      budgetExhausted: true,
    });
  });

  it('does not expose another tenant customer through the forecast endpoint', async () => {
    const owner = await fixture.register('forecast-owner');
    const outsider = await fixture.register('forecast-outsider');
    const customer = await fixture.customer(owner, `forecast-private-${Date.now()}`, 100);
    await request(fixture.server())
      .get(`/api/v1/analytics/profitability/customers/${customer.id}/forecast`)
      .set('Authorization', fixture.auth(outsider.token))
      .expect(404);
  });
});
