import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { UsageProcessingStatus } from '../../../common/enums/domain.enums';
import { UsageEventProcessingEntity } from '../../../database/entities';
import { USAGE_PROCESSING_RETRY, UsageProcessingService } from './usage-processing.service';

interface ClaimedUsage {
  organizationId: string;
  usageEventId: string;
  customerId: string;
}
@Injectable()
export class UsageReplayWorkerService implements OnModuleInit, OnModuleDestroy {
  private static readonly batchSize = 10;
  private static readonly staleClaimMinutes = 5;
  private static readonly shutdownWaitMs = 10_000;
  private readonly logger = new Logger(UsageReplayWorkerService.name);
  private readonly active = new Set<Promise<number>>();
  private timer?: NodeJS.Timeout;
  private stopping = false;
  private ticking = false;
  constructor(
    private readonly dataSource: DataSource,
    private readonly processing: UsageProcessingService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const interval = this.config.getOrThrow<number>('app.usageReplayIntervalMs');
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
      new Promise<void>((resolve) => setTimeout(resolve, UsageReplayWorkerService.shutdownWaitMs)),
    ]);
  }
  processBatch(organizationId?: string): Promise<number> {
    if (this.stopping) return Promise.resolve(0);
    const work = this.executeBatch(organizationId).catch((error: unknown) => {
      this.logger.error({
        event: 'UsageReplayBatchFailed',
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      return 0;
    });
    this.active.add(work);
    void work.finally(() => {
      this.active.delete(work);
    });
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
        await this.processing.process(
          item.organizationId,
          item.customerId,
          item.usageEventId,
          true,
        );
      } catch (error: unknown) {
        this.logger.error({
          event: 'UsageReplayItemFailedUnexpectedly',
          organizationId: item.organizationId,
          usageEventId: item.usageEventId,
          errorType: error instanceof Error ? error.name : 'unknown',
        });
      }
    }
    return claimed.length;
  }
  private claimBatch(organizationId?: string): Promise<ClaimedUsage[]> {
    return this.dataSource.transaction(async (manager) => {
      const params: unknown[] = [
        USAGE_PROCESSING_RETRY.maxFailures,
        UsageReplayWorkerService.batchSize,
      ];
      const tenantFilter = organizationId ? 'AND p."OrganizationId"=$3' : '';
      if (organizationId) params.push(organizationId);
      const rows = await manager.query<
        Array<{ id: string; organizationId: string; usageEventId: string; customerId: string }>
      >(
        `SELECT p."Id" AS id, p."OrganizationId" AS "organizationId", p."UsageEventId" AS "usageEventId",
           u."CustomerId" AS "customerId"
         FROM "usage_event_processing" p
         JOIN "ai_usage_events" u ON u."Id"=p."UsageEventId" AND u."OrganizationId"=p."OrganizationId"
         WHERE ((p."Status" IN ('pending','failed') AND p."Retryable"=true
                   AND p."FailureCount"<$1 AND (p."NextRetryAt" IS NULL OR p."NextRetryAt"<=now()))
                OR (p."Status"='processing' AND p."ClaimedAt"<now()-interval '${String(UsageReplayWorkerService.staleClaimMinutes)} minutes'))
           ${tenantFilter}
         ORDER BY COALESCE(p."NextRetryAt",p."CreatedAt"),p."CreatedAt"
         FOR UPDATE OF p SKIP LOCKED LIMIT $2`,
        params,
      );
      if (rows.length === 0) return [];
      const now = new Date();
      await manager
        .createQueryBuilder()
        .update(UsageEventProcessingEntity)
        .set({
          status: UsageProcessingStatus.Processing,
          claimedAt: now,
          lastAttemptAt: now,
          updatedAt: now,
        })
        .whereInIds(rows.map((row) => row.id))
        .execute();
      return rows;
    });
  }
}
