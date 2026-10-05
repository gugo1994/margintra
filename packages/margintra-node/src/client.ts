import { SDK_DEFAULTS } from './constants.js';
import { MargintraError } from './error.js';
import { MargintraOptions, OpenAiUsageRecord, UsageRecord, UsageResult } from './types.js';

const retryableStatus = (status: number) => status === 429 || status >= 500;
const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
export class Margintra {
  readonly usage: { record: (input: UsageRecord) => Promise<UsageResult>; recordOpenAI: (input: OpenAiUsageRecord) => Promise<UsageResult> };
  private readonly apiKey: string; private readonly baseUrl: string; private readonly timeoutMs: number;
  private readonly maxRetries: number; private readonly fetchImpl: typeof globalThis.fetch;
  constructor(options: MargintraOptions) {
    if (!options.apiKey) throw new Error('Margintra apiKey is required.');
    this.apiKey = options.apiKey; this.baseUrl = (options.baseUrl ?? SDK_DEFAULTS.baseUrl).replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? SDK_DEFAULTS.timeoutMs; this.maxRetries = options.maxRetries ?? SDK_DEFAULTS.maxRetries;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000)
      throw new Error('Margintra timeoutMs must be between 1 and 60000.');
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 10)
      throw new Error('Margintra maxRetries must be an integer between 0 and 10.');
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.usage = { record: (input) => this.record(input), recordOpenAI: (input) => this.record({ ...input, provider: 'openai' }) };
  }
  private async record(input: UsageRecord): Promise<UsageResult> {
    const payload = JSON.stringify({
      externalRequestId: input.externalRequestId,
      customerId: input.customerId,
      provider: input.provider,
      model: input.model,
      ...(input.feature === undefined ? {} : { feature: input.feature }),
      usage: { inputTokens: input.usage.inputTokens, outputTokens: input.usage.outputTokens },
      ...(input.cost === undefined ? {} : { cost: input.cost }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    });
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController(); const timeout = setTimeout(() => { controller.abort(); }, this.timeoutMs);
      let response: Response | null = null;
      try {
        response = await this.fetchImpl(`${this.baseUrl}/api/v1/ingest/usage`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Margintra-Key': this.apiKey }, body: payload, signal: controller.signal });
      } catch {
        if (attempt >= this.maxRetries) throw new MargintraError(null, 'MARGINTRA_NETWORK_ERROR', 'Margintra telemetry delivery failed.', true);
      } finally { clearTimeout(timeout); }
      if (response) {
        if (response.ok) {
          try { return await response.json() as UsageResult; }
          catch { throw new MargintraError(response.status, 'MARGINTRA_INVALID_RESPONSE', 'Margintra returned an invalid response.', false); }
        }
        const problem = await response.json().catch(() => ({})) as { code?: string; detail?: string };
        const retryable = retryableStatus(response.status);
        if (!retryable || attempt >= this.maxRetries) {
          const detail = problem.detail?.split(this.apiKey).join('[REDACTED]');
          const code = problem.code?.split(this.apiKey).join('REDACTED');
          throw new MargintraError(response.status, code ?? 'MARGINTRA_REQUEST_FAILED',
            detail ?? `Margintra request failed (${String(response.status)}).`, retryable);
        }
      }
      const jitter = Math.floor(Math.random() * (SDK_DEFAULTS.maxJitterMs + 1));
      await sleep(SDK_DEFAULTS.initialBackoffMs * 2 ** attempt + jitter);
    }
  }
}
