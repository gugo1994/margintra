import { registerAs } from '@nestjs/config';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const parsedUrl = (name: string, value: string, protocols: string[]): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!protocols.includes(url.protocol)) throw new Error(`${name} uses an unsupported protocol`);
  return url;
};
const isProduction = (): boolean =>
  (process.env.APP_ENV ?? 'development').toLowerCase() === 'production';
const boundedInteger = (
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(`${name} must be between ${String(minimum)} and ${String(maximum)}`);
  return value;
};
const booleanValue = (name: string, fallback: boolean): boolean => {
  const value = (process.env[name] ?? String(fallback)).toLowerCase();
  if (!['true', 'false'].includes(value)) throw new Error(`${name} must be true or false`);
  return value === 'true';
};
export const loadAppConfig = () => {
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be valid');
  const origin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  const originUrl = parsedUrl('WEB_ORIGIN', origin, ['http:', 'https:']);
  if (isProduction() && originUrl.protocol !== 'https:')
    throw new Error('Production WEB_ORIGIN must use HTTPS');
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? (isProduction() ? 2 : 0));
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 3)
    throw new Error('TRUST_PROXY_HOPS must be between 0 and 3');
  const seedDemoData = process.env.SEED_DEMO_DATA?.toLowerCase() === 'true';
  if (isProduction() && seedDemoData)
    throw new Error('SEED_DEMO_DATA cannot be enabled in production');
  const usageReplayIntervalMs = Number(process.env.USAGE_REPLAY_INTERVAL_MS ?? 5_000);
  if (
    !Number.isInteger(usageReplayIntervalMs) ||
    usageReplayIntervalMs < 1_000 ||
    usageReplayIntervalMs > 300_000
  )
    throw new Error('USAGE_REPLAY_INTERVAL_MS must be between 1000 and 300000');
  const notificationWorkerIntervalMs = boundedInteger(
    'NOTIFICATION_WORKER_INTERVAL_MS',
    5_000,
    1_000,
    300_000,
  );
  const stripeWebhookRetryIntervalMs = boundedInteger(
    'STRIPE_WEBHOOK_RETRY_INTERVAL_MS',
    5_000,
    1_000,
    300_000,
  );
  const ingestionWorkerEnabled = booleanValue('INGESTION_WORKER_ENABLED', true);
  const ingestionWorkerIntervalMs = boundedInteger(
    'INGESTION_WORKER_INTERVAL_MS',
    10_000,
    250,
    300_000,
  );
  const ingestionWorkerBatchSize = boundedInteger('INGESTION_WORKER_BATCH_SIZE', 10, 1, 100);
  const ingestionWorkerClaimTimeoutMs = boundedInteger(
    'INGESTION_WORKER_CLAIM_TIMEOUT_MS',
    300_000,
    1_000,
    3_600_000,
  );
  const ingestionWorkerMaxAttempts = boundedInteger('INGESTION_WORKER_MAX_ATTEMPTS', 5, 1, 20);
  const ingestionWorkerInitialBackoffMs = boundedInteger(
    'INGESTION_WORKER_INITIAL_BACKOFF_MS',
    1_000,
    100,
    300_000,
  );
  const ingestionWorkerMaxBackoffMs = boundedInteger(
    'INGESTION_WORKER_MAX_BACKOFF_MS',
    60_000,
    1_000,
    3_600_000,
  );
  const pricingRefreshEnabled = booleanValue('PRICING_REFRESH_ENABLED', true);
  const pricingRefreshIntervalMs = boundedInteger(
    'PRICING_REFRESH_INTERVAL_MS',
    43_200_000,
    60_000,
    604_800_000,
  );
  const pricingRefreshPollIntervalMs = boundedInteger(
    'PRICING_REFRESH_POLL_INTERVAL_MS',
    60_000,
    1_000,
    3_600_000,
  );
  const pricingRefreshClaimTimeoutMs = boundedInteger(
    'PRICING_REFRESH_CLAIM_TIMEOUT_MS',
    900_000,
    60_000,
    3_600_000,
  );
  if (ingestionWorkerMaxBackoffMs < ingestionWorkerInitialBackoffMs)
    throw new Error(
      'INGESTION_WORKER_MAX_BACKOFF_MS must not be less than INGESTION_WORKER_INITIAL_BACKOFF_MS',
    );
  return {
    port,
    origin,
    environment: process.env.APP_ENV ?? 'development',
    seedDemoData,
    trustProxyHops,
    runMigrations: !isProduction(),
    usageReplayIntervalMs,
    notificationWorkerIntervalMs,
    stripeWebhookRetryIntervalMs,
    ingestionWorkerEnabled,
    ingestionWorkerIntervalMs,
    ingestionWorkerBatchSize,
    ingestionWorkerClaimTimeoutMs,
    ingestionWorkerMaxAttempts,
    ingestionWorkerInitialBackoffMs,
    ingestionWorkerMaxBackoffMs,
    pricingRefreshEnabled,
    pricingRefreshIntervalMs,
    pricingRefreshPollIntervalMs,
    pricingRefreshClaimTimeoutMs,
  };
};
export const appConfig = registerAs('app', loadAppConfig);
export const loadAuthConfig = () => {
  const secret = required('JWT_SECRET');
  if (Buffer.byteLength(secret) < 32) throw new Error('JWT_SECRET must be at least 32 bytes');
  return {
    secret,
    issuer: process.env.JWT_ISSUER ?? 'Margintra',
    audience: process.env.JWT_AUDIENCE ?? 'Margintra.Web',
    expiresInSeconds: 28_800,
  };
};
export const authConfig = registerAs('auth', loadAuthConfig);
export const loadDatabaseConfig = () => {
  const url = required('DATABASE_URL');
  parsedUrl('DATABASE_URL', url, ['postgres:', 'postgresql:']);
  return {
    url,
    poolMax: boundedInteger('DB_POOL_MAX', 10, 1, 100),
    poolIdleTimeoutMs: boundedInteger('DB_POOL_IDLE_TIMEOUT_MS', 30_000, 1_000, 600_000),
    poolConnectionTimeoutMs: boundedInteger('DB_POOL_CONNECTION_TIMEOUT_MS', 5_000, 250, 60_000),
  };
};
export const databaseConfig = registerAs('database', loadDatabaseConfig);
export const loadRedisConfig = () => {
  const url = isProduction()
    ? required('REDIS_URL')
    : (process.env.REDIS_URL ?? 'redis://localhost:6379');
  parsedUrl('REDIS_URL', url, ['redis:', 'rediss:']);
  return { url };
};
export const redisConfig = registerAs('redis', loadRedisConfig);
export const loadBillingConfig = () => {
  const encryptionKey = required('STRIPE_ENCRYPTION_KEY');
  if (Buffer.from(encryptionKey, 'base64').length !== 32)
    throw new Error('STRIPE_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return { encryptionKey };
};
export const billingConfig = registerAs('billing', loadBillingConfig);

export type EmailProvider = 'development' | 'resend';
export interface EmailConfiguration {
  provider: EmailProvider;
  apiKey: string | null;
  fromEmail: string | null;
  fromName: string;
  dashboardUrl: string | null;
}
const emailAddress = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const loadEmailConfig = (): EmailConfiguration => {
  const production = isProduction();
  const selected = (
    process.env.EMAIL_PROVIDER ?? (production ? 'resend' : 'development')
  ).toLowerCase();
  if (selected !== 'development' && selected !== 'resend')
    throw new Error('EMAIL_PROVIDER must be development or resend');
  if (production && selected === 'development')
    throw new Error('Production requires a production email provider');
  const apiKey = process.env.EMAIL_API_KEY?.trim() || null;
  const fromEmail = process.env.EMAIL_FROM_EMAIL?.trim() || null;
  const fromName = process.env.EMAIL_FROM_NAME?.trim() || 'Margintra';
  if (
    selected === 'resend' &&
    (!apiKey || !fromEmail || !emailAddress.test(fromEmail) || !fromName)
  )
    throw new Error('Resend requires valid EMAIL_API_KEY, EMAIL_FROM_EMAIL, and EMAIL_FROM_NAME');
  const dashboardUrl = process.env.MARGINTRA_DASHBOARD_URL?.trim() || null;
  if (dashboardUrl) {
    const url = new URL(dashboardUrl);
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('MARGINTRA_DASHBOARD_URL must use HTTP or HTTPS');
    if (production && url.protocol !== 'https:')
      throw new Error('Production MARGINTRA_DASHBOARD_URL must use HTTPS');
  }
  return { provider: selected, apiKey, fromEmail, fromName, dashboardUrl };
};
export const emailConfig = registerAs('email', loadEmailConfig);
