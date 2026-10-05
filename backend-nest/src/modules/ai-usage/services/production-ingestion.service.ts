import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { InboxProcessingStatus } from '../../../common/enums/domain.enums';
import { CodedApplicationError } from '../../../common/errors/application.error';
import { utcCalendarMonth } from '../../../common/helpers/calendar-month.helper';
import { INGESTION_ERRORS, INGESTION_LIMITS } from '../constants/ingestion.constants';
import { ProductionUsageDto } from '../dto/production-usage.dto';
import { IngestionInboxRepository } from '../repositories/ingestion-inbox.repository';
import { MetricsService } from '../../operations/metrics.service';

@Injectable()
export class ProductionIngestionService {
  private readonly logger = new Logger(ProductionIngestionService.name);
  constructor(
    private readonly repository: IngestionInboxRepository,
    private readonly metrics: MetricsService,
  ) {}

  async ingest(org: string, dto: ProductionUsageDto) {
    const normalized = this.normalize(dto);
    const result = await this.repository.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `INBOX:${org}:${normalized.externalRequestId}`,
      ]);
      const existing = await this.repository.find(org, normalized.externalRequestId, manager);
      if (existing) {
        if (!this.equivalent(existing, normalized))
          throw new CodedApplicationError(
            409,
            INGESTION_ERRORS.conflict,
            'The request ID was already accepted with different usage facts.',
          );
        return { row: existing, duplicate: true };
      }
      const now = new Date();
      const row = await this.repository.save(
        this.repository.create(
          {
            organizationId: org,
            ...normalized,
            processingStatus: InboxProcessingStatus.Pending,
            attemptCount: 0,
            nextAttemptAt: now,
            claimedAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            processedAt: null,
            usageEventId: null,
            createdAt: now,
            updatedAt: now,
          },
          manager,
        ),
        manager,
      );
      return { row, duplicate: false };
    });
    this.logger.log({
      event: 'UsageInboxAccepted',
      organizationId: org,
      inboxEventId: result.row.id,
      duplicate: result.duplicate,
    });
    this.metrics.usageInbox('accepted');
    return {
      accepted: true,
      duplicate: result.duplicate,
      eventId: result.row.id,
      processingStatus: result.row.processingStatus,
    };
  }

  private normalize(dto: ProductionUsageDto) {
    const occurredAt = new Date(dto.occurredAt);
    const { start, end } = utcCalendarMonth();
    if (
      occurredAt < start ||
      occurredAt >= end ||
      occurredAt.getTime() > Date.now() + INGESTION_LIMITS.futureSkewMs
    )
      throw new CodedApplicationError(
        422,
        INGESTION_ERRORS.invalidUsage,
        'occurredAt must fall in the current UTC calendar month and cannot exceed the allowed future skew.',
      );
    const metadata = dto.metadata ?? {};
    if (Buffer.byteLength(JSON.stringify(metadata), 'utf8') > INGESTION_LIMITS.metadataBytes)
      throw new CodedApplicationError(
        422,
        INGESTION_ERRORS.invalidUsage,
        'Metadata exceeds the 4096-byte limit.',
      );
    const explicitCost = dto.cost === undefined ? null : new Decimal(dto.cost);
    if (explicitCost?.gt(INGESTION_LIMITS.maxCost))
      throw new CodedApplicationError(
        422,
        INGESTION_ERRORS.invalidUsage,
        'Explicit cost exceeds the supported monetary range.',
      );
    return {
      externalRequestId: dto.externalRequestId.trim(),
      customerExternalId: dto.customerId.trim(),
      provider: dto.provider,
      model: dto.model.trim(),
      feature: dto.feature?.trim() || 'unattributed',
      inputTokens: String(dto.usage.inputTokens),
      outputTokens: String(dto.usage.outputTokens),
      occurredAt,
      metadata,
      explicitCost: explicitCost?.toFixed(6) ?? null,
      explicitCostCurrency: explicitCost ? dto.currency! : null,
    };
  }

  private equivalent(
    row: import('../../../database/entities').UsageIngestionInboxEntity,
    value: ReturnType<ProductionIngestionService['normalize']>,
  ) {
    return (
      row.customerExternalId === value.customerExternalId &&
      row.provider.localeCompare(value.provider) === 0 &&
      row.model === value.model &&
      row.feature === value.feature &&
      row.inputTokens === value.inputTokens &&
      row.outputTokens === value.outputTokens &&
      (row.explicitCost === null
        ? value.explicitCost === null
        : value.explicitCost !== null && new Decimal(row.explicitCost).eq(value.explicitCost)) &&
      row.explicitCostCurrency === value.explicitCostCurrency &&
      JSON.stringify(this.sort(row.metadata)) === JSON.stringify(this.sort(value.metadata))
    );
  }

  private sort(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.sort(item));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, this.sort(item)]),
      );
    return value;
  }
}
