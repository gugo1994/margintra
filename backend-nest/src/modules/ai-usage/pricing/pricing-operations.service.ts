import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { EntityManager } from 'typeorm';
import { PricingStatus } from '../../../common/enums/domain.enums';
import { AiModelPricingEntity } from '../../../database/entities';
import { MetricsService } from '../../operations/metrics.service';
import { CreateVerifiedPricingCandidateDto } from './pricing-operations.dto';
import { PricingCatalogRepository } from './pricing-catalog.repository';

export class PricingOperationError extends Error {}

@Injectable()
export class PricingOperationsService {
  private readonly logger = new Logger(PricingOperationsService.name);

  constructor(
    private readonly repository: PricingCatalogRepository,
    private readonly metrics: MetricsService,
  ) {}

  list(status: PricingStatus.Active | PricingStatus.Pending) {
    return this.repository.list(status);
  }

  createVerifiedCandidate(dto: CreateVerifiedPricingCandidateDto) {
    const inputPrice = new Decimal(dto.inputPricePerMillion);
    const outputPrice = new Decimal(dto.outputPricePerMillion);
    const maximumRate = new Decimal('9999999999.99999999');
    if (
      !inputPrice.isFinite() ||
      !outputPrice.isFinite() ||
      inputPrice.isNegative() ||
      outputPrice.isNegative() ||
      inputPrice.gt(maximumRate) ||
      outputPrice.gt(maximumRate)
    )
      throw new PricingOperationError('Pricing rates exceed the supported numeric range.');
    const candidate = {
      provider: dto.provider,
      model: dto.model.trim(),
      pricingModel: dto.canonicalModel?.trim() || dto.model.trim(),
      inputPricePerMillion: inputPrice.toFixed(8),
      outputPricePerMillion: outputPrice.toFixed(8),
      currency: dto.currency,
      effectiveFrom: new Date(dto.effectiveFrom),
      sourceType: dto.sourceType,
      sourceReference: dto.sourceReference?.trim() || null,
      operatorSource: dto.operatorSource.trim(),
    };
    return this.repository.transaction(async (manager) => {
      await this.lock(candidate.provider, candidate.model, manager);
      const rows = await manager.find(AiModelPricingEntity, {
        where: { provider: candidate.provider, model: candidate.model },
      });
      const identical = rows.find((row) => this.sameFacts(row, candidate));
      if (identical) {
        this.audit('PricingCandidateDeduplicated', identical, candidate.operatorSource);
        return { pricing: identical, created: false };
      }
      const now = new Date();
      const version = this.version(candidate);
      const pricing = await manager.save(
        manager.create(AiModelPricingEntity, {
          id: randomUUID(),
          ...candidate,
          version,
          status: PricingStatus.Pending,
          effectiveTo: null,
          lastVerifiedAt: now,
          createdBy: candidate.operatorSource,
          activatedBy: null,
          retiredBy: null,
          activatedAt: null,
          retiredAt: null,
          createdAt: now,
          updatedAt: now,
        }),
      );
      this.metrics.pricing('candidate_created');
      this.audit('PricingCandidateCreated', pricing, candidate.operatorSource);
      return { pricing, created: true };
    });
  }

