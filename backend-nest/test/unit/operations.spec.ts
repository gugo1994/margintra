import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  loadAppConfig,
  loadAuthConfig,
  loadBillingConfig,
  loadDatabaseConfig,
  loadRedisConfig,
} from '../../src/config/configuration';
import { NotificationService } from '../../src/modules/notifications/notification.service';
import { MetricsService } from '../../src/modules/operations/metrics.service';
import { OperationalRedisService } from '../../src/modules/operations/operational-redis.service';
import { OperationsController } from '../../src/modules/operations/operations.controller';
import {
  ObservedRequest,
  RequestObservabilityMiddleware,
} from '../../src/modules/operations/request-observability.middleware';

describe('operational health and lifecycle', () => {
  const dataSource = (query: jest.Mock, initialized = true) =>
    ({ isInitialized: initialized, query }) as unknown as DataSource;
  const redis = (ping: jest.Mock) => ({ ping }) as unknown as OperationalRedisService;

  it('keeps liveness independent and reports healthy dependencies in readiness', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const ping = jest.fn().mockResolvedValue(undefined);
    const controller = new OperationsController(
      dataSource(query),
      redis(ping),
      new MetricsService(),
    );
    expect(controller.live()).toEqual({ status: 'alive' });
    await expect(controller.ready()).resolves.toEqual({
      status: 'ready',
      checks: { postgresql: 'up', redis: 'up' },
    });
  });

  it('returns only a safe unavailable error when PostgreSQL fails', async () => {
    const controller = new OperationsController(
      dataSource(jest.fn().mockRejectedValue(new Error('postgres secret detail'))),
      redis(jest.fn()),
      new MetricsService(),
    );
    await expect(controller.ready()).rejects.toEqual(
      new ServiceUnavailableException('Service is not ready.'),
    );
  });

  it('returns only a safe unavailable error when Redis fails', async () => {
    const controller = new OperationsController(
      dataSource(jest.fn().mockResolvedValue([])),
      redis(jest.fn().mockRejectedValue(new Error('redis internal URL'))),
      new MetricsService(),
    );
    await expect(controller.ready()).rejects.toEqual(
      new ServiceUnavailableException('Service is not ready.'),
    );
  });

  it('waits for an already-claimed notification before worker shutdown completes', async () => {
    let release!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const service = new NotificationService(
      {} as DataSource,
      { send: jest.fn() },
      new MetricsService(),
    );
    (service as unknown as { inFlight: Promise<boolean> | null }).inFlight = pending;
    let stopped = false;
    const shutdown = service.onModuleDestroy().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release(true);
    await shutdown;
    expect(stopped).toBe(true);
  });
});

describe('shared Redis coordination', () => {
  it('increments and assigns expiry atomically for replica-safe rate limiting', async () => {
    const evalCommand = jest.fn().mockResolvedValue(7);
    const service = Object.create(OperationalRedisService.prototype) as OperationalRedisService;
    Object.defineProperty(service, 'client', {
      value: {
        isOpen: true,
        eval: evalCommand,
      },
    });
    await expect(
      service.incrementWithExpiry('margintra:ingestion-rate:key:minute', 120),
    ).resolves.toBe(7);
    expect(evalCommand).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR', KEYS[1])"),
      {
        keys: ['margintra:ingestion-rate:key:minute'],
        arguments: ['120'],
      },
    );
    expect(evalCommand.mock.calls[0]?.[0]).toContain("redis.call('EXPIRE', KEYS[1], ARGV[1])");
  });
});

describe('safe request observability', () => {
  afterEach(() => jest.restoreAllMocks());
  it('propagates a safe request ID and logs metadata without headers or secrets', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const middleware = new RequestObservabilityMiddleware(new MetricsService());
    let finish!: () => void;
    const request = {
      header: (name: string) => (name === 'x-request-id' ? 'correlation-123' : 'Bearer jwt-secret'),
      path: '/api/v1/customers/0277c196-699a-4be8-9568-1ea33c94f08a',
      method: 'GET',
      user: { organizationId: 'safe-organization-id' },
    } as unknown as ObservedRequest;
    const response = {
      statusCode: 200,
      setHeader: jest.fn(),
      once: (_event: string, callback: () => void) => {
        finish = callback;
      },
    };
    middleware.use(request, response as never, jest.fn());
    finish();
    expect(response.setHeader).toHaveBeenCalledWith('X-Request-Id', 'correlation-123');
    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain('correlation-123');
    expect(output).toContain('/api/v1/customers/:id');
    expect(output).not.toContain('jwt-secret');
  });
});

