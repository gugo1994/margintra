import { AiProvider, PricingSourceType } from '../../../common/enums/domain.enums';

export interface PricingCatalogCandidate {
  provider: AiProvider;
  model: string;
  pricingModel?: string;
  inputPricePerMillion: string;
  outputPricePerMillion: string;
  currency: string;
  effectiveFrom: Date;
  version: string;
  sourceType: PricingSourceType;
  sourceReference: string | null;
  trusted: boolean;
}

export interface ProviderPricingAdapter {
  readonly provider: AiProvider;
  readonly automaticSourceAvailable: boolean;
  discover(models: readonly string[]): Promise<PricingCatalogCandidate[]>;
}

export const PROVIDER_PRICING_ADAPTERS = Symbol('PROVIDER_PRICING_ADAPTERS');
