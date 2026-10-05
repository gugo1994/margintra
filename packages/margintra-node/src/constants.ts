export const SDK_DEFAULTS = {
  baseUrl: 'http://localhost:8081',
  timeoutMs: 5_000,
  maxRetries: 2,
  initialBackoffMs: 100,
  maxJitterMs: 25,
} as const;
