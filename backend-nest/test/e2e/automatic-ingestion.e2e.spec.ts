import request from 'supertest';
import { AiUsageEventEntity, IngestionApiKeyEntity } from '../../src/database/entities';
import { TestApp, AuthSession } from '../support/test-app';

describe('production automatic usage ingestion (PostgreSQL)', () => {
  const fixture = new TestApp();
  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());
  const createKey = async (session: AuthSession, name = 'Production backend') =>
    (
      await request(fixture.server())
        .post('/api/v1/integrations/usage-api-keys')
        .set('Authorization', fixture.auth(session.token))
        .send({ name })
        .expect(201)
    ).body as { id: string; secret: string; keyPrefix: string };
  const createCustomer = async (session: AuthSession, externalId: string, revenue = 100) =>
    fixture.customer(session, externalId, revenue);
  const payload = (
    customerId: string,
    externalRequestId: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    externalRequestId,
    customerId,
    provider: 'openai',
    model: 'gpt-5',
    feature: 'support-chat',
    usage: { inputTokens: 1200, outputTokens: 350 },
    occurredAt: new Date().toISOString(),
    metadata: { conversationId: 'safe-id' },
    ...overrides,
  });
  const ingest = (secret: string, body: object) =>
    request(fixture.server())
      .post('/api/v1/ingest/usage')
      .set('X-Margintra-Key', secret)
      .send(body);

  it('creates a one-time secret, hashes it at rest, and lists metadata without secrets', async () => {
    const session = await fixture.register('api-key-storage');
    const key = await createKey(session);
    expect(key.secret).toMatch(/^mtr_live_/);
    expect(key.keyPrefix).toBe(key.secret.slice(0, 28));
    const stored = await fixture.dataSource.manager.findOneByOrFail(IngestionApiKeyEntity, {
      id: key.id,
    });
    expect(stored.secretHash).not.toContain(key.secret);
    const list = await request(fixture.server())
      .get('/api/v1/integrations/usage-api-keys')
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain(key.secret);
    expect(list.body[0].secret).toBeUndefined();
  });

  it('authenticates a valid key and rejects missing or malformed keys safely', async () => {
    const session = await fixture.register('key-auth');
    const customer = await createCustomer(session, 'key-auth-customer');
    const key = await createKey(session);
    await ingest(key.secret, payload('key-auth-customer', `req-${Date.now()}`)).expect(202);
    await request(fixture.server())
      .post('/api/v1/ingest/usage')
      .set('X-MarginOS-Key', key.secret)
      .send(payload('key-auth-customer', `legacy-header-${Date.now()}`))
      .expect(401);
    await ingest(
      key.secret.replace(/^mtr_live_/, 'mos_live_'),
      payload('key-auth-customer', `legacy-prefix-${Date.now()}`),
    ).expect(401);
    const invalid = await ingest(
      'mtr_live_invalid',
      payload('key-auth-customer', 'req-invalid'),
    ).expect(401);
    expect(invalid.body.code).toBe('INVALID_API_KEY');
    expect(JSON.stringify(invalid.body)).not.toContain('mtr_live_invalid');
    expect(customer.id).toBeDefined();
  });

  it('revokes immediately and prevents cross-tenant listing or revocation', async () => {
    const owner = await fixture.register('key-owner');
    const other = await fixture.register('key-other');
    const key = await createKey(owner);
    const otherList = await request(fixture.server())
      .get('/api/v1/integrations/usage-api-keys')
      .set('Authorization', fixture.auth(other.token))
      .expect(200);
    expect(otherList.body).toHaveLength(0);
    await request(fixture.server())
      .delete(`/api/v1/integrations/usage-api-keys/${key.id}`)
      .set('Authorization', fixture.auth(other.token))
      .expect(404);
    await request(fixture.server())
      .delete(`/api/v1/integrations/usage-api-keys/${key.id}`)
      .set('Authorization', fixture.auth(owner.token))
      .expect(200);
    const rejected = await ingest(key.secret, payload('missing', `revoked-${Date.now()}`)).expect(
      401,
    );
    expect(rejected.body.code).toBe('API_KEY_REVOKED');
  });

  it('attributes by external customer ID only within the key organization', async () => {
    const owner = await fixture.register('attribution-owner');
    const other = await fixture.register('attribution-other');
    await createCustomer(other, 'foreign-external-id');
    const key = await createKey(owner);
    const missing = await ingest(
      key.secret,
      payload('foreign-external-id', `foreign-${Date.now()}`),
    ).expect(404);
    expect(missing.body.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('resolves native and prefixed Stripe customer IDs without crossing tenants', async () => {
    const owner = await fixture.register('stripe-ingestion-owner');
    const other = await fixture.register('stripe-ingestion-other');
    await fixture.connect(owner).expect(201);
    fixture.stripe.state = {
      account: { accountId: 'acct_nest_test', liveMode: false },
      customers: [{ id: 'cus_123', name: 'Stripe owner', email: null, deleted: false }],
      subscriptions: [],
    };
    await fixture.sync(owner).expect(201);
    await fixture.connect(other).expect(201);
    fixture.stripe.state = {
      account: { accountId: 'acct_nest_test', liveMode: false },
      customers: [{ id: 'cus_foreign', name: 'Stripe foreign', email: null, deleted: false }],
      subscriptions: [],
    };
    await fixture.sync(other).expect(201);
    const key = await createKey(owner);
    await ingest(key.secret, payload('cus_123', `native-stripe-${Date.now()}`)).expect(201);
    await ingest(key.secret, payload('stripe:cus_123', `prefixed-stripe-${Date.now()}`)).expect(
      201,
    );
    const unknown = await ingest(
      key.secret,
      payload('cus_unknown', `unknown-stripe-${Date.now()}`),
    ).expect(404);
    expect(unknown.body.code).toBe('CUSTOMER_NOT_FOUND');
    const foreign = await ingest(
      key.secret,
      payload('cus_foreign', `foreign-stripe-${Date.now()}`),
    ).expect(404);
    expect(foreign.body.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('calculates and persists versioned OpenAI cost with normalized response', async () => {
    const session = await fixture.register('calculated');
    const customer = await createCustomer(session, 'calculated-customer');
    const key = await createKey(session);
    const response = await ingest(
      key.secret,
      payload('calculated-customer', `calc-${Date.now()}`),
    ).expect(201);
    expect(response.body).toMatchObject({
      accepted: true,
      duplicate: false,
      customerId: customer.id,
      cost: '0.005000',
      currency: 'USD',
      costSource: 'calculated',
    });
    expect(response.body.pricingVersion).toBeTruthy();
  });

  it('accepts authoritative explicit USD cost but rejects unknown calculated models and oversized metadata', async () => {
    const session = await fixture.register('explicit');
    await createCustomer(session, 'explicit-customer');
    const key = await createKey(session);
    const explicit = await ingest(
      key.secret,
      payload('explicit-customer', `explicit-${Date.now()}`, {
        model: 'private-fine-tune',
        cost: '12.345678',
        currency: 'USD',
      }),
    ).expect(201);
    expect(explicit.body).toMatchObject({
      cost: '12.345678',
      costSource: 'explicit',
      pricingVersion: null,
    });
    const unknown = await ingest(
      key.secret,
      payload('explicit-customer', `unknown-${Date.now()}`, { model: 'unknown-model' }),
    ).expect(422);
    expect(unknown.body.code).toBe('UNSUPPORTED_MODEL');
    const large = await ingest(
      key.secret,
      payload('explicit-customer', `large-${Date.now()}`, {
        metadata: { value: 'x'.repeat(5000) },
      }),
    ).expect(422);
    expect(large.body.code).toBe('INVALID_USAGE');
    const excessive = await ingest(
      key.secret,
      payload('explicit-customer', `excessive-${Date.now()}`, {
        cost: '1000000000000.000000',
        currency: 'USD',
      }),
    ).expect(422);
    expect(excessive.body.code).toBe('INVALID_USAGE');
  });

  it('treats same-month occurredAt drift as an equivalent duplicate and preserves the original event', async () => {
    const session = await fixture.register('duplicates');
    await createCustomer(session, 'duplicate-customer');
    const key = await createKey(session);
    const originalOccurredAt = new Date();
    let retryOccurredAt = new Date(originalOccurredAt.getTime() + 1_000);
    if (retryOccurredAt.getUTCMonth() !== originalOccurredAt.getUTCMonth())
      retryOccurredAt = new Date(originalOccurredAt.getTime() - 1_000);
    const body = payload('duplicate-customer', `same-${Date.now()}`, {
      occurredAt: originalOccurredAt.toISOString(),
    });
    const first = await ingest(key.secret, body).expect(201);
    const second = await ingest(key.secret, {
      ...body,
      occurredAt: retryOccurredAt.toISOString(),
    }).expect(201);
    expect(second.body).toMatchObject({ duplicate: true, usageEventId: first.body.usageEventId });
    const persisted = await fixture.dataSource.manager.findOneByOrFail(AiUsageEventEntity, {
      id: first.body.usageEventId as string,
      organizationId: session.organizationId,
    });
    expect(persisted.occurredAt.toISOString()).toBe(originalOccurredAt.toISOString());
    expect(
      await fixture.dataSource.manager.countBy(AiUsageEventEntity, {
        organizationId: session.organizationId,
        externalRequestId: body.externalRequestId,
      }),
    ).toBe(1);
    const concurrentBody = payload('duplicate-customer', `concurrent-same-${Date.now()}`);
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () => ingest(key.secret, concurrentBody)),
    );
    expect(concurrent.every((x) => x.status === 201)).toBe(true);
    expect(
      new Set(concurrent.map((x) => (x.body as { usageEventId: string }).usageEventId)).size,
    ).toBe(1);
    expect(concurrent.filter((x) => !x.body.duplicate)).toHaveLength(1);
  });

  it('rejects materially different replay and preserves financial state', async () => {
    const session = await fixture.register('conflict');
    const customer = await createCustomer(session, 'conflict-customer');
    const key = await createKey(session);
    const id = `conflict-${Date.now()}`;
    const body = payload('conflict-customer', id);
    await ingest(key.secret, body).expect(201);
    const before = await request(fixture.server())
      .get(`/api/v1/customers/${customer.id}/margin`)
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    const conflict = await ingest(key.secret, {
      ...body,
      usage: { inputTokens: 9999, outputTokens: 1 },
    }).expect(409);
    expect(conflict.body.code).toBe('DUPLICATE_REQUEST_CONFLICT');
    const after = await request(fixture.server())
      .get(`/api/v1/customers/${customer.id}/margin`)
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(after.body.aiCost).toBe(before.body.aiCost);
  });

  it('atomically updates cost, margin status, alert, and dashboard through realistic thresholds', async () => {
    const session = await fixture.register('financial-flow');
    const customer = await createCustomer(session, 'financial-customer', 100);
    const key = await createKey(session);
    await ingest(
      key.secret,
      payload('financial-customer', `risk-${Date.now()}`, { cost: '31.000000', currency: 'USD' }),
    ).expect(201);
    let margin = await request(fixture.server())
      .get(`/api/v1/customers/${customer.id}/margin`)
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(margin.body).toMatchObject({ aiCost: 31, grossMargin: 69, status: 'atRisk' });
    await ingest(
      key.secret,
      payload('financial-customer', `critical-${Date.now()}`, {
        cost: '69.000000',
        currency: 'USD',
      }),
    ).expect(201);
    margin = await request(fixture.server())
      .get(`/api/v1/customers/${customer.id}/margin`)
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(margin.body).toMatchObject({ aiCost: 100, grossMargin: 0, status: 'critical' });
    const dashboard = await request(fixture.server())
      .get('/api/v1/dashboard/customers')
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(
      dashboard.body.find((x: { customerId: string }) => x.customerId === customer.id),
    ).toMatchObject({ aiCost: 100, status: 'critical' });
    const alerts = await fixture.dataSource.query(
      'SELECT "Severity" FROM "margin_alerts" WHERE "OrganizationId"=$1 AND "CustomerId"=$2 AND "ResolvedAt" IS NULL',
      [session.organizationId, customer.id],
    );
    expect(alerts).toEqual([expect.objectContaining({ Severity: 'Critical' })]);
  });

  it('does not lose cost under concurrent unique usage for one customer', async () => {
    const session = await fixture.register('unique-concurrency');
    const customer = await createCustomer(session, 'unique-concurrency-customer');
    const key = await createKey(session);
    const seed = Date.now();
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        ingest(
          key.secret,
          payload('unique-concurrency-customer', `unique-${seed}-${String(index)}`, {
            cost: '1.234567',
            currency: 'USD',
          }),
        ),
      ),
    );
    expect(responses.every((x) => x.status === 201)).toBe(true);
    const margin = await request(fixture.server())
      .get(`/api/v1/customers/${customer.id}/margin`)
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(margin.body.aiCost).toBe(12.34567);
  });

  it('rejects prior-month and excessive-future events rather than corrupting the current snapshot', async () => {
    const session = await fixture.register('timestamp');
    await createCustomer(session, 'timestamp-customer');
    const key = await createKey(session);
    const old = new Date();
    old.setUTCMonth(old.getUTCMonth() - 1);
    const past = await ingest(
      key.secret,
      payload('timestamp-customer', `past-${Date.now()}`, { occurredAt: old.toISOString() }),
    ).expect(422);
    expect(past.body.code).toBe('INVALID_USAGE');
    const future = new Date(Date.now() + 10 * 60_000);
    await ingest(
      key.secret,
      payload('timestamp-customer', `future-${Date.now()}`, { occurredAt: future.toISOString() }),
    ).expect(422);
  });

  it('returns a stable 429 error when the API-key-aware limiter rejects traffic', async () => {
    const session = await fixture.register('rate-limit');
    await createCustomer(session, 'rate-limit-customer');
    const key = await createKey(session);
    fixture.rateLimit.reject = true;
    try {
      const response = await ingest(
        key.secret,
        payload('rate-limit-customer', `rate-${Date.now()}`),
      ).expect(429);
      expect(response.body.code).toBe('RATE_LIMITED');
    } finally {
      fixture.rateLimit.reject = false;
    }
  });
});
