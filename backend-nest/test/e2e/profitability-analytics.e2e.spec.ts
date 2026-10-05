import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AiUsageEventEntity } from '../../src/database/entities';
import { AiCostSource, AiProvider } from '../../src/common/enums/domain.enums';
import { AuthSession, TestApp } from '../support/test-app';

describe('profitability analytics (PostgreSQL)', () => {
  const fixture = new TestApp();
  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());

  const date = (value = new Date()) => value.toISOString().slice(0, 10);
  const analytics = (session: AuthSession, sort = 'lowest_gross_margin') =>
    request(fixture.server())
      .get('/api/v1/analytics/profitability')
      .query({ range: 'custom', startDate: date(), endDate: date(), sort })
      .set('Authorization', fixture.auth(session.token));

  async function event(
    session: AuthSession,
    customerId: string,
    cost: string,
    model: string,
    feature: string,
    occurredAt = new Date(),
  ) {
    const now = new Date();
    await fixture.dataSource.manager.save(
      fixture.dataSource.manager.create(AiUsageEventEntity, {
        id: randomUUID(),
        organizationId: session.organizationId,
        customerId,
        provider: AiProvider.OpenAI,
        model,
        feature,
        inputTokens: '10',
        outputTokens: '5',
        cost,
        currency: 'USD',
        costSource: AiCostSource.Explicit,
        pricingVersion: null,
        pricingModel: null,
        metadata: {},
        externalRequestId: randomUUID(),
        occurredAt,
        createdAt: now,
      }),
    );
  }

  it('filters and aggregates precisely without crossing tenants', async () => {
    const owner = await fixture.register('analytics-owner');
    const foreign = await fixture.register('analytics-foreign');
    const alpha = await fixture.customer(owner, `alpha-${Date.now()}`, 100);
    const zero = await fixture.customer(owner, `zero-${Date.now()}`, 0);
    const gamma = await fixture.customer(owner, `gamma-${Date.now()}`, 200);
    const outsider = await fixture.customer(foreign, `foreign-${Date.now()}`, 900);
    await event(owner, alpha.id, '12.345678', 'gpt-5', 'chat');
    await event(owner, alpha.id, '0.000001', 'gpt-5', 'chat');
    await event(owner, zero.id, '20.000000', 'gpt-5-mini', 'summary');
    await event(owner, gamma.id, '5.000000', 'gpt-5', 'summary');
    const old = new Date();
    old.setUTCDate(old.getUTCDate() - 40);
    await event(owner, alpha.id, '50.000000', 'old-model', 'old-feature', old);
    await event(foreign, outsider.id, '999.000000', 'foreign-model', 'foreign-feature');

    const response = await analytics(owner, 'highest_ai_cost').expect(200);
    expect(response.body.totals).toMatchObject({
      revenue: 300,
      aiCost: 37.345679,
      grossProfit: 262.654321,
    });
    expect(response.body.breakdowns.providers).toEqual([
      { name: 'openai', cost: 37.345679, requests: 4 },
    ]);
    expect(response.body.breakdowns.models).toEqual([
      { name: 'gpt-5-mini', cost: 20, requests: 1 },
      { name: 'gpt-5', cost: 17.345679, requests: 3 },
    ]);
    expect(response.body.breakdowns.features).toEqual([
      { name: 'summary', cost: 25, requests: 2 },
      { name: 'chat', cost: 12.345679, requests: 2 },
    ]);
    expect(response.body.customers.map((row: { customerId: string }) => row.customerId)).toEqual([
      zero.id,
      alpha.id,
      gamma.id,
    ]);
  });

  it('sorts profitability rows and retains zero-revenue N/A semantics', async () => {
    const session = await fixture.register('analytics-sorting');
    const lowMargin = await fixture.customer(session, 'Low margin', 100);
    const noRevenue = await fixture.customer(session, 'No revenue', 0);
    const highRevenue = await fixture.customer(session, 'High revenue', 200);
    await event(session, lowMargin.id, '30.000000', 'gpt-5', 'chat');
    await event(session, noRevenue.id, '40.000000', 'gpt-5-mini', 'summary');
    await event(session, highRevenue.id, '5.000000', 'gpt-5', 'chat');

    const names = async (sort: string) =>
      (await analytics(session, sort).expect(200)).body.customers.map(
        (row: { name: string }) => row.name,
      ) as string[];
    await expect(names('highest_ai_cost')).resolves.toEqual([
      'No revenue',
      'Low margin',
      'High revenue',
    ]);
    await expect(names('lowest_gross_margin')).resolves.toEqual([
      'Low margin',
      'High revenue',
      'No revenue',
    ]);
    await expect(names('highest_revenue')).resolves.toEqual([
      'High revenue',
      'Low margin',
      'No revenue',
    ]);
    await expect(names('highest_gross_profit')).resolves.toEqual([
      'High revenue',
      'Low margin',
      'No revenue',
    ]);
    const response = await analytics(session).expect(200);
    const zero = response.body.customers.find((row: { name: string }) => row.name === 'No revenue');
    expect(zero).toMatchObject({ grossMargin: null, status: 'critical' });

    const firstPage = await analytics(session, 'highest_ai_cost')
      .query({ page: 1, pageSize: 2, status: 'all' })
      .expect(200);
    expect(firstPage.body.customers).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(firstPage.body.customers.items.map((row: { name: string }) => row.name)).toEqual([
      'No revenue',
      'Low margin',
    ]);
    expect(firstPage.body.totals).toMatchObject({ revenue: 300, aiCost: 75, grossProfit: 225 });
    expect(firstPage.body.currentHealth).toMatchObject({ critical: 2, warning: 0 });

    const secondPage = await analytics(session, 'highest_ai_cost')
      .query({ page: 2, pageSize: 2, status: 'all' })
      .expect(200);
    expect(secondPage.body.customers.items.map((row: { name: string }) => row.name)).toEqual([
      'High revenue',
    ]);

    const healthy = await analytics(session, 'highest_ai_cost')
      .query({ page: 1, pageSize: 20, status: 'healthy' })
      .expect(200);
    expect(healthy.body.customers).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(healthy.body.customers.items[0].name).toBe('High revenue');
  });
});
