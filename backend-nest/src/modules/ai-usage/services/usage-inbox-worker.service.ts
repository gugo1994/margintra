import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { InboxProcessingStatus } from '../../../common/enums/domain.enums';
import { MetricsService } from '../../operations/metrics.service';
import { UsageInboxProcessorService } from './usage-inbox-processor.service';

@Injectable()
export class UsageInboxWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsageInboxWorkerService.name);
  private timer?: NodeJS.Timeout;
  private inFlight: Promise<number> | null = null;
  private shuttingDown = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly processor: UsageInboxProcessorService,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (!(this.config.get<boolean>('app.ingestionWorkerEnabled') ?? true)) return;
    const interval = this.config.get<number>('app.ingestionWorkerIntervalMs') ?? 10_000;
    this.timer = setInterval(() => {
      this.tick();
    }, interval);
    this.timer.unref();
    this.tick();
  }

  async onModuleDestroy() {
    this.shuttingDown = true;
    if (this.timer) clearInterval(this.timer);
    if (this.inFlight) await this.inFlight;
  }

  async processBatch(): Promise<number> {
    if (this.shuttingDown) return 0;
    const batchSize = this.config.get<number>('app.ingestionWorkerBatchSize') ?? 10;
    const claimTimeoutMs = this.config.get<number>('app.ingestionWorkerClaimTimeoutMs') ?? 300_000;
    const maxAttempts = this.config.get<number>('app.ingestionWorkerMaxAttempts') ?? 5;
    const ids = await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE "usage_ingestion_inbox"
         SET "ProcessingStatus"='failed',"ClaimedAt"=NULL,"NextAttemptAt"=NULL,
             "LastErrorCode"='retry_exhausted',
             "LastErrorMessage"='Usage processing retry limit was reached.',"UpdatedAt"=now()
         WHERE "ProcessingStatus"='processing' AND "AttemptCount">=$1
           AND "ClaimedAt"<now()-($2::int * interval '1 millisecond')`,
        [maxAttempts, claimTimeoutMs],
      );
      const rows = await manager.query<Array<{ Id: string; stale: boolean }>>(
        `SELECT "Id", ("ProcessingStatus"='processing') AS stale
         FROM "usage_ingestion_inbox"
         WHERE (("ProcessingStatus" IN ('pending','failed') AND "NextAttemptAt"<=now()
                  AND "AttemptCount"<$1)
            OR ("ProcessingStatus"='processing' AND "AttemptCount"<$1
                AND "ClaimedAt"<now()-($2::int * interval '1 millisecond')))
         ORDER BY "CreatedAt", "Id"
         FOR UPDATE SKIP LOCKED LIMIT $3`,
        [maxAttempts, claimTimeoutMs, batchSize],
      );
      for (const item of rows) {
        await manager.query(
          `UPDATE "usage_ingestion_inbox" SET "ProcessingStatus"=$2,"AttemptCount"="AttemptCount"+1,
             "ClaimedAt"=now(),"UpdatedAt"=now() WHERE "Id"=$1`,
          [item.Id, InboxProcessingStatus.Processing],
        );
        if (item.stale) this.metrics.usageInbox('stale_recovered');
      }
      return rows.map((row) => row.Id);
    });
    // Once claimed, complete the bounded batch even if shutdown starts. Shutdown prevents
    // the next claim and awaits this promise, so claimed work is not abandoned voluntarily.
    for (const id of ids) await this.processor.process(id);
    return ids.length;
  }

  private tick() {
    if (this.shuttingDown || this.inFlight) return;
    this.inFlight = this.processBatch()
      .catch((error: unknown) => {
        this.logger.error({
          event: 'UsageInboxWorkerIterationFailed',
          errorType: error instanceof Error ? error.name : 'unknown',
        });
        return 0;
      })
      .finally(() => {
        this.inFlight = null;
      });
  }
}
