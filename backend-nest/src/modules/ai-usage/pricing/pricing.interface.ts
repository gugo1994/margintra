import { AiProvider } from '../../../common/enums/domain.enums';

export interface AiUsagePricingInput {
  provider: AiProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
}
export interface AiUsageCostResult {
  cost: string;
  currency: 'USD';
  pricingVersion: string;
  pricingModel: string;
}
export interface AiCostCalculator {
  supports(provider: AiProvider, model: string): boolean;
  calculate(input: AiUsagePricingInput): AiUsageCostResult;
}
