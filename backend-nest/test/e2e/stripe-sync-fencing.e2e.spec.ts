import { StripeConnectionStatus } from '../../src/common/enums/domain.enums';
import { CustomerEntity, StripeConnectionEntity } from '../../src/database/entities';
import { StripeAccountState } from '../../src/modules/billing/stripe/interfaces/stripe-gateway.interface';
import { TestApp } from '../support/test-app';

describe('Stripe full-sync attempt fencing (PostgreSQL)', () => {
  const fixture = new TestApp();

  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());
  beforeEach(() => {
    fixture.stripe.state = emptyState();
    fixture.stripe.fetchCalls = 0;
    fixture.stripe.fetchDelayMs = 0;
    fixture.stripe.fetchError = null;
    fixture.stripe.fetchPlans = [];
  });

  it('allows a normal active attempt to apply successfully', async () => {
    const session = await fixture.register('stripe-fence-normal');
    await fixture.connect(session).expect(201);
    fixture.stripe.state = stateWithRevenue('cus_fence_normal', '99');

    await fixture.sync(session).expect(201);

    const connection = await connectionFor(session.organizationId);
    const customer = await customerFor(session.organizationId, 'cus_fence_normal');
    expect(connection.status).toBe(StripeConnectionStatus.Connected);
    expect(connection.activeSyncAttemptToken).toBeNull();
    expect(Number(customer.monthlyRevenue)).toBe(99);
  });

  it('replaces a stale attempt and prevents the old attempt from applying', async () => {
    const session = await fixture.register('stripe-fence-apply');
    await fixture.connect(session).expect(201);
    fixture.stripe.fetchPlans = [
      { state: stateWithRevenue('cus_fence_apply', '99'), delayMs: 250 },
      { state: stateWithRevenue('cus_fence_apply', '149') },
    ];

    const oldAttempt = fixture.sync(session).then((response) => response);
    await waitForFetch(1);
    const firstToken = (await connectionFor(session.organizationId)).activeSyncAttemptToken;
    await makeClaimStale(session.organizationId);

    await fixture.sync(session).expect(201);
    const oldResponse = await oldAttempt;

    expect(firstToken).not.toBeNull();
    expect(oldResponse.status).toBe(409);
    const connection = await connectionFor(session.organizationId);
    const customer = await customerFor(session.organizationId, 'cus_fence_apply');
    expect(connection.status).toBe(StripeConnectionStatus.Connected);
    expect(connection.activeSyncAttemptToken).toBeNull();
    expect(Number(customer.monthlyRevenue)).toBe(149);
  });

  it('stores a new active token when a stale attempt is replaced', async () => {
    const session = await fixture.register('stripe-fence-replace');
    await fixture.connect(session).expect(201);
    fixture.stripe.fetchPlans = [
      { state: stateWithRevenue('cus_fence_replace', '99'), delayMs: 300 },
      { state: stateWithRevenue('cus_fence_replace', '149'), delayMs: 100 },
    ];

    const oldAttempt = fixture.sync(session).then((response) => response);
    await waitForFetch(1);
    const firstToken = (await connectionFor(session.organizationId)).activeSyncAttemptToken;
    await makeClaimStale(session.organizationId);

    const replacement = fixture.sync(session).then((response) => response);
    await waitForFetch(2);
    const replacementConnection = await connectionFor(session.organizationId);

    expect(firstToken).not.toBeNull();
    expect(replacementConnection.status).toBe(StripeConnectionStatus.Syncing);
    expect(replacementConnection.activeSyncAttemptToken).not.toBe(firstToken);
    expect((await replacement).status).toBe(201);
    expect((await oldAttempt).status).toBe(409);
  });

  it('prevents an old failed attempt from overwriting a newer successful sync', async () => {
    const session = await fixture.register('stripe-fence-failure');
    await fixture.connect(session).expect(201);
    fixture.stripe.fetchPlans = [
      { error: new Error('old attempt failed'), delayMs: 250 },
      { state: stateWithRevenue('cus_fence_failure', '199') },
    ];

    const oldAttempt = fixture.sync(session).then((response) => response);
    await waitForFetch(1);
    await makeClaimStale(session.organizationId);

    await fixture.sync(session).expect(201);
    const oldResponse = await oldAttempt;

    expect(oldResponse.status).toBe(502);
    const connection = await connectionFor(session.organizationId);
    const customer = await customerFor(session.organizationId, 'cus_fence_failure');
    expect(connection.status).toBe(StripeConnectionStatus.Connected);
    expect(connection.activeSyncAttemptToken).toBeNull();
    expect(connection.lastError).toBeNull();
    expect(Number(customer.monthlyRevenue)).toBe(199);
  });

  function emptyState(): StripeAccountState {
    return {
      account: { accountId: 'acct_nest_test', liveMode: false },
      customers: [],
      subscriptions: [],
    };
  }

  function stateWithRevenue(customerId: string, revenue: string): StripeAccountState {
    return {
      account: { accountId: 'acct_nest_test', liveMode: false },
      customers: [{ id: customerId, name: customerId, email: null, deleted: false }],
      subscriptions: [fixture.subscription(`sub_${customerId}`, customerId, revenue)],
    };
  }

  function connectionFor(organizationId: string) {
    return fixture.dataSource.manager.findOneByOrFail(StripeConnectionEntity, { organizationId });
  }

  function customerFor(organizationId: string, stripeCustomerId: string) {
    return fixture.dataSource.manager.findOneByOrFail(CustomerEntity, {
      organizationId,
      stripeCustomerId,
    });
  }

  async function makeClaimStale(organizationId: string) {
    await fixture.dataSource.manager.update(
      StripeConnectionEntity,
      { organizationId },
      { lastSyncAt: new Date(Date.now() - 301_000) },
    );
  }

  async function waitForFetch(expected: number) {
    const deadline = Date.now() + 2_000;
    while (fixture.stripe.fetchCalls < expected && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(fixture.stripe.fetchCalls).toBeGreaterThanOrEqual(expected);
  }
});
