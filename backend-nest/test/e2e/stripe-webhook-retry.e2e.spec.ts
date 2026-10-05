import request from 'supertest';
import {
  StripeConnectionStatus,
  WebhookProcessingStatus,
} from '../../src/common/enums/domain.enums';
import { StripeConnectionEntity, StripeWebhookEventEntity } from '../../src/database/entities';
import { STRIPE_WEBHOOK_RETRY } from '../../src/modules/billing/stripe/services/stripe-webhook-retry.service';
import { TestApp } from '../support/test-app';

describe('Stripe webhook contention replay (PostgreSQL)', () => {
  const fixture = new TestApp();

  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());
  beforeEach(() => {
    fixture.stripe.fetchCalls = 0;
    fixture.stripe.fetchDelayMs = 0;
    fixture.stripe.fetchError = null;
    fixture.stripe.fetchPlans = [];
  });

  it('schedules the contending event when concurrent supported webhooks share a sync', async () => {
    const { events } = await createContendedPair('stripe-hook-contention');

    expect(
      events.filter((event) => event.processingStatus === WebhookProcessingStatus.Processed),
    ).toHaveLength(1);
    const scheduled = events.find(
      (event) => event.processingStatus === WebhookProcessingStatus.Failed,
    );
    expect(scheduled).toMatchObject({ retryable: true, attemptCount: 1 });
    expect(scheduled?.nextAttemptAt).toBeInstanceOf(Date);
  });

  it('persists a due retry instead of permanently losing the event', async () => {
    const { session, events } = await createContendedPair('stripe-hook-scheduled');
    const scheduled = events.find((event) => event.retryable);

    expect(scheduled?.organizationId).toBe(session.organizationId);
    expect(scheduled?.error).toBe('Stripe synchronization contention; retry scheduled.');
    expect(scheduled?.processedAt).toBeNull();
  });

  it('replays successfully after sync contention clears', async () => {
    const { session, events } = await createContendedPair('stripe-hook-replay');
    const scheduled = events.find((event) => event.retryable)!;
    await makeDue(scheduled.id);
    fixture.stripe.fetchCalls = 0;
    fixture.stripe.fetchDelayMs = 0;

    expect(await fixture.stripeWebhookRetry.processBatch(session.organizationId)).toBe(1);

    const replayed = await eventById(scheduled.id);
    expect(fixture.stripe.fetchCalls).toBe(1);
    expect(replayed.processingStatus).toBe(WebhookProcessingStatus.Processed);
    expect(replayed.retryable).toBe(false);
    expect(replayed.nextAttemptAt).toBeNull();
  });

  it('allows only one logical replica to claim the same retry', async () => {
    const { session, events } = await createContendedPair('stripe-hook-replicas');
    const scheduled = events.find((event) => event.retryable)!;
    await makeDue(scheduled.id);
    fixture.stripe.fetchCalls = 0;
    fixture.stripe.fetchDelayMs = 100;

    const results = await Promise.all([
      fixture.stripeWebhookRetry.processBatch(session.organizationId),
      fixture.stripeWebhookRetry.processBatch(session.organizationId),
    ]);

    expect(results.sort()).toEqual([0, 1]);
    expect(fixture.stripe.fetchCalls).toBe(1);
    expect((await eventById(scheduled.id)).processingStatus).toBe(
      WebhookProcessingStatus.Processed,
    );
  });

  it('does not retry permanent synchronization errors', async () => {
    const session = await fixture.register('stripe-hook-permanent');
    const connection = await fixture.connect(session, 'whsec_permanent').expect(201);
    fixture.stripe.fetchError = new Error('permanent boundary failure');

    await sendEvent(connection.body.webhookPath as string, 'whsec_permanent').expect(502);

    const event = await latestEvent(session.organizationId);
    expect(event.processingStatus).toBe(WebhookProcessingStatus.Failed);
    expect(event.retryable).toBe(false);
    expect(event.attemptCount).toBe(0);
    expect(event.nextAttemptAt).toBeNull();
  });

  it('leaves exhausted contention retries visible as failed', async () => {
    const { session, events } = await createContendedPair('stripe-hook-exhausted');
    const scheduled = events.find((event) => event.retryable)!;
    scheduled.attemptCount = STRIPE_WEBHOOK_RETRY.maxAttempts - 1;
    scheduled.nextAttemptAt = new Date(Date.now() - 1_000);
    await fixture.dataSource.manager.save(scheduled);
    await fixture.dataSource.manager.update(
      StripeConnectionEntity,
      { organizationId: session.organizationId },
      { status: StripeConnectionStatus.Syncing, lastSyncAt: new Date() },
    );

    expect(await fixture.stripeWebhookRetry.processBatch(session.organizationId)).toBe(1);

    const exhausted = await eventById(scheduled.id);
    expect(exhausted.processingStatus).toBe(WebhookProcessingStatus.Failed);
    expect(exhausted.retryable).toBe(false);
    expect(exhausted.attemptCount).toBe(STRIPE_WEBHOOK_RETRY.maxAttempts);
    expect(exhausted.nextAttemptAt).toBeNull();
    expect(exhausted.error).toContain('retries exhausted');
  });

  async function createContendedPair(prefix: string) {
    const session = await fixture.register(prefix);
    const secret = `whsec_${prefix}`;
    const connection = await fixture.connect(session, secret).expect(201);
    fixture.stripe.state = {
      account: { accountId: 'acct_nest_test', liveMode: false },
      customers: [],
      subscriptions: [],
    };
    fixture.stripe.fetchDelayMs = 150;
    const path = connection.body.webhookPath as string;
    const responses = await Promise.all([sendEvent(path, secret), sendEvent(path, secret)]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    return {
      session,
      events: await fixture.dataSource.manager.find(StripeWebhookEventEntity, {
        where: { organizationId: session.organizationId },
      }),
    };
  }

  function sendEvent(path: string, secret: string) {
    const payload = JSON.stringify({
      id: `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      object: 'event',
      type: 'customer.subscription.updated',
      data: { object: {} },
    });
    return request(fixture.server())
      .post(path)
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', fixture.signature(payload, secret))
      .send(payload);
  }

  function latestEvent(organizationId: string) {
    return fixture.dataSource.manager.findOneOrFail(StripeWebhookEventEntity, {
      where: { organizationId },
      order: { receivedAt: 'DESC' },
    });
  }

  function eventById(id: string) {
    return fixture.dataSource.manager.findOneByOrFail(StripeWebhookEventEntity, { id });
  }

  async function makeDue(id: string) {
    await fixture.dataSource.manager.update(
      StripeWebhookEventEntity,
      { id },
      { nextAttemptAt: new Date(Date.now() - 1_000) },
    );
  }
});
