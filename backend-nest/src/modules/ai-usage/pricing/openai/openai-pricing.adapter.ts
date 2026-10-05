import { Injectable } from '@nestjs/common';
import { AiProvider } from '../../../../common/enums/domain.enums';
import { PricingCatalogCandidate, ProviderPricingAdapter } from '../provider-pricing.adapter';

@Injectable()
export class OpenAiPricingAdapter implements ProviderPricingAdapter {
  readonly provider = AiProvider.OpenAI;
  readonly automaticSourceAvailable = false;

  // OpenAI does not currently expose a stable machine-readable pricing feed used by this app.
  // Verified candidates can be supplied to PricingCatalogSyncService without scraping HTML.
  discover(_models: readonly string[]): Promise<PricingCatalogCandidate[]> {
    void _models;
    return Promise.resolve([]);
  }
}
