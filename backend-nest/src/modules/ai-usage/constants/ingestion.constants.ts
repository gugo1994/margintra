export const INGESTION_LIMITS = {
  externalRequestId: 300,
  externalCustomerId: 200,
  model: 200,
  feature: 200,
  metadataBytes: 4096,
  tokens: 1_000_000_000,
  maxCost: '999999999999.999999',
  futureSkewMs: 5 * 60 * 1000,
  requestsPerMinute: 600,
} as const;

export const INGESTION_ERRORS = {
  invalidKey: 'INVALID_API_KEY',
  revokedKey: 'API_KEY_REVOKED',
  customerNotFound: 'CUSTOMER_NOT_FOUND',
  conflict: 'DUPLICATE_REQUEST_CONFLICT',
  unsupportedProvider: 'UNSUPPORTED_PROVIDER',
  unsupportedModel: 'UNSUPPORTED_MODEL',
  invalidUsage: 'INVALID_USAGE',
  rateLimited: 'RATE_LIMITED',
} as const;
