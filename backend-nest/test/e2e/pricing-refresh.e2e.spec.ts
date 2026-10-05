import { randomUUID } from 'node:crypto';
import {
  AiProvider,
  InboxProcessingStatus,
  PricingSourceType,
  PricingStatus,
} from '../../src/common/enums/domain.enums';
import {
  AiModelPricingEntity,
  AiUsageEventEntity,
  PricingRefreshRequestEntity,
  UsageIngestionInboxEntity,
} from '../../src/database/entities';
import { PricingCatalogCandidate } from '../../src/modules/ai-usage/pricing/provider-pricing.adapter';
import { TestApp } from '../support/test-app';

describe('pricing refresh orchestration', () => {
  const fixture = new TestApp();
  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());
  beforeEach(async () => {
    fixture.pricingAdapter.reset();
    await fixture.dataSource.manager.clear(PricingRefreshRequestEntity);
  });

  const candidate = (model: string, version: string, input = '1.25'): PricingCatalogCandidate => ({
    provider: AiProvider.OpenAI,
    model,
    pricingModel: model,
    inputPricePerMillion: input,
    outputPricePerMillion: '10',
    currency: 'usd',
    effectiveFrom: new Date('2026-09-01T00:00:00Z'),
    version,
    sourceType: PricingSourceType.Provider,
    sourceReference: 'provider-machine-readable-catalog',
    trusted: false,
  });

  it('fences concurrent replicas and safely treats unavailable automatic sources as a no-op', async () => {
    fixture.pricingAdapter.automaticSourceAvailable = true;
    fixture.pricingAdapter.delayMs = 100;
    const model = `refresh-lock-${Date.now()}`;
    fixture.pricingAdapter.candidates = [candidate(model, `${model}-v1`)];
    const [first, second] = await Promise.all([
      fixture.pricingRefresh.refresh(AiProvider.OpenAI, [model]),
      fixture.pricingRefresh.refresh(AiProvider.OpenAI, [model]),
    ]);
    expect([first.busy, second.busy].sort()).toEqual([false, true]);
    expect(fixture.pricingAdapter.calls).toHaveLength(1);

    fixture.pricingAdapter.reset();
    const unavailable = await fixture.pricingRefresh.refresh(AiProvider.OpenAI);
    expect(unavailable).toMatchObject({ unavailable: true, checked: 0, pendingCreated: 0 });
    expect(fixture.pricingAdapter.calls).toHaveLength(0);
  });

  it('deduplicates identical candidates while changed and new models become pending', async () => {
    fixture.pricingAdapter.automaticSourceAvailable = true;
    const model = `refresh-candidate-${Date.now()}`;
    const identical = candidate(model, `${model}-v1`);
    await fixture.pricingCatalog.applyCandidate(identical);
    fixture.pricingAdapter.candidates = [
      identical,
      candidate(model, `${model}-v2`, '2.5'),
      candidate(`${model}-new`, `${model}-new-v1`),
    ];
    const result = await fixture.pricingRefresh.refresh(AiProvider.OpenAI);
    expect(result).toMatchObject({ checked: 3, unchanged: 1, pendingCreated: 2 });
    expect(
      await fixture.dataSource.manager.countBy(AiModelPricingEntity, {
        provider: AiProvider.OpenAI,
        model,
        status: PricingStatus.Pending,
      }),
    ).toBe(2);
  });

  it('coalesces unknown-model signals durably and worker refresh never processes financial state', async () => {
    const model = `refresh-signal-${Date.now()}`;
    const session = await fixture.register('pricing-refresh');
    const externalCustomerId = `refresh-customer-${Date.now()}`;
    await fixture.customer(session, externalCustomerId);
    const makeInbox = (suffix: string) =>
      fixture.dataSource.manager.create(UsageIngestionInboxEntity, {
        id: randomUUID(),
        organizationId: session.organizationId,
        externalRequestId: `refresh-${suffix}-${Date.now()}`,
        customerExternalId: externalCustomerId,
        provider: AiProvider.OpenAI,
        model,
        feature: 'refresh-test',
        inputTokens: '10',
        outputTokens: '5',
        occurredAt: new Date('2026-09-02T00:00:00Z'),
        metadata: {},
        explicitCost: null,
        explicitCostCurrency: null,
        processingStatus: InboxProcessingStatus.Processing,
        attemptCount: 1,
        nextAttemptAt: null,
        claimedAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
        processedAt: null,
        usageEventId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    const saved = await fixture.dataSource.manager.save([makeInbox('one'), makeInbox('two')]);
    const inbox = saved[0]!;
    const secondInbox = saved[1]!;
    expect(await fixture.usageInboxProcessor.process(inbox.id)).toBe('pending_pricing');
    expect(await fixture.usageInboxProcessor.process(secondInbox.id)).toBe('pending_pricing');
    const durable = await fixture.dataSource.manager.findOneByOrFail(PricingRefreshRequestEntity, {
      provider: AiProvider.OpenAI,
    });
    expect(durable.requestedModels).toEqual([model]);

    fixture.pricingAdapter.automaticSourceAvailable = true;
    fixture.pricingAdapter.candidates = [candidate(model, `${model}-v1`)];
    expect(await fixture.pricingRefreshWorker.processOne()).toBe(1);
    const after = await fixture.dataSource.manager.findOneByOrFail(UsageIngestionInboxEntity, {
      id: inbox.id,
    });
    expect(after.processingStatus).toBe(InboxProcessingStatus.PendingPricing);
    expect(
      await fixture.dataSource.manager.countBy(AiUsageEventEntity, {
        organizationId: session.organizationId,
      }),
    ).toBe(0);
    const persistedSchedule = await fixture.dataSource.manager.findOneByOrFail(
      PricingRefreshRequestEntity,
      { provider: AiProvider.OpenAI },
    );
    expect(persistedSchedule.lastSuccessfulAt).not.toBeNull();
    expect(persistedSchedule.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });
});
