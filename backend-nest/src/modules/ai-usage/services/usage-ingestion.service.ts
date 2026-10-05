import { Injectable } from '@nestjs/common';
import {
  AiCostSource,
  AiProvider,
  UsageProcessingStatus,
} from '../../../common/enums/domain.enums';
import { ConflictError, NotFoundError } from '../../../common/errors/application.error';
import { decimalString } from '../../../common/helpers/decimal-response.helper';
import { CustomerRepository } from '../../customers/repositories/customer.repository';
import { MarginService } from '../../margin/services/margin.service';
import { IngestUsageDto } from '../dto/usage.dto';
import { UsageRepository } from '../repositories/usage.repository';
import { UsageProcessingService } from './usage-processing.service';
@Injectable()
export class UsageIngestionService {
  constructor(
    private readonly repository: UsageRepository,
    private readonly customers: CustomerRepository,
    private readonly margins: MarginService,
    private readonly processing: UsageProcessingService,
  ) {}
  async ingest(org: string, dto: IngestUsageDto) {
    const requestId = dto.externalRequestId.trim();
    const result = await this.repository.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `U${org}${requestId}`,
      ]);
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `C${org}${dto.customerId}`,
      ]);
      const customer = await this.customers.find(org, dto.customerId, manager);
      if (!customer) throw new NotFoundError('The customer does not exist in this organization.');
      const existing = await this.repository.find(org, requestId, manager);
      if (existing) {
        if (existing.customerId !== dto.customerId)
          throw new ConflictError(
            'This external request ID is already associated with another customer.',
          );
        const state = await this.repository.processing(org, existing.id, manager);
        return {
          id: existing.id,
          duplicate: true,
          customerId: existing.customerId,
          processingStatus: state?.status ?? UsageProcessingStatus.Pending,
        };
      }
      const now = new Date();
      const usage = this.repository.create(
        {
          organizationId: org,
          customerId: dto.customerId,
          provider: dto.provider.trim() as AiProvider,
          model: dto.model.trim(),
          feature: dto.feature.trim(),
          inputTokens: String(dto.inputTokens),
          outputTokens: String(dto.outputTokens),
          cost: decimalString(dto.cost, 6),
          currency: 'USD',
          costSource: AiCostSource.Explicit,
          pricingVersion: null,
          pricingModel: null,
          metadata: {},
          externalRequestId: requestId,
          occurredAt: new Date(dto.occurredAt),
          createdAt: now,
        },
        manager,
      );
      await this.repository.save(usage, manager);
      await this.repository.saveProcessing(
        this.repository.createProcessing(
          {
            organizationId: org,
            usageEventId: usage.id,
            status: UsageProcessingStatus.Pending,
            processedAt: null,
            failureCount: 0,
            lastFailureCategory: null,
            lastAttemptAt: null,
            nextRetryAt: now,
            claimedAt: null,
            retryable: true,
            createdAt: now,
            updatedAt: now,
          },
          manager,
        ),
        manager,
      );
      return {
        id: usage.id,
        duplicate: false,
        customerId: usage.customerId,
        processingStatus: UsageProcessingStatus.Pending,
      };
    });
    const processingStatus = result.duplicate
      ? result.processingStatus
      : await this.processing.process(org, result.customerId, result.id);
    return {
      id: result.id,
      duplicate: result.duplicate,
      processingStatus,
      margin:
        processingStatus === UsageProcessingStatus.Failed
          ? null
          : await this.margins.get(org, result.customerId),
    };
  }
}
