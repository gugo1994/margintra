import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  AiUsageEventEntity,
  CustomerGuardrailVersionEntity,
  CustomerRevenueSnapshotEntity,
  OrganizationGuardrailVersionEntity,
} from '../../src/database/entities';
import { AiCostSource, AiProvider } from '../../src/common/enums/domain.enums';
import { AuthSession, TestApp } from '../support/test-app';

describe('historical guardrail versioning (PostgreSQL)', () => {
  const fixture = new TestApp();
  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());

  it('uses period-end organization versions and customer override precedence without duplicates', async () => {
    const session = await fixture.register('historical-guardrails');
    const outsider = await fixture.register('historical-guardrails-outsider');
    const customer = await fixture.customer(session, `guardrail-history-${Date.now()}`, 100);
    await fixture.customer(outsider, `guardrail-history-foreign-${Date.now()}`, 999);
    const now = new Date();
    const previousStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const twoMonthsStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
    const previousUsage = new Date(previousStart);
    previousUsage.setUTCDate(10);

    const orgBaseline = await fixture.dataSource.manager.findOneByOrFail(
      OrganizationGuardrailVersionEntity,
      { organizationId: session.organizationId },
    );
    orgBaseline.effectiveFrom = twoMonthsStart;
    await fixture.dataSource.manager.save(orgBaseline);
    const customerBaseline = await fixture.dataSource.manager.findOneByOrFail(
      CustomerGuardrailVersionEntity,
      { organizationId: session.organizationId, customerId: customer.id },
    );
    customerBaseline.effectiveFrom = twoMonthsStart;
    await fixture.dataSource.manager.save(customerBaseline);
    const revenueBaseline = await fixture.dataSource.manager.findOneByOrFail(
      CustomerRevenueSnapshotEntity,
      { organizationId: session.organizationId, customerId: customer.id },
    );
    revenueBaseline.effectiveFrom = twoMonthsStart;
    await fixture.dataSource.manager.save(revenueBaseline);
    await usage(fixture, session, customer.id, '25.000000', previousUsage);

    const settingsBody = { targetGrossMargin: 50, warningThreshold: 40, criticalThreshold: 90 };
    await request(fixture.server())
      .put('/api/v1/settings/margin')
      .set('Authorization', fixture.auth(session.token))
      .send(settingsBody)
      .expect(200);
    await request(fixture.server())
      .put('/api/v1/settings/margin')
      .set('Authorization', fixture.auth(session.token))
      .send(settingsBody)
      .expect(200);
    expect(
      await fixture.dataSource.manager.countBy(OrganizationGuardrailVersionEntity, {
        organizationId: session.organizationId,
      }),
    ).toBe(2);

    const override = { targetGrossMargin: 80, warningThreshold: 50, criticalThreshold: 100 };
    await request(fixture.server())
      .put(`/api/v1/customers/${customer.id}/guardrails`)
      .set('Authorization', fixture.auth(session.token))
      .send(override)
      .expect(200);
    await request(fixture.server())
      .put(`/api/v1/customers/${customer.id}/guardrails`)
      .set('Authorization', fixture.auth(session.token))
      .send(override)
      .expect(200);
    expect(
      await fixture.dataSource.manager.countBy(CustomerGuardrailVersionEntity, {
        organizationId: session.organizationId,
        customerId: customer.id,
      }),
    ).toBe(2);
    await usage(fixture, session, customer.id, '15.000000', new Date());

    const previous = await request(fixture.server())
      .get('/api/v1/analytics/profitability')
      .query({ range: 'previous_month' })
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    const previousRow = previous.body.customers.find(
      (row: { customerId: string }) => row.customerId === customer.id,
    );
    expect(previousRow).toMatchObject({
      revenue: 100,
      aiCost: 25,
      allowedAiBudget: 30,
      budgetState: 'warning',
    });

    const current = await request(fixture.server())
      .get('/api/v1/analytics/profitability')
      .query({ range: 'current_month' })
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    const currentRow = current.body.customers.find(
      (row: { customerId: string }) => row.customerId === customer.id,
    );
    expect(currentRow).toMatchObject({
      revenue: 100,
      aiCost: 15,
      allowedAiBudget: 20,
      budgetUsedPercent: 75,
      budgetState: 'warning',
    });
    expect(current.body.customers).toHaveLength(1);
  });
});

async function usage(
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
      feature: 'guardrail-history',
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
