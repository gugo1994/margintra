import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { EntityManager } from 'typeorm';
import { PricingStatus } from '../../../common/enums/domain.enums';
import { AiModelPricingEntity } from '../../../database/entities';
import { PricingCatalogCandidate } from './provider-pricing.adapter';
import { PricingCatalogRepository } from './pricing-catalog.repository';
import { MetricsService } from '../../operations/metrics.service';

@Injectable()
export class PricingCatalogSyncService {
  private readonly logger = new Logger(PricingCatalogSyncService.name);
  constructor(
    private readonly repository: PricingCatalogRepository,
    private readonly metrics: MetricsService,
  ) {}

  applyCandidate(candidate: PricingCatalogCandidate) {
    return this.applyCandidateWithOutcome(candidate).then((result) => result.pricing);
  }

  applyCandidateWithOutcome(candidate: PricingCatalogCandidate) {
    candidate = this.normalize(candidate);
    return this.repository.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `PRICING:${candidate.provider}:${candidate.model}`,
      ]);
      const existingVersion = await manager.findOneBy(AiModelPricingEntity, {
        provider: candidate.provider,
        model: candidate.model,
        version: candidate.version,
      });
      const now = new Date();
      if (existingVersion) {
        if (!this.same(existingVersion, candidate))
          throw new Error('Pricing version conflicts with an existing immutable version.');
        existingVersion.lastVerifiedAt = now;
        existingVersion.updatedAt = now;
        await manager.save(existingVersion);
        return { pricing: existingVersion, created: false };
      }
      const status = candidate.trusted ? PricingStatus.Active : PricingStatus.Pending;
      if (status === PricingStatus.Active) await this.closeAndValidateActive(candidate, manager);
      const created = await manager.save(
        manager.create(AiModelPricingEntity, {
          provider: candidate.provider,
          model: candidate.model,
          pricingModel: candidate.pricingModel ?? candidate.model,
          inputPricePerMillion: candidate.inputPricePerMillion,
          outputPricePerMillion: candidate.outputPricePerMillion,
          currency: candidate.currency,
          effectiveFrom: candidate.effectiveFrom,
          version: candidate.version,
          sourceType: candidate.sourceType,
          sourceReference: candidate.sourceReference,
          status,
          effectiveTo: null,
          lastVerifiedAt: now,
          createdAt: now,
          updatedAt: now,
        }),
      );
      this.metrics.pricing('candidate_created');
      if (status === PricingStatus.Active) {
        await this.repository.requeuePending(
          candidate.provider,
          candidate.model,
          candidate.effectiveFrom,
          null,
          manager,
        );
        this.metrics.pricing('version_activated');
        this.logger.log({
          event: 'PricingVersionActivated',
          provider: candidate.provider,
          model: candidate.model,
          pricingId: created.id,
        });
      }
      return { pricing: created, created: true };
    });
  }

  normalize(candidate: PricingCatalogCandidate): PricingCatalogCandidate {
    const input = new Decimal(candidate.inputPricePerMillion);
    const output = new Decimal(candidate.outputPricePerMillion);
    if (!input.isFinite() || !output.isFinite() || input.isNegative() || output.isNegative())
      throw new Error('Provider pricing candidate contains an invalid rate.');
    const model = candidate.model.trim();
    if (!model || !candidate.version.trim())
      throw new Error('Provider pricing candidate is incomplete.');
    return {
      ...candidate,
      model,
      pricingModel: candidate.pricingModel?.trim() || model,
      inputPricePerMillion: input.toFixed(8),
      outputPricePerMillion: output.toFixed(8),
      currency: candidate.currency.trim().toUpperCase(),
      version: candidate.version.trim(),
      sourceReference: candidate.sourceReference?.trim() || null,
    };
  }

  private async closeAndValidateActive(candidate: PricingCatalogCandidate, manager: EntityManager) {
    const active = await manager.find(AiModelPricingEntity, {
      where: { provider: candidate.provider, model: candidate.model, status: PricingStatus.Active },
      order: { effectiveFrom: 'DESC' },
    });
    const latest = active[0];
    if (!latest) return;
    if (candidate.effectiveFrom <= latest.effectiveFrom)
      throw new Error('A new active pricing version must start after the latest active version.');
    if (latest.effectiveTo && latest.effectiveTo > candidate.effectiveFrom)
      throw new Error('Active pricing ranges cannot overlap.');
    latest.effectiveTo = candidate.effectiveFrom;
    latest.updatedAt = new Date();
    await manager.save(latest);
  }

  private same(row: AiModelPricingEntity, candidate: PricingCatalogCandidate) {
    return (
      new Decimal(row.inputPricePerMillion).eq(candidate.inputPricePerMillion) &&
      new Decimal(row.outputPricePerMillion).eq(candidate.outputPricePerMillion) &&
      row.currency === candidate.currency &&
      row.pricingModel === (candidate.pricingModel ?? candidate.model) &&
      row.effectiveFrom.getTime() === candidate.effectiveFrom.getTime() &&
      row.sourceType === candidate.sourceType &&
      row.sourceReference === candidate.sourceReference
    );
  }
}
