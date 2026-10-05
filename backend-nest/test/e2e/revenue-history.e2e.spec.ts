import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  AiUsageEventEntity,
  CustomerEntity,
  CustomerRevenueSnapshotEntity,
} from '../../src/database/entities';
import { AiCostSource, AiProvider } from '../../src/common/enums/domain.enums';
import { AuthSession, TestApp } from '../support/test-app';
import { RevenueHistoryService } from '../../src/modules/revenue-history/revenue-history.service';
import { DashboardRepository } from '../../src/modules/dashboard/repositories/dashboard.repository';
import { AnalyticsSort } from '../../src/modules/dashboard/dto/analytics-query.dto';

describe('historical customer revenue (PostgreSQL)', () => {
  const fixture = new TestApp();
  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());
  beforeEach(() => {
    fixture.stripe.state = {
      account: { accountId: 'acct_nest_test', liveMode: false },
      customers: [],
      subscriptions: [],
    };
  });

  it('appends only changed Stripe MRR and records webhook deletion as zero', async () => {
    const session = await fixture.register('revenue-history-stripe');
    const secret = 'whsec_revenue_history';
    const connection = await fixture.connect(session, secret).expect(201);
    fixture.stripe.state = {
      account: { accountId: 'acct_nest_test', liveMode: false },
      customers: [{ id: 'cus_revenue_history', name: 'History', email: null, deleted: false }],
      subscriptions: [fixture.subscription('sub_revenue_history', 'cus_revenue_history', '99')],
    };
    await fixture.sync(session).expect(201);
    await fixture.sync(session).expect(201);
    const customer = await fixture.dataSource.manager.findOneByOrFail(CustomerEntity, {
      organizationId: session.organizationId,
      stripeCustomerId: 'cus_revenue_history',
    });
    expect(
      await fixture.dataSource.manager.countBy(CustomerRevenueSnapshotEntity, {
        organizationId: session.organizationId,
        customerId: customer.id,
      }),
    ).toBe(1);

    fixture.stripe.state.subscriptions = [
      fixture.subscription('sub_revenue_history', 'cus_revenue_history', '149'),
    ];
    await fixture.sync(session).expect(201);
    fixture.stripe.state = { ...fixture.stripe.state, customers: [], subscriptions: [] };
    const payload = JSON.stringify({
      id: `evt-revenue-delete-${Date.now()}`,
      object: 'event',
      type: 'customer.deleted',
      data: { object: {} },
    });
    await request(fixture.server())
      .post(connection.body.webhookPath as string)
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', fixture.signature(payload, secret))
      .send(payload)
      .expect(201);
    const history = await fixture.dataSource.manager.find(CustomerRevenueSnapshotEntity, {
      where: { organizationId: session.organizationId, customerId: customer.id },
      order: { effectiveFrom: 'ASC' },
    });
    expect(history.map((row) => Number(row.revenue))).toEqual([99, 149, 0]);
    expect(new Set(history.map((row) => row.currency))).toEqual(new Set(['USD']));
  });

  it('uses period-end MRR for previous-month and custom analytics without tenant leakage', async () => {
    const session = await fixture.register('revenue-history-analytics');
    const foreign = await fixture.register('revenue-history-foreign');
    const customer = await fixture.customer(session, `history-${Date.now()}`, 200);
    const outsider = await fixture.customer(foreign, `foreign-history-${Date.now()}`, 999);
    const now = new Date();
    const previousStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const twoMonthsStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
    const previousDay5 = new Date(previousStart);
    previousDay5.setUTCDate(5);
    const previousDay15 = new Date(previousStart);
    previousDay15.setUTCDate(15);
    const previousDay20 = new Date(previousStart);
    previousDay20.setUTCDate(20);
    await fixture.dataSource.manager.save([
      fixture.dataSource.manager.create(CustomerRevenueSnapshotEntity, {
        id: randomUUID(),
        organizationId: session.organizationId,
        customerId: customer.id,
        revenue: '100.000000',
        currency: 'USD',
        effectiveFrom: twoMonthsStart,
        sequence: 2,
        createdAt: new Date(),
      }),
      fixture.dataSource.manager.create(CustomerRevenueSnapshotEntity, {
        id: randomUUID(),
        organizationId: session.organizationId,
        customerId: customer.id,
        revenue: '150.000000',
        currency: 'USD',
        effectiveFrom: previousDay15,
        sequence: 3,
        createdAt: new Date(),
      }),
    ]);
    await thisEvent(fixture, session, customer.id, '10.000000', previousDay5);
    await thisEvent(fixture, session, customer.id, '20.000000', previousDay20);
    await thisEvent(fixture, foreign, outsider.id, '900.000000', previousDay5);

    const previous = await request(fixture.server())
      .get('/api/v1/analytics/profitability')
      .query({ range: 'previous_month' })
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(previous.body.period.revenueSemantics).toBe('period_end_mrr');
    expect(previous.body.totals).toMatchObject({ revenue: 150, aiCost: 30, grossProfit: 120 });

    const customEnd = new Date(previousStart);
    customEnd.setUTCDate(10);
    const custom = await request(fixture.server())
      .get('/api/v1/analytics/profitability')
      .query({
        range: 'custom',
        startDate: previousStart.toISOString().slice(0, 10),
        endDate: customEnd.toISOString().slice(0, 10),
      })
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(custom.body.totals).toMatchObject({ revenue: 100, aiCost: 10, grossProfit: 90 });
  });

  it('stores changed snapshots at the same effective time with increasing sequence', async () => {
    const seeded = await sameTimeHistory('revenue-same-time-store');

    expect(seeded.history).toHaveLength(2);
    expect(seeded.history.map((row) => Number(row.revenue))).toEqual([100, 150]);
    expect(seeded.history.map((row) => row.sequence)).toEqual([1, 2]);
    expect(seeded.history.every((row) => row.effectiveFrom.getTime() === seeded.at.getTime())).toBe(
      true,
    );
  });

  it('uses sequence to choose the latest snapshot at an identical effective time', async () => {
    const { session, customer, at } = await sameTimeHistory('revenue-same-time-latest');
    const rows = await fixture.app
      .get(DashboardRepository)
      .analyticsCustomers(
        session.organizationId,
        new Date(at.getTime() - 1_000),
        new Date(at.getTime() + 1),
        AnalyticsSort.HighestRevenue,
        customer.id,
      );

    expect(Number(rows[0]?.revenue)).toBe(150);
  });

  it('does not append an unchanged value at the same effective time', async () => {
    const { session, customer, at } = await sameTimeHistory('revenue-same-time-dedupe');
    await fixture.dataSource.transaction((manager) =>
      fixture.app
        .get(RevenueHistoryService)
        .recordIfChanged(session.organizationId, customer.id, '150', 'USD', at, manager),
    );

    expect(
      await fixture.dataSource.manager.countBy(CustomerRevenueSnapshotEntity, {
        organizationId: session.organizationId,
        customerId: customer.id,
      }),
    ).toBe(2);
  });

  it('continues to exclude snapshots exactly at the period-end boundary', async () => {
    const { session, customer, at } = await sameTimeHistory('revenue-same-time-boundary');
    const rows = await fixture.app
      .get(DashboardRepository)
      .analyticsCustomers(
        session.organizationId,
        new Date(at.getTime() - 1_000),
        at,
        AnalyticsSort.HighestRevenue,
        customer.id,
      );

    expect(Number(rows[0]?.revenue)).toBe(0);
  });

  async function sameTimeHistory(prefix: string) {
    const session = await fixture.register(prefix);
    const customer = await fixture.customer(session, `${prefix}-${Date.now()}`, 25);
    await fixture.dataSource.manager.delete(CustomerRevenueSnapshotEntity, {
      organizationId: session.organizationId,
      customerId: customer.id,
    });
    const at = new Date('2026-01-15T12:00:00.000Z');
    const history = fixture.app.get(RevenueHistoryService);
    await fixture.dataSource.transaction((manager) =>
      history.recordIfChanged(session.organizationId, customer.id, '100', 'USD', at, manager),
    );
    await fixture.dataSource.transaction((manager) =>
      history.recordIfChanged(session.organizationId, customer.id, '150', 'USD', at, manager),
    );
    return {
      session,
      customer,
      at,
      history: await fixture.dataSource.manager.find(CustomerRevenueSnapshotEntity, {
        where: { organizationId: session.organizationId, customerId: customer.id },
        order: { sequence: 'ASC' },
      }),
    };
  }
});

async function thisEvent(
  fixture: TestApp,
  session: AuthSession,
  customerId: string,
  cost: string,
  occurredAt: Date,
) {
  await fixture.dataSource.manager.save(
    fixture.dataSource.manager.create(AiUsageEventEntity, {
      id: randomUUID(),
      organizationId: session.organizationId,
      customerId,
      provider: AiProvider.OpenAI,
      model: 'gpt-5',
      feature: 'history',
      inputTokens: '1',
      outputTokens: '1',
      cost,
      currency: 'USD',
      costSource: AiCostSource.Explicit,
      pricingVersion: null,
      pricingModel: null,
      metadata: {},
      externalRequestId: randomUUID(),
      occurredAt,
      createdAt: new Date(),
    }),
  );
}
