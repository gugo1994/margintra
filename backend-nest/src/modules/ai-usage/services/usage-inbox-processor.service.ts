import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryFailedError } from 'typeorm';
import { AiCostSource, InboxProcessingStatus } from '../../../common/enums/domain.enums';
import { UsageIngestionInboxEntity } from '../../../database/entities';
import { CustomerRepository } from '../../customers/repositories/customer.repository';
import { MarginService } from '../../margin/services/margin.service';
import { MetricsService } from '../../operations/metrics.service';
import { AiPricingService } from '../pricing/ai-pricing.service';
import { PricingRefreshRequestService } from '../pricing/pricing-refresh-request.service';
import { IngestionInboxRepository } from '../repositories/ingestion-inbox.repository';
import { UsageRepository } from '../repositories/usage.repository';

export type InboxProcessingOutcome = 'processed' | 'pending_pricing' | 'failed';

@Injectable()
export class UsageInboxProcessorService {
  private readonly logger = new Logger(UsageInboxProcessorService.name);

  constructor(
    private readonly inbox: IngestionInboxRepository,
    private readonly usage: UsageRepository,
    private readonly customers: CustomerRepository,
    private readonly pricing: AiPricingService,
    private readonly pricingRefreshRequests: PricingRefreshRequestService,
    private readonly margins: MarginService,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  async process(id: string): Promise<InboxProcessingOutcome> {
    let discovery: { provider: UsageIngestionInboxEntity['provider']; model: string } | null = null;
    try {
      const outcome = await this.inbox.transaction(async (manager) => {
        const row = await manager.findOne(UsageIngestionInboxEntity, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!row || row.processingStatus === InboxProcessingStatus.Processed)
          return 'processed' as const;
        if (row.processingStatus !== InboxProcessingStatus.Processing) return 'failed' as const;

        const customer = await this.customers.resolveIngestionCustomer(
          row.organizationId,
          row.customerExternalId,
          manager,
        );
        if (!customer) {
          await this.fail(
            row,
            'customer_not_found',
            'Customer could not be resolved.',
            false,
            manager,
          );
          return 'failed' as const;
        }

        const priced =
          row.explicitCost === null
            ? await this.pricing.calculate(
                {
                  provider: row.provider,
                  model: row.model,
                  inputTokens: Number(row.inputTokens),
                  outputTokens: Number(row.outputTokens),
                },
                row.occurredAt,
                manager,
              )
            : {
                cost: row.explicitCost,
                currency: row.explicitCostCurrency!,
                pricingVersion: null,
                pricingModel: null,
                pricingId: null,
              };
        if (!priced) {
          row.processingStatus = InboxProcessingStatus.PendingPricing;
          row.claimedAt = null;
          row.nextAttemptAt = null;
          row.lastErrorCode = 'pricing_unavailable';
          row.lastErrorMessage = 'No verified pricing was effective at the usage timestamp.';
          row.updatedAt = new Date();
          await manager.save(row);
          discovery = { provider: row.provider, model: row.model };
          return 'pending_pricing' as const;
        }

        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `C${row.organizationId}${customer.id}`,
        ]);
        let event = await this.usage.find(row.organizationId, row.externalRequestId, manager);
        if (!event) {
          event = this.usage.create(
            {
              organizationId: row.organizationId,
              customerId: customer.id,
              provider: row.provider,
              model: row.model,
              feature: row.feature,
              inputTokens: row.inputTokens,
              outputTokens: row.outputTokens,
              cost: priced.cost,
              currency: priced.currency,
              costSource:
                row.explicitCost === null ? AiCostSource.Calculated : AiCostSource.Explicit,
              pricingVersion: priced.pricingVersion,
              pricingModel: priced.pricingModel,
              pricingId: priced.pricingId,
              metadata: row.metadata,
              externalRequestId: row.externalRequestId,
              occurredAt: row.occurredAt,
              createdAt: new Date(),
            },
            manager,
          );
          await this.usage.save(event, manager);
        }
        await this.margins.recalculate(row.organizationId, customer.id, manager);
        const now = new Date();
        row.processingStatus = InboxProcessingStatus.Processed;
        row.processedAt = now;
        row.usageEventId = event.id;
        row.claimedAt = null;
        row.nextAttemptAt = null;
        row.lastErrorCode = null;
        row.lastErrorMessage = null;
        row.updatedAt = now;
        await manager.save(row);
        return 'processed' as const;
      });
      if (outcome === 'processed') this.metrics.usageInbox('processed');
      if (outcome === 'pending_pricing') this.metrics.usageInbox('pending_pricing');
      const discoveryRequest = discovery as {
        provider: UsageIngestionInboxEntity['provider'];
        model: string;
      } | null;
      if (discoveryRequest) {
        await this.pricingRefreshRequests
          .request(discoveryRequest.provider, discoveryRequest.model)
          .catch((error: unknown) => {
            this.logger.warn({
              event: 'PricingRefreshRequestFailed',
              provider: discoveryRequest.provider,
              model: discoveryRequest.model,
              errorType: error instanceof Error ? error.name : 'unknown',
            });
          });
      }
      return outcome;
    } catch (error) {
      const retryable = error instanceof QueryFailedError || !(error instanceof TypeError);
      await this.recordFailure(id, retryable, error);
      return 'failed';
    }
  }

  private async recordFailure(id: string, retryable: boolean, error: unknown) {
    try {
      await this.inbox.transaction(async (manager) => {
        const row = await manager.findOne(UsageIngestionInboxEntity, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!row || row.processingStatus === InboxProcessingStatus.Processed) return;
        await this.fail(
          row,
          error instanceof QueryFailedError ? 'database' : 'processing_failure',
          'Usage processing failed.',
          retryable,
          manager,
        );
      });
    } catch (stateError) {
      this.logger.error({
        event: 'UsageInboxFailureStateUpdateFailed',
        inboxEventId: id,
        errorType: stateError instanceof Error ? stateError.name : 'unknown',
      });
    }
    this.metrics.usageInbox(retryable ? 'retry' : 'failed');
    this.logger.error({
      event: 'UsageInboxProcessingFailed',
      inboxEventId: id,
      errorType: error instanceof Error ? error.name : 'unknown',
      retryable,
    });
  }

  private async fail(
    row: UsageIngestionInboxEntity,
    code: string,
    message: string,
    retryable: boolean,
    manager: import('typeorm').EntityManager,
  ) {
    const maxAttempts = this.config.get<number>('app.ingestionWorkerMaxAttempts') ?? 5;
    const initial = this.config.get<number>('app.ingestionWorkerInitialBackoffMs') ?? 1_000;
    const maximum = this.config.get<number>('app.ingestionWorkerMaxBackoffMs') ?? 60_000;
    const canRetry = retryable && row.attemptCount < maxAttempts;
    const delay = Math.min(maximum, initial * 2 ** Math.max(0, row.attemptCount - 1));
    row.processingStatus = InboxProcessingStatus.Failed;
    row.claimedAt = null;
    row.nextAttemptAt = canRetry ? new Date(Date.now() + delay) : null;
    row.lastErrorCode = code;
    row.lastErrorMessage = message.slice(0, 300);
    row.updatedAt = new Date();
    await manager.save(row);
  }
}
