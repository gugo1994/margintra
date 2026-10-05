import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { WebhookProcessingStatus } from '../../../../common/enums/domain.enums';
import { StripeWebhookEventEntity } from '../../../../database/entities';
import { MetricsService } from '../../../operations/metrics.service';
import { StripeSyncInProgressError, StripeSyncService } from './stripe-sync.service';

interface ClaimedWebhook {
  id: string;
  organizationId: string;
}

export const STRIPE_WEBHOOK_RETRY = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  batchSize: 5,
  staleClaimMinutes: 5,
} as const;

@Injectable()
export class StripeWebhookRetryService implements OnModuleInit, OnModuleDestroy {
  private static readonly shutdownWaitMs = 10_000;
  private readonly logger = new Logger(StripeWebhookRetryService.name);
  private readonly active = new Set<Promise<number>>();
  private timer?: NodeJS.Timeout;
  private stopping = false;
  private ticking = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly sync: StripeSyncService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    const interval = this.config.getOrThrow<number>('app.stripeWebhookRetryIntervalMs');
    this.timer = setInterval(() => {
      this.tick();
    }, interval);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    if (this.active.size === 0) return;
    await Promise.race([
      Promise.allSettled([...this.active]),
      new Promise<void>((resolve) => setTimeout(resolve, StripeWebhookRetryService.shutdownWaitMs)),
    ]);
  }

  async schedule(id: string, organizationId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(StripeWebhookEventEntity, {
        where: { id, organizationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row || row.processingStatus === WebhookProcessingStatus.Processed) return;
      row.attemptCount += 1;
      row.processingStatus = WebhookProcessingStatus.Failed;
      row.claimedAt = null;
      if (row.attemptCount < STRIPE_WEBHOOK_RETRY.maxAttempts) {
        row.retryable = true;
        row.nextAttemptAt = new Date(
          Date.now() + STRIPE_WEBHOOK_RETRY.baseDelayMs * Math.pow(2, row.attemptCount - 1),
        );
        row.error = 'Stripe synchronization contention; retry scheduled.';
        this.metrics.stripeWebhookRetry('scheduled');
      } else {
        row.retryable = false;
        row.nextAttemptAt = null;
        row.error = 'Stripe synchronization contention retries exhausted.';
        this.metrics.stripeWebhookRetry('exhausted');
      }
      await manager.save(row);
    });
  }

  async failPermanently(id: string, organizationId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(StripeWebhookEventEntity, {
        where: { id, organizationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row || row.processingStatus === WebhookProcessingStatus.Processed) return;
      row.processingStatus = WebhookProcessingStatus.Failed;
      row.retryable = false;
      row.nextAttemptAt = null;
      row.claimedAt = null;
      row.error = 'Stripe synchronization failed; Stripe may retry the event.';
      await manager.save(row);
      this.metrics.stripeWebhookRetry('failure');
    });
  }

  processBatch(organizationId?: string): Promise<number> {
    if (this.stopping) return Promise.resolve(0);
    const work = this.executeBatch(organizationId).catch((error: unknown) => {
      this.logger.error({
        event: 'StripeWebhookRetryBatchFailed',
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      return 0;
    });
    this.active.add(work);
    void work.finally(() => this.active.delete(work));
    return work;
  }

  private tick(): void {
    if (this.stopping || this.ticking) return;
    this.ticking = true;
    void this.processBatch().finally(() => {
      this.ticking = false;
    });
  }

  private async executeBatch(organizationId?: string): Promise<number> {
    const claimed = await this.claimBatch(organizationId);
    for (const item of claimed) {
      try {
        await this.sync.sync(item.organizationId, item.id);
        this.metrics.stripeWebhookRetry('success');
      } catch (error) {
        if (error instanceof StripeSyncInProgressError)
          await this.schedule(item.id, item.organizationId);
        else await this.failPermanently(item.id, item.organizationId);
      }
    }
    return claimed.length;
  }

  private claimBatch(organizationId?: string): Promise<ClaimedWebhook[]> {
    return this.dataSource.transaction(async (manager) => {
      const params: unknown[] = [STRIPE_WEBHOOK_RETRY.maxAttempts, STRIPE_WEBHOOK_RETRY.batchSize];
      const tenantFilter = organizationId ? 'AND e."OrganizationId"=$3' : '';
      if (organizationId) params.push(organizationId);
      const rows = await manager.query<ClaimedWebhook[]>(
        `SELECT e."Id" AS id, e."OrganizationId" AS "organizationId"
         FROM "stripe_webhook_events" e
         WHERE e."Retryable"=true AND e."AttemptCount"<$1
           AND ((e."ProcessingStatus"='Failed' AND e."NextAttemptAt"<=now())
             OR (e."ProcessingStatus"='Processing'
               AND e."ClaimedAt"<now()-interval '${String(STRIPE_WEBHOOK_RETRY.staleClaimMinutes)} minutes'))
           ${tenantFilter}
         ORDER BY COALESCE(e."NextAttemptAt",e."ReceivedAt"),e."ReceivedAt"
         FOR UPDATE OF e SKIP LOCKED LIMIT $2`,
        params,
      );
      if (rows.length === 0) return [];
      await manager
        .createQueryBuilder()
        .update(StripeWebhookEventEntity)
        .set({
          processingStatus: WebhookProcessingStatus.Processing,
          claimedAt: new Date(),
        })
        .whereInIds(rows.map((row) => row.id))
        .execute();
      return rows;
    });
  }
}
