import request from 'supertest';
import { IsNull, Not } from 'typeorm';
import { MarginAlertEntity } from '../../src/database/entities';
import { AlertSeverity, MarginAlertType } from '../../src/common/enums/domain.enums';
import { TestApp } from '../support/test-app';

describe('AI budget guardrails (PostgreSQL)', () => {
  const fixture = new TestApp();
  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());

  it('warns, escalates without duplication, and preserves resolved history on recovery', async () => {
    const session = await fixture.register('budget-lifecycle');
    const customer = await fixture.customer(session, `budget-${Date.now()}`, 100);
    await request(fixture.server())
      .put('/api/v1/settings/margin')
      .set('Authorization', fixture.auth(session.token))
      .send({ targetGrossMargin: 70, warningThreshold: 50, criticalThreshold: 90 })
      .expect(200);
    await fixture.usage(session, customer.id, 15, `budget-warning-${Date.now()}`).expect(201);
    let detail = await request(fixture.server())
      .get(`/api/v1/customers/${customer.id}/margin`)
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(detail.body).toMatchObject({
      allowedAiBudget: 30,
      remainingAiBudget: 15,
      budgetUsedPercent: 50,
      budgetState: 'warning',
    });
    const warning = await fixture.dataSource.manager.findOneByOrFail(MarginAlertEntity, {
      organizationId: session.organizationId,
      customerId: customer.id,
      type: MarginAlertType.AiBudgetWarning,
      resolvedAt: IsNull(),
    });
    expect(warning.severity).toBe(AlertSeverity.Warning);

    await fixture.usage(session, customer.id, 12, `budget-critical-${Date.now()}`).expect(201);
    await fixture.usage(session, customer.id, 0, `budget-repeat-${Date.now()}`).expect(201);
    const open = await fixture.dataSource.manager.findBy(MarginAlertEntity, {
      organizationId: session.organizationId,
      customerId: customer.id,
      resolvedAt: IsNull(),
    });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ id: warning.id, severity: AlertSeverity.Critical });

    await request(fixture.server())
      .put(`/api/v1/customers/${customer.id}`)
      .set('Authorization', fixture.auth(session.token))
      .send({
        externalCustomerId: `budget-recovered-${Date.now()}`,
        name: 'Recovered',
        monthlyRevenue: 1000,
        currency: 'USD',
      })
      .expect(200);
    detail = await request(fixture.server())
      .get(`/api/v1/customers/${customer.id}/margin`)
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(detail.body.budgetState).toBe('healthy');
    expect(
      await fixture.dataSource.manager.countBy(MarginAlertEntity, {
        organizationId: session.organizationId,
        customerId: customer.id,
        resolvedAt: IsNull(),
      }),
    ).toBe(0);
    expect(
      await fixture.dataSource.manager.countBy(MarginAlertEntity, {
        organizationId: session.organizationId,
        customerId: customer.id,
        resolvedAt: Not(IsNull()),
      }),
    ).toBe(1);
  });

  it('applies tenant-safe customer overrides without changing organization defaults', async () => {
    const owner = await fixture.register('budget-override-owner');
    const outsider = await fixture.register('budget-override-outsider');
    const customer = await fixture.customer(owner, `override-${Date.now()}`, 100);
    await request(fixture.server())
      .put(`/api/v1/customers/${customer.id}/guardrails`)
      .set('Authorization', fixture.auth(outsider.token))
      .send({ targetGrossMargin: 50, warningThreshold: 90, criticalThreshold: 100 })
      .expect(404);
    await request(fixture.server())
      .put(`/api/v1/customers/${customer.id}/guardrails`)
      .set('Authorization', fixture.auth(owner.token))
      .send({ targetGrossMargin: 50, warningThreshold: 90, criticalThreshold: 100 })
      .expect(200);
    await fixture.usage(owner, customer.id, 30, `override-${Date.now()}`).expect(201);
    const detail = await request(fixture.server())
      .get(`/api/v1/customers/${customer.id}/margin`)
      .set('Authorization', fixture.auth(owner.token))
      .expect(200);
    expect(detail.body).toMatchObject({
      targetGrossMargin: 50,
      warningThreshold: 90,
      criticalThreshold: 100,
      allowedAiBudget: 50,
      remainingAiBudget: 20,
      budgetUsedPercent: 60,
      budgetState: 'healthy',
    });
    const analytics = await request(fixture.server())
      .get('/api/v1/analytics/profitability')
      .query({ range: 'current_month' })
      .set('Authorization', fixture.auth(owner.token))
      .expect(200);
    expect(
      analytics.body.customers.find(
        (row: { customerId: string }) => row.customerId === customer.id,
      ),
    ).toMatchObject({
      allowedAiBudget: 50,
      remainingAiBudget: 20,
      budgetUsedPercent: 60,
      budgetState: 'healthy',
    });
    const settings = await request(fixture.server())
      .get('/api/v1/settings/margin')
      .set('Authorization', fixture.auth(owner.token))
      .expect(200);
    expect(settings.body).toMatchObject({
      targetGrossMargin: 70,
      warningThreshold: 80,
      criticalThreshold: 100,
    });
  });
});
