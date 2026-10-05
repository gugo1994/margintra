import request from 'supertest';
import { IsNull } from 'typeorm';
import { MarginAlertEntity, NotificationDeliveryEntity } from '../../src/database/entities';
import { TestApp } from '../support/test-app';

describe('alert notification delivery (PostgreSQL)', () => {
  const fixture = new TestApp();
  beforeAll(() => fixture.start(), 30_000);
  beforeEach(() => {
    fixture.email.reset();
  });
  afterAll(() => fixture.close());

  const preferences = {
    emailEnabled: true,
    warningAlertsEnabled: true,
    criticalAlertsEnabled: true,
    recoveryAlertsEnabled: true,
    recipients: ['Notify@Example.com', 'notify@example.com'],
  };

  it('validates and persists tenant-scoped organization preferences', async () => {
    const owner = await fixture.register('notification-preferences');
    const outsider = await fixture.register('notification-preferences-outsider');
    const defaults = await request(fixture.server())
      .get('/api/v1/settings/notifications')
      .set('Authorization', fixture.auth(owner.token))
      .expect(200);
    expect(defaults.body).toMatchObject({ emailEnabled: false, recipients: [] });
    await request(fixture.server())
      .put('/api/v1/settings/notifications')
      .set('Authorization', fixture.auth(owner.token))
      .send({ ...preferences, recipients: ['not-an-email'] })
      .expect(400);
    const updated = await request(fixture.server())
      .put('/api/v1/settings/notifications')
      .set('Authorization', fixture.auth(owner.token))
      .send(preferences)
      .expect(200);
    expect(updated.body.recipients).toEqual(['notify@example.com']);
    const foreign = await request(fixture.server())
      .get('/api/v1/settings/notifications')
      .set('Authorization', fixture.auth(outsider.token))
      .expect(200);
    expect(foreign.body).toMatchObject({ emailEnabled: false, recipients: [] });
  });

  it('delivers warning, critical, and recovery transitions once and isolates history', async () => {
    const owner = await fixture.register('notification-lifecycle');
    const outsider = await fixture.register('notification-lifecycle-outsider');
    await request(fixture.server())
      .put('/api/v1/settings/notifications')
      .set('Authorization', fixture.auth(owner.token))
      .send(preferences)
      .expect(200);
    await request(fixture.server())
      .put('/api/v1/settings/margin')
      .set('Authorization', fixture.auth(owner.token))
      .send({ targetGrossMargin: 70, warningThreshold: 50, criticalThreshold: 90 })
      .expect(200);
    const customer = await fixture.customer(owner, `notify-${Date.now()}`, 100);

    await fixture.usage(owner, customer.id, 15, `notify-warning-${Date.now()}`).expect(201);
    const beforeConcurrentClaim = fixture.email.sent.length;
    const claims = await Promise.all([
      fixture.notifications.processOne(owner.organizationId),
      fixture.notifications.processOne(owner.organizationId),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(fixture.email.sent).toHaveLength(beforeConcurrentClaim + 1);
    expect(fixture.email.sent.at(-1)).toMatchObject({
      organizationId: owner.organizationId,
      recipient: 'notify@example.com',
      transition: 'opened_warning',
    });

    await fixture.usage(owner, customer.id, 12, `notify-critical-${Date.now()}`).expect(201);
    await fixture.notifications.processOne(owner.organizationId);
    expect(fixture.email.sent.at(-1)).toMatchObject({ transition: 'escalated_critical' });
    await fixture.usage(owner, customer.id, 0, `notify-duplicate-${Date.now()}`).expect(201);
    expect(
      await fixture.dataSource.manager.countBy(NotificationDeliveryEntity, {
        organizationId: owner.organizationId,
      }),
    ).toBe(2);

    await request(fixture.server())
      .put(`/api/v1/customers/${customer.id}`)
      .set('Authorization', fixture.auth(owner.token))
      .send({
        externalCustomerId: `notify-recovered-${Date.now()}`,
        name: 'Recovered',
        monthlyRevenue: 1000,
        currency: 'USD',
      })
      .expect(200);
    await fixture.notifications.processOne(owner.organizationId);
    expect(fixture.email.sent.at(-1)).toMatchObject({ transition: 'resolved' });
    const deliveries = await request(fixture.server())
      .get('/api/v1/settings/notifications/deliveries')
      .set('Authorization', fixture.auth(owner.token))
      .expect(200);
    expect(deliveries.body).toHaveLength(3);
    expect(deliveries.body.every((row: { status: string }) => row.status === 'sent')).toBe(true);
    const foreign = await request(fixture.server())
      .get('/api/v1/settings/notifications/deliveries')
      .set('Authorization', fixture.auth(outsider.token))
      .expect(200);
    expect(foreign.body).toEqual([]);
  });

  it('suppresses disabled delivery and bounds retries without changing alert state', async () => {
    const disabled = await fixture.register('notification-disabled');
    const disabledCustomer = await fixture.customer(disabled, `disabled-${Date.now()}`, 100);
    await fixture.usage(disabled, disabledCustomer.id, 30, `disabled-${Date.now()}`).expect(201);
    expect(
      await fixture.dataSource.manager.countBy(NotificationDeliveryEntity, {
        organizationId: disabled.organizationId,
      }),
    ).toBe(0);

    const owner = await fixture.register('notification-failure');
    await request(fixture.server())
      .put('/api/v1/settings/notifications')
      .set('Authorization', fixture.auth(owner.token))
      .send(preferences)
      .expect(200);
    const customer = await fixture.customer(owner, `failure-${Date.now()}`, 100);
    fixture.email.failuresRemaining = 3;
    await fixture.usage(owner, customer.id, 30, `failure-${Date.now()}`).expect(201);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await fixture.dataSource.manager.update(
        NotificationDeliveryEntity,
        { organizationId: owner.organizationId },
        { nextAttemptAt: new Date(0) },
      );
      await fixture.notifications.processOne(owner.organizationId);
    }
    const delivery = await fixture.dataSource.manager.findOneByOrFail(NotificationDeliveryEntity, {
      organizationId: owner.organizationId,
    });
    expect(delivery).toMatchObject({
      status: 'failed',
      attemptCount: 3,
      failureReason: 'Delivery failed.',
    });
    expect(
      await fixture.dataSource.manager.countBy(MarginAlertEntity, {
        organizationId: owner.organizationId,
        customerId: customer.id,
        resolvedAt: IsNull(),
      }),
    ).toBe(1);
  });
});
