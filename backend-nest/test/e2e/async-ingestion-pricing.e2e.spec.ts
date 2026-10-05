import request from 'supertest';
import {
  AiCostSource,
  AiProvider,
  InboxProcessingStatus,
  PricingSourceType,
} from '../../src/common/enums/domain.enums';
import {
  AiModelPricingEntity,
  AiUsageEventEntity,
  NotificationDeliveryEntity,
  NotificationPreferenceEntity,
  UsageIngestionInboxEntity,
} from '../../src/database/entities';
import { AuthSession, TestApp } from '../support/test-app';

describe('durable asynchronous ingestion and pricing catalog', () => {
  const fixture = new TestApp();
  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());

  const createKey = async (session: AuthSession) =>
    (
      await request(fixture.server())
        .post('/api/v1/integrations/usage-api-keys')
        .set('Authorization', fixture.auth(session.token))
        .send({ name: 'Async ingestion test' })
        .expect(201)
    ).body as { secret: string };

  const payload = (
    customerId: string,
    externalRequestId: string,
    extra: Record<string, unknown> = {},
  ) => ({
    externalRequestId,
    customerId,
    provider: 'openai',
    model: 'gpt-5',
    feature: 'support-chat',
    usage: { inputTokens: 1_200, outputTokens: 350 },
    occurredAt: new Date().toISOString(),
    metadata: { safe: true },
    ...extra,
  });

  const ingest = (key: string, body: object) =>
    request(fixture.server()).post('/api/v1/ingest/usage').set('X-Margintra-Key', key).send(body);

  const processUntilSettled = async (organizationId: string, externalRequestId: string) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await fixture.usageInbox.processBatch();
      const row = await fixture.dataSource.manager.findOneByOrFail(UsageIngestionInboxEntity, {
        organizationId,
        externalRequestId,
      });
      if (
        row.processingStatus !== InboxProcessingStatus.Pending &&
        row.processingStatus !== InboxProcessingStatus.Processing
      )
        return row;
    }
    throw new Error('Focused inbox event did not settle.');
  };

  it('commits the immutable inbox before 202 and enforces tenant idempotency', async () => {
    const first = await fixture.register('async-inbox-a');
    const second = await fixture.register('async-inbox-b');
    await fixture.customer(first, 'shared-native-id');
    await fixture.customer(second, 'shared-native-id');
    const firstKey = await createKey(first);
    const secondKey = await createKey(second);
    const requestId = `durable-${Date.now()}`;
    const body = payload('shared-native-id', requestId);
    const processor = jest.spyOn(fixture.usageInboxProcessor, 'process');

    await request(fixture.server())
      .post('/api/v1/ingest/usage')
      .set('X-MarginOS-Key', firstKey.secret)
      .send(body)
      .expect(401);

    const accepted = await ingest(firstKey.secret, body).expect(202);
    expect(accepted.body).toEqual({
      accepted: true,
      duplicate: false,
      eventId: expect.any(String),
      processingStatus: InboxProcessingStatus.Pending,
    });
    expect(accepted.body).not.toHaveProperty('cost');
    expect(accepted.body).not.toHaveProperty('currency');
    expect(accepted.body).not.toHaveProperty('costSource');
    expect(accepted.body).not.toHaveProperty('pricingVersion');
    expect(processor).not.toHaveBeenCalled();
    expect(
      await fixture.dataSource.manager.countBy(UsageIngestionInboxEntity, {
        organizationId: first.organizationId,
        externalRequestId: requestId,
      }),
    ).toBe(1);
    expect(
      await fixture.dataSource.manager.countBy(AiUsageEventEntity, {
        organizationId: first.organizationId,
        externalRequestId: requestId,
      }),
    ).toBe(0);
    await expect(
      fixture.dataSource.query('UPDATE usage_ingestion_inbox SET "Model"=$1 WHERE "Id"=$2', [
        'mutated-model',
        accepted.body.eventId,
      ]),
    ).rejects.toThrow('immutable');

    const replay = await ingest(firstKey.secret, {
      ...body,
      occurredAt: new Date(Date.now() - 1_000).toISOString(),
    }).expect(202);
    expect(replay.body).toEqual({
      accepted: true,
      duplicate: true,
      eventId: accepted.body.eventId,
      processingStatus: InboxProcessingStatus.Pending,
    });
    expect(processor).not.toHaveBeenCalled();
    await ingest(firstKey.secret, {
      ...body,
      usage: { inputTokens: 9_999, outputTokens: 1 },
    }).expect(409);
    await ingest(secondKey.secret, body).expect(202);
    expect(
      await fixture.dataSource.manager.countBy(UsageIngestionInboxEntity, {
        externalRequestId: requestId,
      }),
    ).toBe(2);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await fixture.usageInbox.processBatch();
      const row = await fixture.dataSource.manager.findOneByOrFail(UsageIngestionInboxEntity, {
        organizationId: first.organizationId,
        externalRequestId: requestId,
      });
      if (row.processingStatus === InboxProcessingStatus.Processed) break;
    }
    expect(processor).toHaveBeenCalled();
    expect(
      await fixture.dataSource.manager.countBy(AiUsageEventEntity, {
        organizationId: first.organizationId,
        externalRequestId: requestId,
      }),
    ).toBe(1);
    processor.mockRestore();
  });

  it('processes a pending event once and uses event-time catalog provenance', async () => {
    const session = await fixture.register('async-worker');
    const customer = await fixture.customer(session, 'worker-customer', 100);
    const key = await createKey(session);
    const requestId = `worker-${Date.now()}`;
    await ingest(key.secret, payload('worker-customer', requestId)).expect(202);

    await Promise.all([fixture.usageInbox.processBatch(), fixture.usageInbox.processBatch()]);
    const inbox = await fixture.dataSource.manager.findOneByOrFail(UsageIngestionInboxEntity, {
      organizationId: session.organizationId,
      externalRequestId: requestId,
    });
    expect(inbox.processingStatus).toBe(InboxProcessingStatus.Processed);
    const usage = await fixture.dataSource.manager.findOneByOrFail(AiUsageEventEntity, {
      organizationId: session.organizationId,
      externalRequestId: requestId,
    });
    expect(usage).toMatchObject({
      customerId: customer.id,
      cost: '0.005000',
      costSource: AiCostSource.Calculated,
      pricingVersion: 'openai-gpt5-2025-08-07',
    });
    expect(usage.pricingId).toBeTruthy();
    expect(
      await fixture.dataSource.manager.countBy(AiUsageEventEntity, {
        organizationId: session.organizationId,
        externalRequestId: requestId,
      }),
    ).toBe(1);
  });

  it('recovers a stale claim without double-applying cost', async () => {
    const session = await fixture.register('stale-worker');
    const customer = await fixture.customer(session, 'stale-customer', 100);
    const key = await createKey(session);
    const requestId = `stale-${Date.now()}`;
    await ingest(
      key.secret,
      payload('stale-customer', requestId, {
        cost: '2.500000',
        currency: 'USD',
      }),
    ).expect(202);
    await fixture.dataSource.query(
      `UPDATE usage_ingestion_inbox SET "ProcessingStatus"='processing',"AttemptCount"=1,
       "ClaimedAt"=now()-interval '10 minutes' WHERE "OrganizationId"=$1 AND "ExternalRequestId"=$2`,
      [session.organizationId, requestId],
    );
    await processUntilSettled(session.organizationId, requestId);
    await processUntilSettled(session.organizationId, requestId);
    const margin = await fixture.margins.get(session.organizationId, customer.id);
    expect(margin.aiCost).toBe(2.5);
    expect(
      await fixture.dataSource.manager.countBy(AiUsageEventEntity, {
        organizationId: session.organizationId,
        externalRequestId: requestId,
      }),
    ).toBe(1);
  });

  it('keeps an unknown model pending without financial effects, then reprocesses after pricing activation', async () => {
    const session = await fixture.register('pending-pricing');
    const customer = await fixture.customer(session, 'new-model-customer', 100);
    const key = await createKey(session);
    const model = `future-model-${Date.now()}`;
    const requestId = `unknown-${Date.now()}`;
    const occurredAt = new Date();
    await ingest(
      key.secret,
      payload('new-model-customer', requestId, {
        model,
        occurredAt: occurredAt.toISOString(),
      }),
    ).expect(202);
    await processUntilSettled(session.organizationId, requestId);
    let inbox = await fixture.dataSource.manager.findOneByOrFail(UsageIngestionInboxEntity, {
      organizationId: session.organizationId,
      externalRequestId: requestId,
    });
    expect(inbox.processingStatus).toBe(InboxProcessingStatus.PendingPricing);
    expect((await fixture.margins.get(session.organizationId, customer.id)).aiCost).toBe(0);

    await fixture.pricingCatalog.applyCandidate({
      provider: AiProvider.OpenAI,
      model,
      inputPricePerMillion: '2.00000000',
      outputPricePerMillion: '4.00000000',
      currency: 'USD',
      effectiveFrom: new Date(occurredAt.getTime() - 1_000),
      version: `${model}-v1`,
      sourceType: PricingSourceType.VerifiedManual,
      sourceReference: 'focused-test',
      trusted: true,
    });
    inbox = await fixture.dataSource.manager.findOneByOrFail(UsageIngestionInboxEntity, {
      organizationId: session.organizationId,
      externalRequestId: requestId,
    });
    expect(inbox.processingStatus).toBe(InboxProcessingStatus.Pending);
    await fixture.pricingCatalog.applyCandidate({
      provider: AiProvider.OpenAI,
      model,
      inputPricePerMillion: '20.00000000',
      outputPricePerMillion: '40.00000000',
      currency: 'USD',
      effectiveFrom: new Date(occurredAt.getTime() + 1),
      version: `${model}-v2`,
      sourceType: PricingSourceType.VerifiedManual,
      sourceReference: 'focused-test',
      trusted: true,
    });
    await processUntilSettled(session.organizationId, requestId);
    expect((await fixture.margins.get(session.organizationId, customer.id)).aiCost).toBe(0.0038);
    expect(
      await fixture.dataSource.manager.countBy(AiUsageEventEntity, {
        organizationId: session.organizationId,
        externalRequestId: requestId,
      }),
    ).toBe(1);
  });

  it('processes authoritative explicit cost without catalog pricing and never reprices it', async () => {
    const session = await fixture.register('explicit-async');
    await fixture.customer(session, 'explicit-async-customer');
    const key = await createKey(session);
    const model = `uncatalogued-${Date.now()}`;
    const requestId = `explicit-${Date.now()}`;
    await ingest(
      key.secret,
      payload('explicit-async-customer', requestId, {
        model,
        cost: '7.654321',
        currency: 'USD',
      }),
    ).expect(202);
    await processUntilSettled(session.organizationId, requestId);
    const usage = await fixture.dataSource.manager.findOneByOrFail(AiUsageEventEntity, {
      organizationId: session.organizationId,
      externalRequestId: requestId,
    });
    expect(usage).toMatchObject({
      cost: '7.654321',
      costSource: AiCostSource.Explicit,
      pricingId: null,
      pricingVersion: null,
    });
    await fixture.pricingCatalog.applyCandidate({
      provider: AiProvider.OpenAI,
      model,
      inputPricePerMillion: '999.00000000',
      outputPricePerMillion: '999.00000000',
      currency: 'USD',
      effectiveFrom: new Date(Date.now() - 1_000),
      version: `${model}-v1`,
      sourceType: PricingSourceType.VerifiedManual,
      sourceReference: 'focused-test',
      trusted: true,
    });
    const unchanged = await fixture.dataSource.manager.findOneByOrFail(AiUsageEventEntity, {
      id: usage.id,
    });
    expect(unchanged).toMatchObject({ cost: '7.654321', pricingId: null, pricingVersion: null });
  });

  it('rolls back canonical state on failure and retries without double-applying cost', async () => {
    const session = await fixture.register('atomic-retry');
    const customer = await fixture.customer(session, 'atomic-retry-customer');
    const key = await createKey(session);
    const requestId = `atomic-retry-${Date.now()}`;
    await ingest(
      key.secret,
      payload('atomic-retry-customer', requestId, {
        cost: '3.250000',
        currency: 'USD',
      }),
    ).expect(202);
    const failure = jest
      .spyOn(fixture.margins, 'recalculate')
      .mockRejectedValueOnce(new Error('simulated transient processing failure'));
    await processUntilSettled(session.organizationId, requestId);
    let inbox = await fixture.dataSource.manager.findOneByOrFail(UsageIngestionInboxEntity, {
      organizationId: session.organizationId,
      externalRequestId: requestId,
    });
    expect(inbox.processingStatus).toBe(InboxProcessingStatus.Failed);
    expect(inbox.nextAttemptAt).not.toBeNull();
    expect(
      await fixture.dataSource.manager.countBy(AiUsageEventEntity, {
        organizationId: session.organizationId,
        externalRequestId: requestId,
      }),
    ).toBe(0);
    failure.mockRestore();
    await fixture.dataSource.manager.update(
      UsageIngestionInboxEntity,
      { id: inbox.id },
      {
        processingStatus: InboxProcessingStatus.Pending,
        nextAttemptAt: new Date(),
      },
    );
    await processUntilSettled(session.organizationId, requestId);
    inbox = await fixture.dataSource.manager.findOneByOrFail(UsageIngestionInboxEntity, {
      id: inbox.id,
    });
    expect(inbox.processingStatus).toBe(InboxProcessingStatus.Processed);
    expect((await fixture.margins.get(session.organizationId, customer.id)).aiCost).toBe(3.25);
    expect(
      await fixture.dataSource.manager.countBy(AiUsageEventEntity, {
        organizationId: session.organizationId,
        externalRequestId: requestId,
      }),
    ).toBe(1);
  });

  it('versions changed pricing, verifies identical versions, and preserves historical event cost', async () => {
    const model = `versioned-${Date.now()}`;
    const base = {
      provider: AiProvider.OpenAI,
      model,
      inputPricePerMillion: '1.00000000',
      outputPricePerMillion: '2.00000000',
      currency: 'USD',
      effectiveFrom: new Date(Date.now() - 2_000),
      version: `${model}-v1`,
      sourceType: PricingSourceType.VerifiedManual,
      sourceReference: 'focused-test',
      trusted: true,
    };
    await fixture.pricingCatalog.applyCandidate(base);
    await fixture.pricingCatalog.applyCandidate(base);
    expect(
      await fixture.dataSource.manager.countBy(AiModelPricingEntity, {
        provider: AiProvider.OpenAI,
        model,
      }),
    ).toBe(1);
    await fixture.pricingCatalog.applyCandidate({
      ...base,
      version: `${model}-v2`,
      effectiveFrom: new Date(Date.now() - 500),
      inputPricePerMillion: '3.00000000',
      outputPricePerMillion: '4.00000000',
    });
    const versions = await fixture.dataSource.manager.find(AiModelPricingEntity, {
      where: { provider: AiProvider.OpenAI, model },
      order: { effectiveFrom: 'ASC' },
    });
    expect(versions).toHaveLength(2);
    expect(versions[0]!.effectiveTo?.getTime()).toBe(versions[1]!.effectiveFrom.getTime());
  });

  it('commits financial alert outbox rows atomically and duplicate processing does not duplicate delivery', async () => {
    const session = await fixture.register('usage-outbox');
    await fixture.customer(session, 'outbox-customer', 100);
    const key = await createKey(session);
    const preference = await fixture.dataSource.manager.findOneByOrFail(
      NotificationPreferenceEntity,
      {
        organizationId: session.organizationId,
      },
    );
    Object.assign(preference, {
      emailEnabled: true,
      warningAlertsEnabled: true,
      criticalAlertsEnabled: true,
      recoveryAlertsEnabled: true,
      recipients: ['sanitized@example.test'],
      updatedAt: new Date(),
    });
    await fixture.dataSource.manager.save(preference);
    const requestId = `outbox-${Date.now()}`;
    await ingest(
      key.secret,
      payload('outbox-customer', requestId, {
        cost: '100.000000',
        currency: 'USD',
      }),
    ).expect(202);
    const enqueueFailure = jest
      .spyOn(fixture.notifications, 'enqueue')
      .mockRejectedValueOnce(new Error('simulated outbox write failure'));
    await processUntilSettled(session.organizationId, requestId);
    let inbox = await fixture.dataSource.manager.findOneByOrFail(UsageIngestionInboxEntity, {
      organizationId: session.organizationId,
      externalRequestId: requestId,
    });
    expect(inbox.processingStatus).toBe(InboxProcessingStatus.Failed);
    expect(
      await fixture.dataSource.manager.countBy(AiUsageEventEntity, {
        organizationId: session.organizationId,
        externalRequestId: requestId,
      }),
    ).toBe(0);
    expect(
      await fixture.dataSource.manager.countBy(NotificationDeliveryEntity, {
        organizationId: session.organizationId,
      }),
    ).toBe(0);
    enqueueFailure.mockRestore();
    await fixture.dataSource.manager.update(
      UsageIngestionInboxEntity,
      { id: inbox.id },
      {
        processingStatus: InboxProcessingStatus.Pending,
        nextAttemptAt: new Date(),
      },
    );
    await processUntilSettled(session.organizationId, requestId);
    inbox = await fixture.dataSource.manager.findOneByOrFail(UsageIngestionInboxEntity, {
      id: inbox.id,
    });
    expect(inbox.processingStatus).toBe(InboxProcessingStatus.Processed);
    const count = await fixture.dataSource.manager.countBy(NotificationDeliveryEntity, {
      organizationId: session.organizationId,
    });
    expect(count).toBeGreaterThan(0);
    await processUntilSettled(session.organizationId, requestId);
    expect(
      await fixture.dataSource.manager.countBy(NotificationDeliveryEntity, {
        organizationId: session.organizationId,
      }),
    ).toBe(count);
  });
});
