import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  AiProvider,
  InboxProcessingStatus,
  PricingStatus,
} from '../../../common/enums/domain.enums';
import { AiModelPricingEntity, UsageIngestionInboxEntity } from '../../../database/entities';

@Injectable()
export class PricingCatalogRepository {
  constructor(private readonly dataSource: DataSource) {}

  resolve(provider: AiProvider, model: string, occurredAt: Date, manager: EntityManager) {
    return manager
      .createQueryBuilder(AiModelPricingEntity, 'p')
      .where(
        `p."Provider"=:provider AND p."Model"=:model AND
        (p."Status"=:active OR (p."Status"=:retired AND p."EffectiveTo" IS NOT NULL))`,
        {
          provider,
          model,
          active: PricingStatus.Active,
          retired: PricingStatus.Retired,
        },
      )
      .andWhere('p."EffectiveFrom"<=:occurredAt')
      .andWhere('(p."EffectiveTo" IS NULL OR :occurredAt<p."EffectiveTo")')
      .setParameter('occurredAt', occurredAt)
      .orderBy('p."EffectiveFrom"', 'DESC')
      .addOrderBy('p."CreatedAt"', 'DESC')
      .getOne();
  }

  list(status: PricingStatus.Active | PricingStatus.Pending) {
    return this.dataSource.manager.find(AiModelPricingEntity, {
      where: { status },
      order: { provider: 'ASC', model: 'ASC', effectiveFrom: 'DESC', createdAt: 'DESC' },
    });
  }

  transaction<T>(work: (manager: EntityManager) => Promise<T>) {
    return this.dataSource.transaction(work);
  }

  requeuePending(
    provider: AiProvider,
    model: string,
    effectiveFrom: Date,
    effectiveTo: Date | null,
    manager: EntityManager,
  ) {
    const query = manager
      .createQueryBuilder()
      .update(UsageIngestionInboxEntity)
      .set({
        processingStatus: InboxProcessingStatus.Pending,
        nextAttemptAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: new Date(),
      })
      .where('"Provider"=:provider AND "Model"=:model AND "ProcessingStatus"=:status', {
        provider,
        model,
        status: InboxProcessingStatus.PendingPricing,
      })
      .andWhere('"OccurredAt">=:effectiveFrom', { effectiveFrom });
    if (effectiveTo) query.andWhere('"OccurredAt"<:effectiveTo', { effectiveTo });
    return query.execute();
  }
}
