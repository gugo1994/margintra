import { AiUsageEventEntity, UsageEventProcessingEntity } from '../../src/database/entities';
import { UsageProcessingStatus } from '../../src/common/enums/domain.enums';
import { TestApp } from '../support/test-app';

describe('durable usage acceptance (PostgreSQL)', () => {
  const fixture = new TestApp();
  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());

  it('preserves immutable accepted facts and replay state when financial processing fails', async () => {
    const session = await fixture.register('durable-usage');
    const customer = await fixture.customer(session, `durable-${Date.now()}`, 100);
    const requestId = `durable-request-${Date.now()}`;
    const failure = jest
      .spyOn(fixture.margins, 'recalculate')
      .mockRejectedValueOnce(new Error('downstream failure'));
    const accepted = await fixture.usage(session, customer.id, 12.345678, requestId).expect(201);
    failure.mockRestore();
    expect(accepted.body).toMatchObject({
      duplicate: false,
      processingStatus: 'failed',
      margin: null,
    });

    const event = await fixture.dataSource.manager.findOneByOrFail(AiUsageEventEntity, {
      organizationId: session.organizationId,
      externalRequestId: requestId,
    });
    const immutableFacts = {
      organizationId: event.organizationId,
      customerId: event.customerId,
      provider: event.provider,
      model: event.model,
      feature: event.feature,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cost: event.cost,
      currency: event.currency,
      externalRequestId: event.externalRequestId,
      occurredAt: event.occurredAt.toISOString(),
    };
    const processing = await fixture.dataSource.manager.findOneByOrFail(
      UsageEventProcessingEntity,
      {
        organizationId: session.organizationId,
        usageEventId: event.id,
      },
    );
    expect(processing).toMatchObject({
      status: UsageProcessingStatus.Failed,
      failureCount: 1,
      lastFailureCategory: 'financial_processing',
      processedAt: null,
    });
    expect(processing.lastAttemptAt).toBeInstanceOf(Date);

    const duplicate = await fixture.usage(session, customer.id, 12.345678, requestId).expect(201);
    expect(duplicate.body).toMatchObject({ duplicate: true, processingStatus: 'failed' });
    expect(
      await fixture.dataSource.manager.countBy(AiUsageEventEntity, {
        organizationId: session.organizationId,
        externalRequestId: requestId,
      }),
    ).toBe(1);

    await expect(
      fixture.dataSource.manager.update(AiUsageEventEntity, { id: event.id }, { model: 'mutated' }),
    ).rejects.toThrow('Accepted usage event facts are immutable');
    const unchanged = await fixture.dataSource.manager.findOneByOrFail(AiUsageEventEntity, {
      id: event.id,
    });
    expect({
      organizationId: unchanged.organizationId,
      customerId: unchanged.customerId,
      provider: unchanged.provider,
      model: unchanged.model,
      feature: unchanged.feature,
      inputTokens: unchanged.inputTokens,
      outputTokens: unchanged.outputTokens,
      cost: unchanged.cost,
      currency: unchanged.currency,
      externalRequestId: unchanged.externalRequestId,
      occurredAt: unchanged.occurredAt.toISOString(),
    }).toEqual(immutableFacts);

    const replayable = await fixture.dataSource.manager.findBy(UsageEventProcessingEntity, {
      organizationId: session.organizationId,
      status: UsageProcessingStatus.Failed,
    });
    expect(replayable.map((state) => state.usageEventId)).toContain(event.id);
  });
});
