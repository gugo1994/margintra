import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AiProvider } from '../../../../common/enums/domain.enums';
import { CodedApplicationError } from '../../../../common/errors/application.error';
import { INGESTION_ERRORS } from '../../constants/ingestion.constants';
import { AiCostCalculator, AiUsageCostResult, AiUsagePricingInput } from '../pricing.interface';
import { OPENAI_PRICES, OPENAI_PRICING_VERSION } from './openai-pricing.catalog';

@Injectable()
/** @deprecated New production ingestion uses AiPricingService and the database catalog. */
export class OpenAiCostCalculator implements AiCostCalculator {
  supports(provider: AiProvider, model: string): boolean {
    void provider;
    return model in OPENAI_PRICES;
  }
  calculate(input: AiUsagePricingInput): AiUsageCostResult {
    const price = OPENAI_PRICES[input.model];
    if (!price)
      throw new CodedApplicationError(
        422,
        INGESTION_ERRORS.unsupportedModel,
        'The submitted model has no pricing catalog entry.',
      );
    const million = new Decimal(1_000_000);
    const cost = new Decimal(input.inputTokens)
      .div(million)
      .mul(price.inputPerMillion)
      .plus(new Decimal(input.outputTokens).div(million).mul(price.outputPerMillion));
    return {
      cost: cost.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
      currency: 'USD',
      pricingVersion: OPENAI_PRICING_VERSION,
      pricingModel: price.pricingModel,
    };
  }
}
