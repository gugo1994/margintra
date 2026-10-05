// Legacy-only type retained for migration provenance and compatibility tests.
export interface OpenAiPrice {
  inputPerMillion: string;
  outputPerMillion: string;
  pricingModel: string;
}

// Standard text-token prices published by OpenAI for the GPT-5 family on 2025-08-07.
// Snapshot aliases deliberately map to the same auditable catalog entry.
export const OPENAI_PRICING_VERSION = 'openai-gpt5-2025-08-07';
// Legacy-only snapshot. Production runtime pricing is resolved from ai_model_pricing.
export const OPENAI_PRICES: Readonly<Record<string, OpenAiPrice>> = {
  'gpt-5': { inputPerMillion: '1.25', outputPerMillion: '10', pricingModel: 'gpt-5' },
  'gpt-5-2025-08-07': {
    inputPerMillion: '1.25',
    outputPerMillion: '10',
    pricingModel: 'gpt-5',
  },
  'gpt-5-mini': { inputPerMillion: '0.25', outputPerMillion: '2', pricingModel: 'gpt-5-mini' },
  'gpt-5-nano': { inputPerMillion: '0.05', outputPerMillion: '0.40', pricingModel: 'gpt-5-nano' },
};
