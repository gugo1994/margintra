import request from 'supertest';
import { TestApp, AuthSession } from '../support/test-app';

describe('organization onboarding (PostgreSQL)', () => {
  const fixture = new TestApp();
  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());

  const status = (session: AuthSession) =>
    request(fixture.server())
      .get('/api/v1/onboarding')
      .set('Authorization', fixture.auth(session.token));

  const createKey = (session: AuthSession) =>
    request(fixture.server())
      .post('/api/v1/integrations/usage-api-keys')
      .set('Authorization', fixture.auth(session.token))
      .send({ name: 'Production backend' });

  it('keeps new and configured organizations tenant-isolated', async () => {
    const configured = await fixture.register('onboarding-configured');
    const untouched = await fixture.register('onboarding-untouched');
    const initial = await status(untouched).expect(200);
    expect(initial.body).toMatchObject({
      onboardingStatus: 'not_started',
      requiresOnboarding: true,
      stripeConnected: false,
      ingestionKeyCreated: false,
      firstUsageReceived: false,
    });

    await fixture.connect(configured).expect(201);
    await createKey(configured).expect(201);
    const customer = await fixture.customer(configured, `onboarding-${Date.now()}`);
    await fixture.usage(configured, customer.id, 1, `onboarding-${Date.now()}`).expect(201);

    const existing = await status(configured).expect(200);
    expect(existing.body).toMatchObject({
      onboardingStatus: 'completed',
      requiresOnboarding: false,
      stripeConnected: true,
      ingestionKeyCreated: true,
      firstUsageReceived: true,
      customerCount: 1,
      usageEventCount: 1,
      completedAt: null,
    });
    await expect(status(untouched).expect(200)).resolves.toMatchObject({
      body: { onboardingStatus: 'not_started', customerCount: 0, usageEventCount: 0 },
    });
  });

  it('requires every derived step and persists explicit completion', async () => {
    const session = await fixture.register('onboarding-flow');
    await request(fixture.server())
      .post('/api/v1/onboarding/start')
      .set('Authorization', fixture.auth(session.token))
      .expect(201);
    await request(fixture.server())
      .post('/api/v1/onboarding/complete')
      .set('Authorization', fixture.auth(session.token))
      .expect(409);

    await fixture.connect(session).expect(201);
    await createKey(session).expect(201);
    const customer = await fixture.customer(session, `onboarding-flow-${Date.now()}`);
    await fixture.usage(session, customer.id, 1, `onboarding-flow-${Date.now()}`).expect(201);
    const ready = await status(session).expect(200);
    expect(ready.body).toMatchObject({ onboardingStatus: 'in_progress', requiresOnboarding: true });

    const completed = await request(fixture.server())
      .post('/api/v1/onboarding/complete')
      .set('Authorization', fixture.auth(session.token))
      .expect(201);
    expect(completed.body).toMatchObject({
      onboardingStatus: 'completed',
      requiresOnboarding: false,
    });
    expect(completed.body.completedAt).toEqual(expect.any(String));
  });
});
