import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { EntityManager } from 'typeorm';
import { AiUsagePricingInput } from './pricing.interface';
import { PricingCatalogRepository } from './pricing-catalog.repository';

@Injectable()
export class AiPricingService {
  constructor(private readonly repository: PricingCatalogRepository) {}

  async calculate(input: AiUsagePricingInput, occurredAt: Date, manager: EntityManager) {
    const price = await this.repository.resolve(input.provider, input.model, occurredAt, manager);
    if (!price) return null;
    const million = new Decimal(1_000_000);
    const cost = new Decimal(input.inputTokens)
      .div(million)
      .mul(price.inputPricePerMillion)
      .plus(new Decimal(input.outputTokens).div(million).mul(price.outputPricePerMillion));
    return {
      cost: cost.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
      currency: price.currency,
      pricingVersion: price.version,
      pricingModel: price.pricingModel,
      pricingId: price.id,
    };
  }
}
