export type AiProvider = 'openai';
export interface UsageRecord {
  externalRequestId: string;
  customerId: string;
  provider: AiProvider;
  model: string;
  feature?: string;
  usage: { inputTokens: number; outputTokens: number };
  cost?: string;
  currency?: 'USD';
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}
export type OpenAiUsageRecord = Omit<UsageRecord, 'provider'>;
export interface UsageResult {
  accepted: true; duplicate: boolean; usageEventId: string; customerId: string;
  cost: string; currency: 'USD'; costSource: 'explicit' | 'calculated'; pricingVersion: string | null;
}
export interface MargintraOptions {
  apiKey: string; baseUrl?: string; timeoutMs?: number; maxRetries?: number; fetch?: typeof globalThis.fetch;
}
