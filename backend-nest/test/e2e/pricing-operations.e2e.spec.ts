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
  UsageIngestionInboxEntity,
} from '../../src/database/entities';
import { CreateVerifiedPricingCandidateDto } from '../../src/modules/ai-usage/pricing/pricing-operations.dto';
import { TestApp } from '../support/test-app';

describe('pricing catalog operational commands', () => {
  const fixture = new TestApp();
  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());

  const candidate = (
    model: string,
    effectiveFrom: Date,
    input = '1.25000000',
    output = '10.00000000',
  ): CreateVerifiedPricingCandidateDto => ({
    provider: AiProvider.OpenAI,
    model,
    canonicalModel: model,
    inputPricePerMillion: input,
    outputPricePerMillion: output,
    currency: 'USD',
    effectiveFrom: effectiveFrom.toISOString(),
    sourceType: PricingSourceType.VerifiedManual,
    sourceReference: 'pricing-review-2026-09',
    operatorSource: 'focused-test-operator',
  });

  it('deduplicates identical facts while changed and newly introduced models create pending versions', async () => {
    const model = `ops-dedupe-${Date.now()}`;
    const effectiveFrom = new Date(Date.now() - 60_000);
    const first = await fixture.pricingOperations.createVerifiedCandidate(
      candidate(model, effectiveFrom),
    );
    const identical = await fixture.pricingOperations.createVerifiedCandidate(
      candidate(model, effectiveFrom),
    );
    const changed = await fixture.pricingOperations.createVerifiedCandidate(
      candidate(model, effectiveFrom, '2.00000000', '12.00000000'),
    );
    const newModel = await fixture.pricingOperations.createVerifiedCandidate(
      candidate(`${model}-new`, effectiveFrom),
    );

    expect(first.created).toBe(true);
    expect(first.pricing.status).toBe(PricingStatus.Pending);
    expect(identical).toMatchObject({ created: false, pricing: { id: first.pricing.id } });
    expect(changed).toMatchObject({ created: true, pricing: { status: PricingStatus.Pending } });
    expect(newModel).toMatchObject({ created: true, pricing: { status: PricingStatus.Pending } });
    expect(
      await fixture.dataSource.manager.countBy(AiModelPricingEntity, {
        provider: AiProvider.OpenAI,
        model,
      }),
    ).toBe(2);
    expect(
      (await fixture.pricingOperations.list(PricingStatus.Pending)).some(
        (pricing) => pricing.id === changed.pricing.id,
      ),
    ).toBe(true);
  });

  it('rejects invalid overlap and closes the prior active range deterministically', async () => {
    const model = `ops-activation-${Date.now()}`;
    const firstFrom = new Date(Date.now() - 86_400_000);
    const first = await fixture.pricingOperations.createVerifiedCandidate(
      candidate(model, firstFrom),
    );
    await fixture.pricingOperations.activate(first.pricing.id, 'focused-test-operator');

    const invalid = await fixture.pricingOperations.createVerifiedCandidate(
      candidate(model, new Date(firstFrom.getTime() - 1_000), '2', '20'),
    );
    await expect(
      fixture.pricingOperations.activate(invalid.pricing.id, 'focused-test-operator'),
    ).rejects.toThrow('overlaps or predates');

    const secondFrom = new Date(Date.now() - 3_600_000);
    const second = await fixture.pricingOperations.createVerifiedCandidate(
      candidate(model, secondFrom, '2', '20'),
    );
    await fixture.pricingOperations.activate(second.pricing.id, 'focused-test-operator');
    const prior = await fixture.dataSource.manager.findOneByOrFail(AiModelPricingEntity, {
      id: first.pricing.id,
    });
    const active = await fixture.dataSource.manager.findOneByOrFail(AiModelPricingEntity, {
      id: second.pricing.id,
    });
    expect(prior.effectiveTo?.getTime()).toBe(secondFrom.getTime());
    expect(active).toMatchObject({
      status: PricingStatus.Active,
      operatorSource: 'focused-test-operator',
      activatedBy: 'focused-test-operator',
    });
    expect(active.activatedAt).not.toBeNull();

    const historical = await fixture.aiPricing.calculate(
      {
        provider: AiProvider.OpenAI,
        model,
        inputTokens: 1_000_000,
        outputTokens: 0,
      },
      new Date(firstFrom.getTime() + 1_000),
      fixture.dataSource.manager,
    );
    const current = await fixture.aiPricing.calculate(
      {
        provider: AiProvider.OpenAI,
        model,
        inputTokens: 1_000_000,
        outputTokens: 0,
      },
      new Date(secondFrom.getTime() + 1_000),
      fixture.dataSource.manager,
    );
    expect(historical?.cost).toBe('1.250000');
    expect(current?.cost).toBe('2.000000');
  });

  it('requeues only pending-pricing events covered by the activated version and does not process them inline', async () => {
    const session = await fixture.register('pricing-requeue');
    const model = `ops-requeue-${Date.now()}`;
    const effectiveFrom = new Date(Date.now() - 10_000);
    const created = await fixture.pricingOperations.createVerifiedCandidate(
      candidate(model, effectiveFrom),
    );
    const coveredId = randomUUID();
    const beforeId = randomUUID();
    const otherId = randomUUID();
    const now = new Date();
    const rows = [
      { id: coveredId, model, occurredAt: now },
      { id: beforeId, model, occurredAt: new Date(effectiveFrom.getTime() - 1) },
      { id: otherId, model: `${model}-other`, occurredAt: now },
    ].map((value, index) =>
      fixture.dataSource.manager.create(UsageIngestionInboxEntity, {
        ...value,
        organizationId: session.organizationId,
        externalRequestId: `pricing-requeue-${Date.now()}-${String(index)}`,
        customerExternalId: 'customer-not-resolved-during-activation',
        provider: AiProvider.OpenAI,
        feature: 'pricing-test',
        inputTokens: '1',
        outputTokens: '1',
        metadata: {},
        explicitCost: null,
        explicitCostCurrency: null,
        processingStatus: InboxProcessingStatus.PendingPricing,
        attemptCount: 1,
        nextAttemptAt: null,
        claimedAt: null,
        lastErrorCode: 'pricing_unavailable',
        lastErrorMessage: 'No verified pricing was effective at the usage timestamp.',
        processedAt: null,
        usageEventId: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await fixture.dataSource.manager.save(rows);

    await fixture.pricingOperations.activate(created.pricing.id, 'focused-test-operator');
    const covered = await fixture.dataSource.manager.findOneByOrFail(UsageIngestionInboxEntity, {
      id: coveredId,
    });
    const before = await fixture.dataSource.manager.findOneByOrFail(UsageIngestionInboxEntity, {
      id: beforeId,
    });
    const other = await fixture.dataSource.manager.findOneByOrFail(UsageIngestionInboxEntity, {
      id: otherId,
    });
    expect(covered.processingStatus).toBe(InboxProcessingStatus.Pending);
    expect(before.processingStatus).toBe(InboxProcessingStatus.PendingPricing);
    expect(other.processingStatus).toBe(InboxProcessingStatus.PendingPricing);
    expect(
      await fixture.dataSource.manager.countBy(AiUsageEventEntity, {
        organizationId: session.organizationId,
      }),
    ).toBe(0);
  });

  it('retirement prevents current resolution while preserving already-covered historical resolution', async () => {
    const model = `ops-retire-${Date.now()}`;
    const effectiveFrom = new Date(Date.now() - 60_000);
    const created = await fixture.pricingOperations.createVerifiedCandidate(
      candidate(model, effectiveFrom),
    );
    await fixture.pricingOperations.activate(created.pricing.id, 'focused-test-operator');
    const retired = await fixture.pricingOperations.retire(
      created.pricing.id,
      'focused-test-operator',
    );
    expect(retired.status).toBe(PricingStatus.Retired);
    expect(retired.retiredBy).toBe('focused-test-operator');
    expect(retired.retiredAt).not.toBeNull();
    expect(retired.effectiveTo).not.toBeNull();

    const overlapping = await fixture.pricingOperations.createVerifiedCandidate(
      candidate(model, new Date(effectiveFrom.getTime() + 10_000), '3', '30'),
    );
    await expect(
      fixture.pricingOperations.activate(overlapping.pricing.id, 'focused-test-operator'),
    ).rejects.toThrow('overlap');

    const historical = await fixture.aiPricing.calculate(
      {
        provider: AiProvider.OpenAI,
        model,
        inputTokens: 1_000_000,
        outputTokens: 0,
      },
      new Date(effectiveFrom.getTime() + 1),
      fixture.dataSource.manager,
    );
    const afterRetirement = await fixture.aiPricing.calculate(
      {
        provider: AiProvider.OpenAI,
        model,
        inputTokens: 1_000_000,
        outputTokens: 0,
      },
      new Date(retired.retiredAt!.getTime() + 1),
      fixture.dataSource.manager,
    );
    expect(historical?.cost).toBe('1.250000');
    expect(afterRetirement).toBeNull();
  });
});
