import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AiUsageEventEntity, UsageIngestionInboxEntity } from '../../src/database/entities';
import {
  AiCostSource,
  AiProvider,
  InboxProcessingStatus,
} from '../../src/common/enums/domain.enums';
import { AuthSession, TestApp } from '../support/test-app';

describe('customer cost drivers', () => {
  const fixture = new TestApp();
  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());

  const getDrivers = (session: AuthSession, customerId: string) =>
    request(fixture.server())
      .get(`/api/v1/analytics/profitability/customers/${customerId}/cost-drivers`)
      .query({ range: 'custom', startDate: '2026-08-01', endDate: '2026-08-31' })
      .set('Authorization', fixture.auth(session.token));

  async function usage(
    session: AuthSession,
    customerId: string,
    cost: string,
    model: string,
    feature: string,
    occurredAt: string,
  ) {
    await fixture.dataSource.manager.save(
      fixture.dataSource.manager.create(AiUsageEventEntity, {
        id: randomUUID(),
        organizationId: session.organizationId,
        customerId,
        provider: AiProvider.OpenAI,
        model,
        feature,
        inputTokens: '1',
        outputTokens: '1',
        cost,
        currency: 'USD',
        costSource: AiCostSource.Calculated,
        pricingVersion: 'persisted-price',
        pricingModel: model,
        pricingId: null,
        metadata: {},
        externalRequestId: randomUUID(),
        occurredAt: new Date(occurredAt),
        createdAt: new Date(),
      }),
    );
  }

  it('aggregates current and previous persisted costs with ordering, shares, and directions', async () => {
    const session = await fixture.register('customer-cost-drivers');
    const externalId = `drivers-${Date.now()}`;
    const customer = await fixture.customer(session, externalId, 100);
    await usage(session, customer.id, '10', 'gpt-5', 'chat', '2026-08-01T00:00:00.000Z');
    await usage(session, customer.id, '2', 'gpt-5', 'chat', '2026-08-31T23:59:59.999Z');
    await usage(session, customer.id, '6', 'new-model', 'new-feature', '2026-08-10T00:00:00.000Z');
    await usage(session, customer.id, '5', 'gpt-mini', 'summary', '2026-08-11T00:00:00.000Z');
    await usage(
      session,
      customer.id,
      '3',
      'flat-model',
      'flat-feature',
      '2026-08-12T00:00:00.000Z',
    );
    await usage(
      session,
      customer.id,
      '2',
      'down-model',
      'down-feature',
      '2026-08-13T00:00:00.000Z',
    );
    await usage(session, customer.id, '4', 'gpt-5', 'chat', '2026-07-01T00:00:00.000Z');
    await usage(
      session,
      customer.id,
      '3',
      'flat-model',
      'flat-feature',
      '2026-07-15T00:00:00.000Z',
    );
    await usage(
      session,
      customer.id,
      '10',
      'down-model',
      'down-feature',
      '2026-07-31T23:59:59.999Z',
    );
    await usage(
      session,
      customer.id,
      '999',
      'outside-model',
      'outside',
      '2026-09-01T00:00:00.000Z',
    );
    await fixture.dataSource.manager.save(
      fixture.dataSource.manager.create(UsageIngestionInboxEntity, {
        id: randomUUID(),
        organizationId: session.organizationId,
        externalRequestId: randomUUID(),
        customerExternalId: externalId,
        provider: AiProvider.OpenAI,
        model: 'pending-model',
        feature: 'pending-feature',
        inputTokens: '1',
        outputTokens: '1',
        occurredAt: new Date('2026-08-15T00:00:00.000Z'),
        metadata: {},
        explicitCost: '500',
        explicitCostCurrency: 'USD',
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

    const response = await getDrivers(session, customer.id).expect(200);
    expect(response.body.totalAiCost).toBe(28);
    expect(response.body.features.map((item: { name: string }) => item.name)).toEqual([
      'chat',
      'new-feature',
      'summary',
      'flat-feature',
      'down-feature',
    ]);
    expect(response.body.models.map((item: { name: string }) => item.name)).toEqual([
      'gpt-5',
      'new-model',
      'gpt-mini',
      'flat-model',
      'down-model',
    ]);
    expect(response.body.features[0]).toMatchObject({
      name: 'chat',
      aiCost: 12,
      shareOfCustomerAiCost: 42.857142857142854,
      previousPeriodAiCost: 4,
      absoluteChange: 8,
      percentChange: 200,
      direction: 'up',
      usageEventCount: 2,
    });
    expect(
      response.body.features.find((item: { name: string }) => item.name === 'new-feature'),
    ).toMatchObject({ previousPeriodAiCost: 0, percentChange: null, direction: 'up' });
    expect(
      response.body.features.find((item: { name: string }) => item.name === 'flat-feature'),
    ).toMatchObject({ absoluteChange: 0, percentChange: 0, direction: 'flat' });
    expect(
      response.body.features.find((item: { name: string }) => item.name === 'down-feature'),
    ).toMatchObject({ absoluteChange: -8, percentChange: -80, direction: 'down' });
  });

  it('returns empty drivers for zero cost and enforces tenant isolation', async () => {
    const owner = await fixture.register('customer-cost-drivers-zero');
    const outsider = await fixture.register('customer-cost-drivers-outsider');
    const customer = await fixture.customer(owner, `drivers-zero-${Date.now()}`, 0);
    const response = await getDrivers(owner, customer.id).expect(200);
    expect(response.body).toMatchObject({ totalAiCost: 0, features: [], models: [] });
    await getDrivers(outsider, customer.id).expect(404);
  });
});
