import request from 'supertest';
import { IsNull } from 'typeorm';
import {
  AiUsageEventEntity,
  BillingSubscriptionEntity,
  CustomerEntity,
  MarginAlertEntity,
  MarginSnapshotEntity,
  StripeConnectionEntity,
  StripeWebhookEventEntity,
} from '../../src/database/entities';
import { MarginAlertType, StripeCustomerStatus } from '../../src/common/enums/domain.enums';
import { TestApp } from '../support/test-app';

describe('Stripe parity, security, and lifecycle (PostgreSQL)', () => {
  const fixture = new TestApp();
  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());
  beforeEach(() => {
    fixture.stripe.state = {
      account: { accountId: 'acct_nest_test', liveMode: false },
      customers: [],
      subscriptions: [],
    };
    fixture.stripe.fetchCalls = 0;
    fixture.stripe.fetchDelayMs = 0;
    fixture.stripe.fetchError = null;
    fixture.stripe.verifyError = null;
  });

  it('encrypts credentials at rest and never returns either secret', async () => {
    const session = await fixture.register('stripe-encryption');
    const connected = await fixture.connect(session).expect(201);
    const serialized = JSON.stringify(connected.body);
    expect(serialized).not.toContain('rk_test_boundary_fake');
    expect(serialized).not.toContain('whsec_test_secret');
    const row = await fixture.dataSource.manager.findOneByOrFail(StripeConnectionEntity, {
      organizationId: session.organizationId,
    });
    expect(row.encryptedSecretKey).not.toContain('rk_test_boundary_fake');
    expect(row.encryptedWebhookSecret).not.toContain('whsec_test_secret');
  });

  it('maps rejected credentials to a safe client error without disclosure', async () => {
    const session = await fixture.register('stripe-invalid-key');
    fixture.stripe.verifyError = new Error('credential rk_test_boundary_fake rejected');
    const response = await fixture.connect(session).expect(400);
    expect(response.body.detail).toBe('We could not verify the Stripe credential right now.');
    expect(JSON.stringify(response.body)).not.toContain('rk_test_boundary_fake');
  });

  it('keeps connection, sync, and webhook-secret administration tenant-scoped', async () => {
    const a = await fixture.register('stripe-tenant-a');
    const b = await fixture.register('stripe-tenant-b');
    await fixture.connect(a).expect(201);
    const bStatus = await request(fixture.server())
      .get('/api/v1/integrations/stripe')
      .set('Authorization', fixture.auth(b.token))
      .expect(200);
    expect(bStatus.body.connected).toBe(false);
    await fixture.sync(b).expect(409);
    await request(fixture.server())
      .put('/api/v1/integrations/stripe/webhook-secret')
      .set('Authorization', fixture.auth(b.token))
      .send({ webhookSecret: 'whsec_other' })
      .expect(409);
    const aStatus = await request(fixture.server())
      .get('/api/v1/integrations/stripe')
      .set('Authorization', fixture.auth(a.token))
      .expect(200);
    expect(aStatus.body.connected).toBe(true);
  });

  it('repeated full sync is idempotent and aggregates multiple subscriptions', async () => {
    const session = await fixture.register('stripe-idempotent');
    await fixture.connect(session).expect(201);
    fixture.stripe.state = {
      account: { accountId: 'acct_nest_test', liveMode: false },
      customers: [{ id: 'cus_idempotent', name: 'ACME', email: null, deleted: false }],
      subscriptions: [
        fixture.subscription('sub_base', 'cus_idempotent', '99'),
        fixture.subscription('sub_addon', 'cus_idempotent', '49'),
      ],
    };
    await fixture.sync(session).expect(201);
    await fixture.sync(session).expect(201);
    const customers = await fixture.dataSource.manager.findBy(CustomerEntity, {
      organizationId: session.organizationId,
      stripeCustomerId: 'cus_idempotent',
    });
    const subscriptions = await fixture.dataSource.manager.findBy(BillingSubscriptionEntity, {
      organizationId: session.organizationId,
    });
    expect(customers).toHaveLength(1);
    expect(Number(customers[0]?.monthlyRevenue)).toBe(148);
    expect(subscriptions).toHaveLength(2);
  });

  it('serializes concurrent full sync attempts without duplicate state', async () => {
    const session = await fixture.register('stripe-concurrent');
    await fixture.connect(session).expect(201);
    fixture.stripe.state = {
      account: { accountId: 'acct_nest_test', liveMode: false },
      customers: [{ id: 'cus_concurrent', name: 'Concurrent', email: null, deleted: false }],
      subscriptions: [fixture.subscription('sub_concurrent', 'cus_concurrent', '99')],
    };
    fixture.stripe.fetchDelayMs = 200;
    const [a, b] = await Promise.all([fixture.sync(session), fixture.sync(session)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(
      await fixture.dataSource.manager.countBy(BillingSubscriptionEntity, {
        organizationId: session.organizationId,
        externalSubscriptionId: 'sub_concurrent',
      }),
    ).toBe(1);
  });

  it('preserves revenue and does not reconcile missing customers after external fetch failure', async () => {
    const session = await fixture.register('stripe-failure');
    await fixture.connect(session).expect(201);
    fixture.stripe.state = {
      account: { accountId: 'acct_nest_test', liveMode: false },
      customers: [{ id: 'cus_failure', name: 'Preserved', email: null, deleted: false }],
      subscriptions: [fixture.subscription('sub_failure', 'cus_failure', '99')],
    };
    await fixture.sync(session).expect(201);
    fixture.stripe.fetchError = new Error('external boundary unavailable');
    const failed = await fixture.sync(session).expect(502);
    expect(failed.body.detail).toBe(
      'Stripe could not be reached or rejected the stored credential. Existing revenue was preserved.',
    );
    const customer = await fixture.dataSource.manager.findOneByOrFail(CustomerEntity, {
      organizationId: session.organizationId,
      stripeCustomerId: 'cus_failure',
    });
    expect(Number(customer.monthlyRevenue)).toBe(99);
    expect(customer.stripeCustomerStatus).toBe(StripeCustomerStatus.Active);
  });

  it('upgrades, downgrades, and cancels while preserving usage and alert semantics', async () => {
    const session = await fixture.register('stripe-lifecycle');
    await fixture.connect(session).expect(201);
    const setMrr = (mrr: string, status = 'active') => {
      fixture.stripe.state = {
        account: { accountId: 'acct_nest_test', liveMode: false },
        customers: [{ id: 'cus_lifecycle_nest', name: 'Lifecycle', email: null, deleted: false }],
        subscriptions: [
          fixture.subscription('sub_lifecycle_nest', 'cus_lifecycle_nest', mrr, status),
        ],
      };
    };
    setMrr('99');
    await fixture.sync(session).expect(201);
    const customer = await fixture.dataSource.manager.findOneByOrFail(CustomerEntity, {
      organizationId: session.organizationId,
      stripeCustomerId: 'cus_lifecycle_nest',
    });
    await fixture.usage(session, customer.id, 40, `lifecycle-${Date.now()}`).expect(201);
    let detail = await request(fixture.server())
      .get(`/api/v1/customers/${customer.id}/margin`)
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(detail.body.status).toBe('atRisk');
    setMrr('149');
    await fixture.sync(session).expect(201);
    detail = await request(fixture.server())
      .get(`/api/v1/customers/${customer.id}/margin`)
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(detail.body.status).toBe('healthy');
    expect(detail.body.grossMargin).toBeCloseTo((109 / 149) * 100, 10);
    expect(
      await fixture.dataSource.manager.countBy(MarginAlertEntity, {
        organizationId: session.organizationId,
        customerId: customer.id,
        type: MarginAlertType.MarginBelowTarget,
        resolvedAt: IsNull(),
      }),
    ).toBe(0);
    setMrr('0', 'canceled');
    await fixture.sync(session).expect(201);
    detail = await request(fixture.server())
      .get(`/api/v1/customers/${customer.id}/margin`)
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(detail.body).toMatchObject({
      revenue: 0,
      aiCost: 40,
      grossMargin: null,
      status: 'critical',
    });
    expect(
      await fixture.dataSource.manager.countBy(AiUsageEventEntity, {
        organizationId: session.organizationId,
        customerId: customer.id,
      }),
    ).toBe(1);
  });

  it('successful full sync reconciles absent Stripe customers without deleting history', async () => {
    const session = await fixture.register('stripe-absent');
    await fixture.connect(session).expect(201);
    fixture.stripe.state = {
      account: { accountId: 'acct_nest_test', liveMode: false },
      customers: [{ id: 'cus_absent_nest', name: 'Absent', email: null, deleted: false }],
      subscriptions: [fixture.subscription('sub_absent_nest', 'cus_absent_nest', '49')],
    };
    await fixture.sync(session).expect(201);
    const customer = await fixture.dataSource.manager.findOneByOrFail(CustomerEntity, {
      organizationId: session.organizationId,
      stripeCustomerId: 'cus_absent_nest',
    });
    await fixture.usage(session, customer.id, 3, `absent-${Date.now()}`).expect(201);
    fixture.stripe.state = { ...fixture.stripe.state, customers: [], subscriptions: [] };
    await fixture.sync(session).expect(201);
    const current = await fixture.dataSource.manager.findOneByOrFail(CustomerEntity, {
      id: customer.id,
      organizationId: session.organizationId,
    });
    expect(current.stripeCustomerStatus).toBe(StripeCustomerStatus.Deleted);
    expect(Number(current.monthlyRevenue)).toBe(0);
    expect(current.revenueStale).toBe(false);
    expect(
      await fixture.dataSource.manager.countBy(AiUsageEventEntity, {
        customerId: customer.id,
        organizationId: session.organizationId,
      }),
    ).toBe(1);
  });

  it('preserves manual customers and marks projected revenue stale on disconnect', async () => {
    const session = await fixture.register('stripe-manual');
    const manual = await fixture.customer(session, `manual-${Date.now()}`, 125);
    await fixture.connect(session).expect(201);
    fixture.stripe.state = {
      account: { accountId: 'acct_nest_test', liveMode: false },
      customers: [{ id: 'cus_disconnect_nest', name: 'Disconnect', email: null, deleted: false }],
      subscriptions: [fixture.subscription('sub_disconnect_nest', 'cus_disconnect_nest', '99')],
    };
    await fixture.sync(session).expect(201);
    await request(fixture.server())
      .delete('/api/v1/integrations/stripe')
      .set('Authorization', fixture.auth(session.token))
      .expect(204);
    const rows = await fixture.dataSource.manager.findBy(CustomerEntity, {
      organizationId: session.organizationId,
    });
    expect(rows.find((x) => x.id === manual.id)?.revenueSource).toBe('Manual');
    const stripe = rows.find((x) => x.stripeCustomerId === 'cus_disconnect_nest');
    expect(Number(stripe?.monthlyRevenue)).toBe(99);
    expect(stripe?.revenueStale).toBe(true);
  });

  it('accepts valid raw-body signature and rejects missing or invalid signatures without persistence', async () => {
    const session = await fixture.register('stripe-signature');
    const secret = 'whsec_signature_test';
    const connection = await fixture.connect(session, secret).expect(201);
    const path = connection.body.webhookPath as string;
    const payload = JSON.stringify({
      id: `evt-valid-${Date.now()}`,
      object: 'event',
      type: 'invoice.created',
      data: { object: {} },
    });
    await request(fixture.server())
      .post(path)
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', fixture.signature(payload, secret))
      .send(payload)
      .expect(201);
    await request(fixture.server())
      .post(path)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(400);
    const invalidId = `evt-invalid-${Date.now()}`;
    const invalidPayload = JSON.stringify({
      id: invalidId,
      object: 'event',
      type: 'invoice.created',
      data: { object: {} },
    });
    await request(fixture.server())
      .post(path)
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 't=1,v1=invalid')
      .send(invalidPayload)
      .expect(400);
    expect(
      await fixture.dataSource.manager.countBy(StripeWebhookEventEntity, {
        stripeEventId: invalidId,
      }),
    ).toBe(0);
  });

  it('processes a duplicate Stripe delivery across concurrent logical replicas only once', async () => {
    const session = await fixture.register('stripe-webhook-race');
    const secret = 'whsec_race_test';
    const connection = await fixture.connect(session, secret).expect(201);
    fixture.stripe.state = {
      account: { accountId: 'acct_nest_test', liveMode: false },
      customers: [{ id: 'cus_hook_nest', name: 'Hook', email: null, deleted: false }],
      subscriptions: [fixture.subscription('sub_hook_nest', 'cus_hook_nest', '99')],
    };
    fixture.stripe.fetchDelayMs = 100;
    const eventId = `evt-race-${Date.now()}`;
    const payload = JSON.stringify({
      id: eventId,
      object: 'event',
      type: 'customer.subscription.updated',
      data: { object: {} },
    });
    const signature = fixture.signature(payload, secret);
    const path = connection.body.webhookPath as string;
    const send = () =>
      request(fixture.server())
        .post(path)
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', signature)
        .send(payload);
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(fixture.stripe.fetchCalls).toBe(1);
    expect(
      await fixture.dataSource.manager.countBy(StripeWebhookEventEntity, {
        stripeEventId: eventId,
      }),
    ).toBe(1);
    expect(
      await fixture.dataSource.manager.countBy(BillingSubscriptionEntity, {
        organizationId: session.organizationId,
        externalSubscriptionId: 'sub_hook_nest',
      }),
    ).toBe(1);
  });

  it('accepts a competing event and persists it for internal retry', async () => {
    const session = await fixture.register('stripe-webhook-lock');
    const secret = 'whsec_lock_test';
    const connection = await fixture.connect(session, secret).expect(201);
    fixture.stripe.state = {
      account: { accountId: 'acct_nest_test', liveMode: false },
      customers: [{ id: 'cus_lock_nest', name: 'Lock', email: null, deleted: false }],
      subscriptions: [fixture.subscription('sub_lock_nest', 'cus_lock_nest', '99')],
    };
    fixture.stripe.fetchDelayMs = 150;
    const payloads = ['a', 'b'].map((suffix) =>
      JSON.stringify({
        id: `evt-lock-${suffix}-${Date.now()}`,
        object: 'event',
        type: 'customer.subscription.updated',
        data: { object: {} },
      }),
    );
    const path = connection.body.webhookPath as string;
    const send = (payload: string) =>
      request(fixture.server())
        .post(path)
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', fixture.signature(payload, secret))
        .send(payload);
    const initial = await Promise.all(payloads.map(send));
    expect(initial.map((x) => x.status)).toEqual([201, 201]);
    expect(
      await fixture.dataSource.manager.countBy(StripeWebhookEventEntity, {
        organizationId: session.organizationId,
      }),
    ).toBeGreaterThanOrEqual(2);
    expect(
      await fixture.dataSource.manager.countBy(BillingSubscriptionEntity, {
        organizationId: session.organizationId,
        externalSubscriptionId: 'sub_lock_nest',
      }),
    ).toBe(1);
  });

  it('customer.deleted webhook preserves customer, usage, prior snapshot, and zero-revenue lifecycle', async () => {
    const session = await fixture.register('stripe-delete');
    const secret = 'whsec_delete_test';
    const connection = await fixture.connect(session, secret).expect(201);
    fixture.stripe.state = {
      account: { accountId: 'acct_nest_test', liveMode: false },
      customers: [{ id: 'cus_delete_nest', name: 'Delete', email: null, deleted: false }],
      subscriptions: [fixture.subscription('sub_delete_nest', 'cus_delete_nest', '99')],
    };
    await fixture.sync(session).expect(201);
    const customer = await fixture.dataSource.manager.findOneByOrFail(CustomerEntity, {
      organizationId: session.organizationId,
      stripeCustomerId: 'cus_delete_nest',
    });
    await fixture.usage(session, customer.id, 12, `delete-${Date.now()}`).expect(201);
    const currentSnapshot = await fixture.dataSource.manager.findOneByOrFail(MarginSnapshotEntity, {
      organizationId: session.organizationId,
      customerId: customer.id,
    });
    const previous = fixture.dataSource.manager.create(MarginSnapshotEntity, {
      organizationId: currentSnapshot.organizationId,
      customerId: currentSnapshot.customerId,
      periodStart: new Date(Date.UTC(2020, 0, 1)),
      periodEnd: new Date(Date.UTC(2020, 1, 1)),
      revenue: currentSnapshot.revenue,
      aiCost: currentSnapshot.aiCost,
      grossProfit: currentSnapshot.grossProfit,
      grossMargin: currentSnapshot.grossMargin,
      allowedAiBudget: currentSnapshot.allowedAiBudget,
      remainingAiBudget: currentSnapshot.remainingAiBudget,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await fixture.dataSource.manager.save(previous);
    fixture.stripe.state = { ...fixture.stripe.state, customers: [], subscriptions: [] };
    const eventId = `evt-delete-${Date.now()}`;
    const payload = JSON.stringify({
      id: eventId,
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
    const detail = await request(fixture.server())
      .get(`/api/v1/customers/${customer.id}/margin`)
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(detail.body).toMatchObject({
      revenue: 0,
      aiCost: 12,
      grossMargin: null,
      status: 'critical',
      stripeCustomerStatus: 'deleted',
      revenueStale: false,
    });
    expect(detail.body.subscriptions[0]).toMatchObject({
      status: 'canceled',
      monthlyRecurringRevenue: 0,
    });
    expect(
      await fixture.dataSource.manager.countBy(MarginSnapshotEntity, {
        organizationId: session.organizationId,
        customerId: customer.id,
      }),
    ).toBe(2);
    await request(fixture.server())
      .post(connection.body.webhookPath as string)
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', fixture.signature(payload, secret))
      .send(payload)
      .expect(201);
    expect(await fixture.dataSource.manager.countBy(CustomerEntity, { id: customer.id })).toBe(1);
  });

  it('connection-specific webhook cannot cross tenant customer or subscription mappings', async () => {
    const a = await fixture.register('hook-tenant-a');
    const b = await fixture.register('hook-tenant-b');
    const secretA = 'whsec_tenant_a';
    await fixture.connect(a, secretA).expect(201);
    fixture.stripe.state = {
      account: { accountId: 'acct_nest_test', liveMode: false },
      customers: [{ id: 'cus_shared_nest', name: 'Shared', email: null, deleted: false }],
      subscriptions: [fixture.subscription('sub_shared_nest', 'cus_shared_nest', '75')],
    };
    await fixture.sync(a).expect(201);
    await fixture.connect(b, 'whsec_tenant_b').expect(201);
    await fixture.sync(b).expect(201);
    const connectionA = await request(fixture.server())
      .get('/api/v1/integrations/stripe')
      .set('Authorization', fixture.auth(a.token))
      .expect(200);
    fixture.stripe.state = { ...fixture.stripe.state, customers: [], subscriptions: [] };
    const payload = JSON.stringify({
      id: `evt-tenant-${Date.now()}`,
      object: 'event',
      type: 'customer.deleted',
      data: { object: {} },
    });
    await request(fixture.server())
      .post(connectionA.body.webhookPath as string)
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', fixture.signature(payload, secretA))
      .send(payload)
      .expect(201);
    const rows = await fixture.dataSource.manager.findBy(CustomerEntity, {
      stripeCustomerId: 'cus_shared_nest',
    });
    expect(rows.find((x) => x.organizationId === a.organizationId)?.stripeCustomerStatus).toBe(
      StripeCustomerStatus.Deleted,
    );
    expect(rows.find((x) => x.organizationId === b.organizationId)?.stripeCustomerStatus).toBe(
      StripeCustomerStatus.Active,
    );
  });
});
