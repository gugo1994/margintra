import request from 'supertest';
import { AiUsageEventEntity, UsageEventProcessingEntity } from '../../src/database/entities';
import { UsageProcessingStatus } from '../../src/common/enums/domain.enums';
import { PermanentUsageProcessingError } from '../../src/modules/ai-usage/services/usage-processing.service';
import { AuthSession, TestApp } from '../support/test-app';

describe('durable usage replay worker (PostgreSQL)', () => {
  const fixture = new TestApp();
  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());

  const failedUsage = async (
    session: AuthSession,
    customerId: string,
    requestId: string,
    cost = 7,
  ) => {
    const failure = jest
      .spyOn(fixture.margins, 'recalculate')
      .mockRejectedValueOnce(new Error('temporary'));
    await fixture.usage(session, customerId, cost, requestId).expect(201);
    failure.mockRestore();
    const event = await fixture.dataSource.manager.findOneByOrFail(AiUsageEventEntity, {
      organizationId: session.organizationId,
      externalRequestId: requestId,
    });
    await fixture.dataSource.manager.update(
      UsageEventProcessingEntity,
      { organizationId: session.organizationId, usageEventId: event.id },
      { nextRetryAt: new Date(0), retryable: true },
    );
    return event;
  };

  it('replays a failed event successfully without double-counting AI cost', async () => {
    const session = await fixture.register('usage-replay-success');
    const customer = await fixture.customer(session, `replay-success-${Date.now()}`, 100);
    const event = await failedUsage(session, customer.id, `replay-success-${Date.now()}`, 7.25);
    expect(await fixture.usageReplay.processBatch(session.organizationId)).toBe(1);
    const state = await fixture.dataSource.manager.findOneByOrFail(UsageEventProcessingEntity, {
      organizationId: session.organizationId,
      usageEventId: event.id,
    });
    expect(state).toMatchObject({
      status: UsageProcessingStatus.Processed,
      failureCount: 0,
      lastFailureCategory: null,
      nextRetryAt: null,
      claimedAt: null,
      retryable: false,
    });
    expect(state.processedAt).toBeInstanceOf(Date);
    const margin = await request(fixture.server())
      .get(`/api/v1/customers/${customer.id}/margin`)
      .set('Authorization', fixture.auth(session.token))
      .expect(200);
    expect(margin.body.aiCost).toBe(7.25);
    expect(await fixture.dataSource.manager.countBy(AiUsageEventEntity, { id: event.id })).toBe(1);
  });

  it('uses skip-locked claims so workers on concurrent replicas cannot process one event twice', async () => {
    const session = await fixture.register('usage-replay-lock');
    const customer = await fixture.customer(session, `replay-lock-${Date.now()}`, 100);
    await failedUsage(session, customer.id, `replay-lock-${Date.now()}`);
    const original = fixture.margins.recalculate.bind(fixture.margins);
    let calls = 0;
    const replay = jest
      .spyOn(fixture.margins, 'recalculate')
      .mockImplementation(async (...args) => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return original(...args);
      });
    const claimed = await Promise.all([
      fixture.usageReplay.processBatch(session.organizationId),
      fixture.usageReplay.processBatch(session.organizationId),
    ]);
    replay.mockRestore();
    expect(claimed.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(calls).toBe(1);
  });

  it('bounds exponential retry attempts at five failures', async () => {
    const session = await fixture.register('usage-replay-bound');
    const customer = await fixture.customer(session, `replay-bound-${Date.now()}`, 100);
    const event = await failedUsage(session, customer.id, `replay-bound-${Date.now()}`);
    await fixture.dataSource.manager.update(
      UsageEventProcessingEntity,
      { usageEventId: event.id },
      { failureCount: 4, nextRetryAt: new Date(0), retryable: true },
    );
    const failure = jest
      .spyOn(fixture.margins, 'recalculate')
      .mockRejectedValueOnce(new Error('still temporary'));
    expect(await fixture.usageReplay.processBatch(session.organizationId)).toBe(1);
    failure.mockRestore();
    const state = await fixture.dataSource.manager.findOneByOrFail(UsageEventProcessingEntity, {
      usageEventId: event.id,
    });
    expect(state).toMatchObject({
      status: UsageProcessingStatus.Failed,
      failureCount: 5,
      retryable: false,
      nextRetryAt: null,
    });
    expect(await fixture.usageReplay.processBatch(session.organizationId)).toBe(0);
  });

  it('marks permanent failures visible and never schedules them again', async () => {
    const session = await fixture.register('usage-replay-permanent');
    const customer = await fixture.customer(session, `replay-permanent-${Date.now()}`, 100);
    const event = await failedUsage(session, customer.id, `replay-permanent-${Date.now()}`);
    const permanent = jest
      .spyOn(fixture.margins, 'recalculate')
      .mockRejectedValueOnce(new PermanentUsageProcessingError('invalid_accepted_facts'));
    expect(await fixture.usageReplay.processBatch(session.organizationId)).toBe(1);
    permanent.mockRestore();
    const state = await fixture.dataSource.manager.findOneByOrFail(UsageEventProcessingEntity, {
      usageEventId: event.id,
    });
    expect(state).toMatchObject({
      status: UsageProcessingStatus.Failed,
      retryable: false,
      nextRetryAt: null,
      lastFailureCategory: 'invalid_accepted_facts',
    });
    expect(await fixture.usageReplay.processBatch(session.organizationId)).toBe(0);
  });

  it('stops claiming and waits for claimed work during graceful shutdown', async () => {
    const session = await fixture.register('usage-replay-shutdown');
    const customer = await fixture.customer(session, `replay-shutdown-${Date.now()}`, 100);
    const event = await failedUsage(session, customer.id, `replay-shutdown-${Date.now()}`);
    const original = fixture.margins.recalculate.bind(fixture.margins);
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayed = jest
      .spyOn(fixture.margins, 'recalculate')
      .mockImplementation(async (...args) => {
        started();
        await releasePromise;
        return original(...args);
      });
    const batch = fixture.usageReplay.processBatch(session.organizationId);
    await startedPromise;
    let stopped = false;
    const shutdown = fixture.usageReplay.onModuleDestroy().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await Promise.all([batch, shutdown]);
    delayed.mockRestore();
    expect(stopped).toBe(true);
    expect(await fixture.usageReplay.processBatch(session.organizationId)).toBe(0);
    const state = await fixture.dataSource.manager.findOneByOrFail(UsageEventProcessingEntity, {
      usageEventId: event.id,
    });
    expect(state.status).toBe(UsageProcessingStatus.Processed);
  });
});
