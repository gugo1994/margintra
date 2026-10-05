import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  AiUsageEventEntity,
  CustomerEntity,
  UsageIngestionInboxEntity,
} from '../../src/database/entities';
import {
  AiCostSource,
  AiProvider,
  InboxProcessingStatus,
  StripeCustomerStatus,
} from '../../src/common/enums/domain.enums';
import { AuthSession, TestApp } from '../support/test-app';

describe('organization profitability forecast summary', () => {
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
        model: 'persisted-model',
        feature: 'forecast',
        inputTokens: '1',
        outputTokens: '1',
        cost,
        currency: 'USD',
        costSource: AiCostSource.Calculated,
        pricingVersion: 'immutable-version',
        pricingModel: 'persisted-model',
        pricingId: null,
        metadata: {},
        externalRequestId: randomUUID(),
        occurredAt: new Date(occurredAt),
        createdAt: new Date(),
      }),
    );
  }

  it('projects the UTC current month from persisted cost with seven-day zero filling', async () => {
    const session = await fixture.register('org-forecast-velocity');
    const customer = await fixture.customer(session, `velocity-${Date.now()}`, 1000);
    await usage(session, customer.id, '99', '2026-08-31T23:59:59.999Z');
    await usage(session, customer.id, '1', '2026-09-01T00:00:00.000Z');
    await usage(session, customer.id, '7', '2026-09-04T08:00:00.000Z');
    await usage(session, customer.id, '7', '2026-09-10T09:00:00.000Z');
    await usage(session, customer.id, '88', '2026-10-01T00:00:00.000Z');
    await fixture.dataSource.manager.save(
      fixture.dataSource.manager.create(UsageIngestionInboxEntity, {
        id: randomUUID(),
        organizationId: session.organizationId,
        externalRequestId: randomUUID(),
        customerExternalId: 'pending-pricing',
        provider: AiProvider.OpenAI,
        model: 'unknown',
        feature: 'forecast',
        inputTokens: '999',
        outputTokens: '999',
        occurredAt: new Date('2026-09-10T10:00:00Z'),
        metadata: {},
        explicitCost: null,
        explicitCostCurrency: null,
        processingStatus: InboxProcessingStatus.PendingPricing,
        attemptCount: 1,
        nextAttemptAt: null,
        claimedAt: null,
        lastErrorCode: 'pricing_unavailable',
        lastErrorMessage: 'Pricing unavailable.',
        processedAt: null,
        usageEventId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    const result = await fixture.dashboard.profitabilityForecastSummary(
      session.organizationId,
      asOf,
    );
    expect(result).toMatchObject({
      forecastStatus: 'available',
      scope: 'current_month',
      currentRevenue: 1000,
      currentMonthAiCost: 15,
      recentWindowDays: 7,
      recentDailyAverageCost: 2,
      projectedMonthEndAiCost: 55,
      projectedGrossProfit: 945,
      projectedGrossMargin: 94.5,
      customersEvaluated: 1,
    });
  });

  it('classifies each active customer once and orders highest risk correctly', async () => {
    const session = await fixture.register('org-forecast-risk');
    const exhausted = await fixture.customer(session, `exhausted-${Date.now()}`, 100);
    const projected = await fixture.customer(session, `projected-${Date.now()}`, 100);
    const insufficient = await fixture.customer(session, `insufficient-${Date.now()}`, 100);
    const deleted = await fixture.customer(session, `deleted-${Date.now()}`, 100);
    await usage(session, exhausted.id, '35', '2026-09-04T08:00:00.000Z');
    await usage(session, projected.id, '7', '2026-09-04T08:00:00.000Z');
    await usage(session, projected.id, '7', '2026-09-10T08:00:00.000Z');
    await usage(session, insufficient.id, '1', '2026-09-09T08:00:00.000Z');
    await usage(session, deleted.id, '90', '2026-09-04T08:00:00.000Z');
    await fixture.dataSource.manager.update(
      CustomerEntity,
      { id: deleted.id },
      {
        stripeCustomerStatus: StripeCustomerStatus.Deleted,
      },
    );

    const result = await fixture.dashboard.profitabilityForecastSummary(
      session.organizationId,
      asOf,
    );
    expect(result).toMatchObject({
      customersEvaluated: 3,
      customersAlreadyBudgetExhausted: 1,
      customersProjectedToExhaustBudgetThisMonth: 1,
      customersInsufficientData: 1,
      highestForecastRisk: {
        customerId: exhausted.id,
        projectedMonthEndAiCost: 135,
        allowedAiBudget: 30,
        budgetExhaustionDate: '2026-09-10T00:00:00.000Z',
      },
    });
  });

  it('returns insufficient data without fabricated projections, including zero revenue', async () => {
    const session = await fixture.register('org-forecast-insufficient');
    await fixture.customer(session, `zero-${Date.now()}`, 0);
    const result = await fixture.dashboard.profitabilityForecastSummary(
      session.organizationId,
      asOf,
    );
    expect(result).toMatchObject({
      forecastStatus: 'insufficient_data',
      currentRevenue: 0,
      currentMonthAiCost: 0,
      recentWindowDays: 0,
      projectedMonthEndAiCost: null,
      projectedGrossProfit: null,
      projectedGrossMargin: null,
      customersEvaluated: 1,
      customersInsufficientData: 0,
      customersAlreadyBudgetExhausted: 1,
    });
  });

  it('is tenant scoped and ignores selected-range query parameters', async () => {
    const owner = await fixture.register('org-forecast-owner');
    const outsider = await fixture.register('org-forecast-outsider');
    const customer = await fixture.customer(owner, `owner-${Date.now()}`, 100);
    const outsideCustomer = await fixture.customer(outsider, `outsider-${Date.now()}`, 900);
    await usage(owner, customer.id, '1', new Date().toISOString());
    await usage(outsider, outsideCustomer.id, '999', new Date().toISOString());

    const current = await request(fixture.server())
      .get('/api/v1/analytics/profitability/forecast-summary?range=current_month')
      .set('Authorization', fixture.auth(owner.token))
      .expect(200);
    const historical = await request(fixture.server())
      .get('/api/v1/analytics/profitability/forecast-summary?range=previous_month')
      .set('Authorization', fixture.auth(owner.token))
      .expect(200);
    expect({ ...historical.body, asOf: current.body.asOf }).toEqual(current.body);
    expect(current.body).toMatchObject({ scope: 'current_month', currentRevenue: 100 });
    expect(current.body.currentMonthAiCost).toBe(1);
  });
});
