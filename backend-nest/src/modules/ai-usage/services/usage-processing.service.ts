import { Injectable, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { UsageProcessingStatus } from '../../../common/enums/domain.enums';
import { MarginService } from '../../margin/services/margin.service';
import { UsageRepository } from '../repositories/usage.repository';

export const USAGE_PROCESSING_RETRY = {
  maxFailures: 5,
  initialDelayMs: 1_000,
  maxDelayMs: 60_000,
} as const;
export class PermanentUsageProcessingError extends Error {
  constructor(public readonly category: string) {
    super('Usage processing cannot be retried.');
  }
}

@Injectable()
export class UsageProcessingService {
  private readonly logger = new Logger(UsageProcessingService.name);
  constructor(
    private readonly repository: UsageRepository,
    private readonly margins: MarginService,
  ) {}

  async process(
    org: string,
    customerId: string,
    usageEventId: string,
    alreadyClaimed = false,
  ): Promise<UsageProcessingStatus> {
    if (!alreadyClaimed) {
      const claimed = await this.claim(org, usageEventId);
      if (claimed !== UsageProcessingStatus.Processing) return claimed;
    }
    try {
      await this.repository.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `C${org}${customerId}`,
        ]);
        await this.margins.recalculate(org, customerId, manager);
        const state = await this.repository.processing(org, usageEventId, manager);
        if (!state) throw new PermanentUsageProcessingError('processing_state_missing');
        const now = new Date();
        state.status = UsageProcessingStatus.Processed;
        state.processedAt = now;
        state.lastAttemptAt = now;
        state.failureCount = 0;
        state.lastFailureCategory = null;
        state.nextRetryAt = null;
        state.claimedAt = null;
        state.retryable = false;
        state.updatedAt = now;
        await this.repository.saveProcessing(state, manager);
      });
      return UsageProcessingStatus.Processed;
    } catch (error) {
      const permanent = error instanceof PermanentUsageProcessingError;
      const category = permanent
        ? error.category
        : error instanceof QueryFailedError
          ? 'database'
          : 'financial_processing';
      try {
        await this.repository.transaction(async (manager) => {
          await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            `P${org}${usageEventId}`,
          ]);
          const state = await this.repository.processing(org, usageEventId, manager);
          if (!state) return;
          const now = new Date();
          state.status = UsageProcessingStatus.Failed;
          state.failureCount += 1;
          state.lastFailureCategory = category;
          state.lastAttemptAt = now;
          state.claimedAt = null;
          state.retryable = !permanent && state.failureCount < USAGE_PROCESSING_RETRY.maxFailures;
          const delay = Math.min(
            USAGE_PROCESSING_RETRY.maxDelayMs,
            USAGE_PROCESSING_RETRY.initialDelayMs * 2 ** Math.max(0, state.failureCount - 1),
          );
          state.nextRetryAt = state.retryable ? new Date(now.getTime() + delay) : null;
          state.updatedAt = now;
          await this.repository.saveProcessing(state, manager);
        });
      } catch (stateError) {
        this.logger.error({
          event: 'UsageFailureStateUpdateFailed',
          organizationId: org,
          usageEventId,
          errorType: stateError instanceof Error ? stateError.name : 'unknown',
        });
      }
      this.logger.error({
        event: 'UsageFinancialProcessingFailed',
        organizationId: org,
        usageEventId,
        failureCategory: category,
      });
      return UsageProcessingStatus.Failed;
    }
  }
  private claim(org: string, usageEventId: string): Promise<UsageProcessingStatus> {
    return this.repository.transaction(async (manager) => {
      const rows = await manager.query<Array<{ status: UsageProcessingStatus }>>(
        `SELECT "Status" AS status FROM "usage_event_processing"
         WHERE "OrganizationId"=$1 AND "UsageEventId"=$2 FOR UPDATE`,
        [org, usageEventId],
      );
      const current = rows[0]?.status;
      if (!current) return UsageProcessingStatus.Failed;
      if (current === UsageProcessingStatus.Processed) return current;
      if (current === UsageProcessingStatus.Processing) return current;
      const state = await this.repository.processing(org, usageEventId, manager);
      if (!state) return UsageProcessingStatus.Failed;
      const now = new Date();
      state.status = UsageProcessingStatus.Processing;
      state.claimedAt = now;
      state.lastAttemptAt = now;
      state.updatedAt = now;
      await this.repository.saveProcessing(state, manager);
      return UsageProcessingStatus.Processing;
    });
  }
}