describe('production-critical configuration', () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env = {
      ...original,
      APP_ENV: 'development',
      WEB_ORIGIN: 'http://localhost:5173',
      JWT_SECRET: 'a'.repeat(32),
      DATABASE_URL: 'postgres://user:pass@localhost/db',
      REDIS_URL: 'redis://localhost:6379',
      STRIPE_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    };
  });
  afterAll(() => {
    process.env = original;
  });

  it('accepts valid database, Redis, JWT, Stripe, and public URL configuration', () => {
    expect(loadAppConfig()).toMatchObject({ port: 8080, runMigrations: true, trustProxyHops: 0 });
    expect(loadAuthConfig().secret).toHaveLength(32);
    expect(loadDatabaseConfig()).toMatchObject({
      poolMax: 10,
      poolIdleTimeoutMs: 30000,
      poolConnectionTimeoutMs: 5000,
    });
    expect(loadRedisConfig().url).toContain('redis:');
    expect(loadBillingConfig().encryptionKey).toBeTruthy();
  });

  it('validates explicit PostgreSQL pool limits and worker polling intervals', () => {
    process.env.DB_POOL_MAX = '12';
    process.env.DB_POOL_IDLE_TIMEOUT_MS = '45000';
    process.env.DB_POOL_CONNECTION_TIMEOUT_MS = '3000';
    process.env.NOTIFICATION_WORKER_INTERVAL_MS = '7000';
    expect(loadDatabaseConfig()).toMatchObject({
      poolMax: 12,
      poolIdleTimeoutMs: 45000,
      poolConnectionTimeoutMs: 3000,
    });
    expect(loadAppConfig().notificationWorkerIntervalMs).toBe(7000);
    process.env.DB_POOL_MAX = '0';
    expect(loadDatabaseConfig).toThrow('DB_POOL_MAX');
    process.env.DB_POOL_MAX = '10';
    process.env.NOTIFICATION_WORKER_INTERVAL_MS = '100';
    expect(loadAppConfig).toThrow('NOTIFICATION_WORKER_INTERVAL_MS');
  });

  it('fails fast with safe field-specific errors', () => {
    process.env.JWT_SECRET = 'short';
    expect(loadAuthConfig).toThrow('JWT_SECRET');
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = 'http://database';
    expect(loadDatabaseConfig).toThrow('DATABASE_URL');
    process.env.DATABASE_URL = 'postgres://localhost/db';
    process.env.REDIS_URL = 'http://redis';
    expect(loadRedisConfig).toThrow('REDIS_URL');
    process.env.REDIS_URL = 'redis://localhost';
    process.env.STRIPE_ENCRYPTION_KEY = 'invalid';
    expect(loadBillingConfig).toThrow('STRIPE_ENCRYPTION_KEY');
  });

  it('requires HTTPS public URLs in production', () => {
    process.env.APP_ENV = 'production';
    expect(loadAppConfig).toThrow('WEB_ORIGIN');
  });

  it('does not silently use a development Redis default in production', () => {
    process.env.APP_ENV = 'production';
    delete process.env.REDIS_URL;
    expect(loadRedisConfig).toThrow('REDIS_URL is required');
  });

  it('disables automatic migrations and makes demo seeding impossible in production', () => {
    process.env.APP_ENV = 'production';
    process.env.WEB_ORIGIN = 'https://app.example.com';
    process.env.SEED_DEMO_DATA = 'false';
    expect(loadAppConfig()).toMatchObject({
      runMigrations: false,
      seedDemoData: false,
      trustProxyHops: 2,
    });
    process.env.SEED_DEMO_DATA = 'true';
    expect(loadAppConfig).toThrow('SEED_DEMO_DATA');
  });
});
