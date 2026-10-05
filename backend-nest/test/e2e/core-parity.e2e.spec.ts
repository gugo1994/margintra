import request from 'supertest';
import { IsNull } from 'typeorm';
import {
  AiUsageEventEntity,
  MarginAlertEntity,
  MarginSnapshotEntity,
  OrganizationMemberEntity,
  UserEntity,
} from '../../src/database/entities';
import { MarginAlertType, OrganizationRole } from '../../src/common/enums/domain.enums';
import { TestApp } from '../support/test-app';

describe('Core API parity and isolation (PostgreSQL)', () => {
  const fixture = new TestApp();
  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());

  it('registration atomically creates normalized user, organization, and owner membership', async () => {
    const email = ` Test-${Date.now()}@Example.com `;
    const response = await request(fixture.server())
      .post('/api/v1/auth/register')
      .send({ email, password: 'Password123!', organizationName: 'Registration' })
      .expect(201);
    expect(response.body.email).toBe(email.trim().toLowerCase());
    const user = await fixture.dataSource.manager.findOneByOrFail(UserEntity, {
      id: response.body.userId as string,
    });
    const membership = await fixture.dataSource.manager.findOneByOrFail(OrganizationMemberEntity, {
      userId: user.id,
      organizationId: response.body.organizationId as string,
    });
    expect(membership.role).toBe(OrganizationRole.Owner);
    expect(user.passwordHash).not.toContain('Password123!');
  });

  it('login is case-insensitive and invalid credentials return a safe 401', async () => {
    const email = `login-${Date.now()}@example.test`;
    await request(fixture.server())
      .post('/api/v1/auth/register')
      .send({ email, password: 'Password123!', organizationName: 'Login' })
      .expect(201);
    const valid = await request(fixture.server())
      .post('/api/v1/auth/login')
      .send({ email: email.toUpperCase(), password: 'Password123!' })
      .expect(201);
    expect(valid.body.accessToken).toEqual(expect.any(String));
    const invalid = await request(fixture.server())
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);
    expect(invalid.body.detail).toBe('Email or password is incorrect.');
    expect(JSON.stringify(invalid.body)).not.toContain('passwordHash');
  });

  it('duplicate normalized email and concurrent registration are controlled conflicts', async () => {
    const email = `race-${Date.now()}@example.test`;
    const body = { email, password: 'Password123!', organizationName: 'Race' };
    const [a, b] = await Promise.all([
      request(fixture.server()).post('/api/v1/auth/register').send(body),
      request(fixture.server())
        .post('/api/v1/auth/register')
        .send({ ...body, email: email.toUpperCase() }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await fixture.dataSource.manager.countBy(UserEntity, { email })).toBe(1);
    await request(fixture.server()).post('/api/v1/auth/register').send(body).expect(409);
  });

  it('requires authentication and ignores caller-supplied organization identity', async () => {
    await request(fixture.server()).get('/api/v1/customers').expect(401);
    const session = await fixture.register('identity');
    const created = await request(fixture.server())
      .post('/api/v1/customers')
      .set('Authorization', fixture.auth(session.token))
      .set('X-Organization-Id', '00000000-0000-0000-0000-000000000000')
      .send({
        organizationId: session.organizationId,
        externalCustomerId: 'injected',
        name: 'Injected',
        monthlyRevenue: 1,
        currency: 'USD',
      })
      .expect(400);
    expect(created.body.status).toBe(400);
  });

  it('does not reveal or mutate another tenant customer, margin, or usage', async () => {
    const owner = await fixture.register('tenant-owner');
    const outsider = await fixture.register('tenant-outsider');
    const foreign = await fixture.customer(owner, `private-${Date.now()}`);
    const auth = fixture.auth(outsider.token);
    await request(fixture.server())
      .get(`/api/v1/customers/${foreign.id}`)
      .set('Authorization', auth)
      .expect(404);
    await request(fixture.server())
      .get(`/api/v1/customers/${foreign.id}/margin`)
      .set('Authorization', auth)
      .expect(404);
    await request(fixture.server())
      .put(`/api/v1/customers/${foreign.id}`)
      .set('Authorization', auth)
      .send({ externalCustomerId: 'changed', name: 'Changed', monthlyRevenue: 1, currency: 'USD' })
      .expect(404);
    await fixture.usage(outsider, foreign.id, 1, `foreign-${Date.now()}`).expect(404);
  });

  it('enforces customer external ID uniqueness per tenant, not globally', async () => {
    const a = await fixture.register('unique-a');
    const b = await fixture.register('unique-b');
    const id = `shared-${Date.now()}`;
    await fixture.customer(a, id);
    await request(fixture.server())
      .post('/api/v1/customers')
      .set('Authorization', fixture.auth(a.token))
      .send({ externalCustomerId: id, name: 'Duplicate', monthlyRevenue: 1, currency: 'USD' })
      .expect(409);
    await fixture.customer(b, id);
  });

  it('rejects invalid financial and usage values through DTO validation', async () => {
    const session = await fixture.register('validation');
    await request(fixture.server())
      .post('/api/v1/customers')
      .set('Authorization', fixture.auth(session.token))
      .send({
        externalCustomerId: 'negative',
        name: 'Negative',
        monthlyRevenue: -1,
        currency: 'USD',
      })
      .expect(400);
    const customer = await fixture.customer(session, `valid-${Date.now()}`);
    await fixture.usage(session, customer.id, -1, `negative-${Date.now()}`).expect(400);
    await request(fixture.server())
      .put('/api/v1/settings/margin')
      .set('Authorization', fixture.auth(session.token))
      .send({ targetGrossMargin: 100 })
      .expect(400);
  });

  it('ingests sequential and concurrent duplicate usage exactly once', async () => {
    const session = await fixture.register('usage-duplicate');
    const customer = await fixture.customer(session, `duplicate-${Date.now()}`);
    const sequentialId = `seq-${Date.now()}`;
    const first = await fixture.usage(session, customer.id, 35, sequentialId).expect(201);
    const second = await fixture.usage(session, customer.id, 35, sequentialId).expect(201);
    expect(first.body.duplicate).toBe(false);
    expect(second.body.duplicate).toBe(true);
    const concurrentId = `concurrent-${Date.now()}`;
    const [a, b] = await Promise.all([
      fixture.usage(session, customer.id, 5, concurrentId),
      fixture.usage(session, customer.id, 5, concurrentId),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.body.duplicate, b.body.duplicate].sort()).toEqual([false, true]);
    expect(
      await fixture.dataSource.manager.countBy(AiUsageEventEntity, {
        organizationId: session.organizationId,
        externalRequestId: concurrentId,
      }),
    ).toBe(1);
    const margin = await request(fixture.server())
      .get(`/api/v1/customers/${customer.id}/margin`)
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(margin.body.aiCost).toBe(40);
  });

  it('aggregates concurrent distinct usage without lost updates or stale snapshot', async () => {
    const session = await fixture.register('usage-distinct');
    const customer = await fixture.customer(session, `distinct-${Date.now()}`);
    const responses = await Promise.all(
      [10, 15, 20].map((cost, index) =>
        fixture.usage(session, customer.id, cost, `distinct-${Date.now()}-${index}`),
      ),
    );
    expect(responses.every((x) => x.status === 201)).toBe(true);
    const margin = await request(fixture.server())
      .get(`/api/v1/customers/${customer.id}/margin`)
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(margin.body).toMatchObject({ aiCost: 45, grossProfit: 55, grossMargin: 55 });
    const snapshot = await fixture.dataSource.manager.findOneByOrFail(MarginSnapshotEntity, {
      organizationId: session.organizationId,
      customerId: customer.id,
    });
    expect(Number(snapshot.aiCost)).toBe(45);
    expect(Number(snapshot.grossMargin)).toBe(55);
  });

  it('recalculates policy across detail, dashboard, snapshot, and alert', async () => {
    const session = await fixture.register('policy');
    const customer = await fixture.customer(session, `policy-${Date.now()}`);
    await fixture.usage(session, customer.id, 25, `policy-${Date.now()}`).expect(201);
    await request(fixture.server())
      .put('/api/v1/settings/margin')
      .set('Authorization', fixture.auth(session.token))
      .send({ targetGrossMargin: 80 })
      .expect(200);
    const detail = await request(fixture.server())
      .get(`/api/v1/customers/${customer.id}/margin`)
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(detail.body).toMatchObject({ grossMargin: 75, targetGrossMargin: 80, status: 'atRisk' });
    const rows = await request(fixture.server())
      .get('/api/v1/dashboard/customers')
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(rows.body.find((x: { customerId: string }) => x.customerId === customer.id).status).toBe(
      'atRisk',
    );
    expect(
      await fixture.dataSource.manager.countBy(MarginAlertEntity, {
        organizationId: session.organizationId,
        customerId: customer.id,
        type: MarginAlertType.MarginBelowTarget,
        resolvedAt: IsNull(),
      }),
    ).toBe(1);
  });

  it('deduplicates, resolves, and reopens margin alerts; distinguishes no-revenue cost', async () => {
    const session = await fixture.register('alerts');
    const customer = await fixture.customer(session, `alerts-${Date.now()}`);
    await fixture.usage(session, customer.id, 35, `alert-a-${Date.now()}`).expect(201);
    await fixture.usage(session, customer.id, 1, `alert-b-${Date.now()}`).expect(201);
    expect(
      await fixture.dataSource.manager.countBy(MarginAlertEntity, {
        organizationId: session.organizationId,
        customerId: customer.id,
        resolvedAt: IsNull(),
      }),
    ).toBe(1);
    await request(fixture.server())
      .put(`/api/v1/customers/${customer.id}`)
      .set('Authorization', fixture.auth(session.token))
      .send({
        externalCustomerId: `alerts-${Date.now()}`,
        name: 'Recovered',
        monthlyRevenue: 200,
        currency: 'USD',
      })
      .expect(200);
    expect(
      await fixture.dataSource.manager.countBy(MarginAlertEntity, {
        organizationId: session.organizationId,
        customerId: customer.id,
        resolvedAt: IsNull(),
      }),
    ).toBe(0);
    await request(fixture.server())
      .put(`/api/v1/customers/${customer.id}`)
      .set('Authorization', fixture.auth(session.token))
      .send({
        externalCustomerId: `alerts-reopen-${Date.now()}`,
        name: 'Reopen',
        monthlyRevenue: 0,
        currency: 'USD',
      })
      .expect(200);
    const open = await fixture.dataSource.manager.findBy(MarginAlertEntity, {
      organizationId: session.organizationId,
      customerId: customer.id,
      resolvedAt: IsNull(),
    });
    expect(open).toHaveLength(1);
    expect(open[0]?.type).toBe(MarginAlertType.NoRevenueWithCost);
  });

  it('aggregates dashboard totals and keeps AtRisk separate from Critical and NoRevenue', async () => {
    const session = await fixture.register('dashboard');
    const [a, b, c, noRevenue] = await Promise.all([
      fixture.customer(session, `dash-a-${Date.now()}`, 99),
      fixture.customer(session, `dash-b-${Date.now()}`, 99),
      fixture.customer(session, `dash-c-${Date.now()}`, 49),
      fixture.customer(session, `dash-zero-${Date.now()}`, 0),
    ]);
    await fixture.usage(session, a.id, 10, `dash-a-${Date.now()}`).expect(201);
    await fixture.usage(session, b.id, 40, `dash-b-${Date.now()}`).expect(201);
    await fixture.usage(session, c.id, 115, `dash-c-${Date.now()}`).expect(201);
    const overview = await request(fixture.server())
      .get('/api/v1/dashboard/overview')
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(overview.body).toMatchObject({
      monthlyRevenue: 247,
      aiCost: 165,
      grossProfit: 82,
      customersAtRisk: 1,
      criticalCustomers: 1,
      noRevenueCustomers: 1,
    });
    expect(overview.body.grossMargin).toBeCloseTo((82 / 247) * 100, 10);
    expect(noRevenue.id).toEqual(expect.any(String));
  });

  it('returns only 25 recent usage events in descending order', async () => {
    const session = await fixture.register('recent');
    const customer = await fixture.customer(session, `recent-${Date.now()}`);
    for (let i = 0; i < 30; i += 1)
      await fixture.usage(session, customer.id, 0, `recent-${Date.now()}-${i}`).expect(201);
    const detail = await request(fixture.server())
      .get(`/api/v1/customers/${customer.id}/margin`)
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(detail.body.recentUsage).toHaveLength(25);
    const dates = detail.body.recentUsage.map((x: { occurredAt: string }) =>
      Date.parse(x.occurredAt),
    );
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it('has database-level uniqueness and tenant-safe foreign-key protection', async () => {
    const indexes = await fixture.dataSource.query<Array<{ indexdef: string }>>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexdef ILIKE '%UNIQUE%'`,
    );
    const definitions = indexes.map((x) => x.indexdef).join('\n');
    for (const required of [
      '("Email")',
      '("OrganizationId", "ExternalCustomerId")',
      '("OrganizationId", "ExternalRequestId")',
      '("OrganizationId", "StripeCustomerId")',
      '("StripeConnectionId", "StripeEventId")',
      '("OrganizationId", "Provider", "ExternalSubscriptionId")',
    ])
      expect(definitions).toContain(required);
    expect(definitions).toContain('WHERE ("ResolvedAt" IS NULL)');
    const constraints = await fixture.dataSource.query<Array<{ definition: string }>>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`,
    );
    const foreignKeys = constraints.map((x) => x.definition).join('\n');
    expect(foreignKeys).toContain('FOREIGN KEY ("CustomerId", "OrganizationId")');
    expect(foreignKeys).toContain('FOREIGN KEY ("StripeConnectionId", "OrganizationId")');
  });
});