  activate(id: string, operatorSource: string) {
    return this.repository.transaction(async (manager) => {
      let selected = await this.forUpdate(id, manager);
      await this.lock(selected.provider, selected.model, manager);
      selected = await this.forUpdate(id, manager);
      if (selected.status === PricingStatus.Active) return selected;
      if (selected.status !== PricingStatus.Pending)
        throw new PricingOperationError('Only a pending pricing version can be activated.');

      const prior = await manager
        .createQueryBuilder(AiModelPricingEntity, 'pricing')
        .where('pricing."Provider"=:provider AND pricing."Model"=:model AND pricing."Id"<>:id', {
          provider: selected.provider,
          model: selected.model,
          id: selected.id,
        })
        .andWhere(
          `(pricing."Status"=:active OR
          (pricing."Status"=:retired AND pricing."EffectiveTo" IS NOT NULL))`,
          {
            active: PricingStatus.Active,
            retired: PricingStatus.Retired,
          },
        )
        .orderBy('pricing."EffectiveFrom"', 'DESC')
        .addOrderBy('pricing."CreatedAt"', 'DESC')
        .getMany();
      const latest = prior[0];
      if (latest) {
        if (selected.effectiveFrom <= latest.effectiveFrom)
          throw new PricingOperationError(
            'The pending version overlaps or predates the latest active pricing version.',
          );
        if (latest.effectiveTo && selected.effectiveFrom < latest.effectiveTo)
          throw new PricingOperationError('Active pricing ranges cannot overlap.');
        if (!latest.effectiveTo) {
          latest.effectiveTo = selected.effectiveFrom;
          latest.updatedAt = new Date();
          await manager.save(latest);
        }
      }
      const now = new Date();
      selected.status = PricingStatus.Active;
      selected.activatedAt = now;
      selected.activatedBy = operatorSource.trim();
      selected.operatorSource = operatorSource.trim();
      selected.updatedAt = now;
      await manager.save(selected);
      await this.repository.requeuePending(
        selected.provider,
        selected.model,
        selected.effectiveFrom,
        selected.effectiveTo,
        manager,
      );
      this.metrics.pricing('version_activated');
      this.audit('PricingVersionActivated', selected, operatorSource);
      return selected;
    });
  }

  retire(id: string, operatorSource: string) {
    return this.repository.transaction(async (manager) => {
      let selected = await this.forUpdate(id, manager);
      await this.lock(selected.provider, selected.model, manager);
      selected = await this.forUpdate(id, manager);
      if (selected.status === PricingStatus.Retired) return selected;
      const now = new Date();
      if (
        selected.status === PricingStatus.Active &&
        !selected.effectiveTo &&
        now > selected.effectiveFrom
      )
        selected.effectiveTo = now;
      selected.status = PricingStatus.Retired;
      selected.retiredAt = now;
      selected.retiredBy = operatorSource.trim();
      selected.operatorSource = operatorSource.trim();
      selected.updatedAt = now;
      await manager.save(selected);
      this.audit('PricingVersionRetired', selected, operatorSource);
      return selected;
    });
  }

  private async forUpdate(id: string, manager: EntityManager) {
    const row = await manager.findOne(AiModelPricingEntity, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!row) throw new PricingOperationError('Pricing version was not found.');
    return row;
  }

  private lock(provider: string, model: string, manager: EntityManager) {
    return manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `PRICING:${provider}:${model}`,
    ]);
  }

  private sameFacts(
    row: AiModelPricingEntity,
    candidate: {
      pricingModel: string;
      inputPricePerMillion: string;
      outputPricePerMillion: string;
      currency: string;
      effectiveFrom: Date;
      sourceType: AiModelPricingEntity['sourceType'];
      sourceReference: string | null;
    },
  ) {
    return (
      row.pricingModel === candidate.pricingModel &&
      new Decimal(row.inputPricePerMillion).eq(candidate.inputPricePerMillion) &&
      new Decimal(row.outputPricePerMillion).eq(candidate.outputPricePerMillion) &&
      row.currency === candidate.currency &&
      row.effectiveFrom.getTime() === candidate.effectiveFrom.getTime() &&
      row.sourceType === candidate.sourceType &&
      row.sourceReference === candidate.sourceReference
    );
  }

  private version(candidate: {
    provider: string;
    model: string;
    pricingModel: string;
    inputPricePerMillion: string;
    outputPricePerMillion: string;
    currency: string;
    effectiveFrom: Date;
    sourceType: string;
    sourceReference: string | null;
  }) {
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          provider: candidate.provider,
          model: candidate.model,
          pricingModel: candidate.pricingModel,
          inputPricePerMillion: candidate.inputPricePerMillion,
          outputPricePerMillion: candidate.outputPricePerMillion,
          currency: candidate.currency,
          effectiveFrom: candidate.effectiveFrom.toISOString(),
          sourceType: candidate.sourceType,
          sourceReference: candidate.sourceReference,
        }),
      )
      .digest('hex')
      .slice(0, 16);
    return `verified-${candidate.provider}-${digest}`;
  }

  private audit(event: string, row: AiModelPricingEntity, operatorSource: string) {
    this.logger.log({
      event,
      operatorSource,
      provider: row.provider,
      model: row.model,
      version: row.version,
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveTo: row.effectiveTo?.toISOString() ?? null,
      sourceReference: row.sourceReference,
      status: row.status,
    });
  }
}
