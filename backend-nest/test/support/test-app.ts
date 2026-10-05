import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import Stripe from 'stripe';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { CodedApplicationError } from '../../src/common/errors/application.error';
import { IngestionRateLimitService } from '../../src/modules/ai-usage/services/ingestion-rate-limit.service';
import {
  EMAIL_GATEWAY,
  EmailDeliveryRequest,
  EmailGateway,
  EmailGatewayError,
} from '../../src/modules/notifications/email.gateway';
import { NotificationService } from '../../src/modules/notifications/notification.service';
import { MarginService } from '../../src/modules/margin/services/margin.service';
import { UsageReplayWorkerService } from '../../src/modules/ai-usage/services/usage-replay-worker.service';
import { UsageInboxWorkerService } from '../../src/modules/ai-usage/services/usage-inbox-worker.service';
import { UsageInboxProcessorService } from '../../src/modules/ai-usage/services/usage-inbox-processor.service';
import { PricingCatalogSyncService } from '../../src/modules/ai-usage/pricing/pricing-catalog-sync.service';
import { PricingOperationsService } from '../../src/modules/ai-usage/pricing/pricing-operations.service';
import { AiPricingService } from '../../src/modules/ai-usage/pricing/ai-pricing.service';
import { PricingRefreshRequestService } from '../../src/modules/ai-usage/pricing/pricing-refresh-request.service';
import { PricingRefreshService } from '../../src/modules/ai-usage/pricing/pricing-refresh.service';
import { PricingRefreshWorkerService } from '../../src/modules/ai-usage/pricing/pricing-refresh-worker.service';
import {
  PricingCatalogCandidate,
  PROVIDER_PRICING_ADAPTERS,
  ProviderPricingAdapter,
} from '../../src/modules/ai-usage/pricing/provider-pricing.adapter';
import { AiProvider } from '../../src/common/enums/domain.enums';
import {
  IStripeGateway,
  STRIPE_GATEWAY,
  StripeAccountState,
  VerifiedStripeEvent,
} from '../../src/modules/billing/stripe/interfaces/stripe-gateway.interface';
import { StripeWebhookRetryService } from '../../src/modules/billing/stripe/services/stripe-webhook-retry.service';
import { DashboardService } from '../../src/modules/dashboard/services/dashboard.service';

export class FakeStripeGateway implements IStripeGateway {
  state: StripeAccountState = {
    account: { accountId: 'acct_nest_test', liveMode: false },
    customers: [],
    subscriptions: [],
  };
  fetchCalls = 0;
  fetchDelayMs = 0;
  fetchError: Error | null = null;
  verifyError: Error | null = null;
  fetchPlans: Array<{ state?: StripeAccountState; error?: Error; delayMs?: number }> = [];

  verify(): Promise<StripeAccountState['account']> {
    if (this.verifyError) return Promise.reject(this.verifyError);
    return Promise.resolve(this.state.account);
  }

  async fetch(): Promise<StripeAccountState> {
    this.fetchCalls += 1;
    const plan = this.fetchPlans.shift();
    const delayMs = plan?.delayMs ?? this.fetchDelayMs;
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const error = plan?.error ?? this.fetchError;
    if (error) throw error;
    return plan?.state ?? this.state;
  }

  verifyWebhook(payload: Buffer, signature: string, secret: string): VerifiedStripeEvent {
    const event = Stripe.webhooks.constructEvent(payload, signature, secret);
    return { id: event.id, type: event.type };
  }
}

export interface AuthSession {
  token: string;
  userId: string;
  organizationId: string;
}

export class FakeEmailGateway implements EmailGateway {
  readonly sent: EmailDeliveryRequest[] = [];
  failuresRemaining = 0;
  retryable = true;

  send(request: EmailDeliveryRequest): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      return Promise.reject(new EmailGatewayError(this.retryable));
    }
    this.sent.push(request);
    return Promise.resolve();
  }

  reset(): void {
    this.sent.length = 0;
    this.failuresRemaining = 0;
    this.retryable = true;
  }
}

export class FakePricingAdapter implements ProviderPricingAdapter {
  readonly provider = AiProvider.OpenAI;
  automaticSourceAvailable = false;
  candidates: PricingCatalogCandidate[] = [];
  calls: string[][] = [];
  delayMs = 0;
  error: Error | null = null;

  async discover(models: readonly string[]): Promise<PricingCatalogCandidate[]> {
    this.calls.push([...models]);
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.error) throw this.error;
    return this.candidates;
  }

  reset(): void {
    this.automaticSourceAvailable = false;
    this.candidates = [];
    this.calls = [];
    this.delayMs = 0;
    this.error = null;
  }
}

export class TestApp {
  app!: INestApplication;
  dataSource!: DataSource;
  readonly stripe = new FakeStripeGateway();
  readonly email = new FakeEmailGateway();
  notifications!: NotificationService;
  margins!: MarginService;
  usageReplay!: UsageReplayWorkerService;
  usageInbox!: UsageInboxWorkerService;
  usageInboxProcessor!: UsageInboxProcessorService;
  pricingCatalog!: PricingCatalogSyncService;
  pricingOperations!: PricingOperationsService;
  pricingRefresh!: PricingRefreshService;
  pricingRefreshRequests!: PricingRefreshRequestService;
  pricingRefreshWorker!: PricingRefreshWorkerService;
  readonly pricingAdapter = new FakePricingAdapter();
  aiPricing!: AiPricingService;
  stripeWebhookRetry!: StripeWebhookRetryService;
  dashboard!: DashboardService;
  readonly rateLimit = {
    reject: false,
    check: (apiKeyId: string) => {
      void apiKeyId;
      if (this.rateLimit.reject)
        return Promise.reject(
          new CodedApplicationError(429, 'RATE_LIMITED', 'The ingestion rate limit was exceeded.'),
        );
      return Promise.resolve();
    },
  };

  async start(): Promise<void> {
    process.env.USAGE_REPLAY_INTERVAL_MS = '60000';
    process.env.INGESTION_WORKER_ENABLED = 'false';
    process.env.PRICING_REFRESH_ENABLED = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STRIPE_GATEWAY)
      .useValue(this.stripe)
      .overrideProvider(IngestionRateLimitService)
      .useValue(this.rateLimit)
      .overrideProvider(EMAIL_GATEWAY)
      .useValue(this.email)
      .overrideProvider(PROVIDER_PRICING_ADAPTERS)
      .useValue([this.pricingAdapter])
      .compile();
    this.app = module.createNestApplication({ rawBody: true });
    this.app.setGlobalPrefix('api/v1', {
      exclude: [
        { path: 'health/live', method: RequestMethod.GET },
        { path: 'health/ready', method: RequestMethod.GET },
        { path: 'metrics', method: RequestMethod.GET },
      ],
    });
    this.app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await this.app.init();
    this.dataSource = this.app.get(DataSource);
    this.notifications = this.app.get(NotificationService);
    this.margins = this.app.get(MarginService);
    this.usageReplay = this.app.get(UsageReplayWorkerService);
    this.usageInbox = this.app.get(UsageInboxWorkerService);
    this.usageInboxProcessor = this.app.get(UsageInboxProcessorService);
    this.pricingCatalog = this.app.get(PricingCatalogSyncService);
    this.pricingOperations = this.app.get(PricingOperationsService);
    this.pricingRefresh = this.app.get(PricingRefreshService);
    this.pricingRefreshRequests = this.app.get(PricingRefreshRequestService);
    this.pricingRefreshWorker = this.app.get(PricingRefreshWorkerService);
    this.aiPricing = this.app.get(AiPricingService);
    this.stripeWebhookRetry = this.app.get(StripeWebhookRetryService);
    this.dashboard = this.app.get(DashboardService);
  }

  close(): Promise<void> {
    return this.app.close();
  }
  server(): Parameters<typeof request>[0] {
    return this.app.getHttpServer() as Parameters<typeof request>[0];
  }

  async register(prefix: string): Promise<AuthSession> {
    const email = `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
    const response = await request(this.server())
      .post('/api/v1/auth/register')
      .send({ email, password: 'Password123!', organizationName: prefix })
      .expect(201);
    return {
      token: response.body.accessToken as string,
      userId: response.body.userId as string,
      organizationId: response.body.organizationId as string,
    };
  }

  auth(token: string): string {
    return `Bearer ${token}`;
  }

  async customer(session: AuthSession, externalId: string, revenue = 100) {
    const response = await request(this.server())
      .post('/api/v1/customers')
      .set('Authorization', this.auth(session.token))
      .send({
        externalCustomerId: externalId,
        name: externalId,
        email: null,
        monthlyRevenue: revenue,
        currency: 'USD',
      })
      .expect(201);
    return response.body as { id: string; monthlyRevenue: number; revenueSource: string };
  }

  usage(session: AuthSession, customerId: string, cost: number, requestId: string) {
    return request(this.server())
      .post('/api/v1/usage')
      .set('Authorization', this.auth(session.token))
      .send({
        customerId,
        provider: 'openai',
        model: 'gpt-5',
        feature: 'chat',
        inputTokens: 100,
        outputTokens: 25,
        cost,
        externalRequestId: requestId,
        occurredAt: new Date().toISOString(),
      });
  }

  connect(session: AuthSession, webhookSecret = 'whsec_test_secret') {
    return request(this.server())
      .post('/api/v1/integrations/stripe/connect')
      .set('Authorization', this.auth(session.token))
      .send({ secretKey: 'rk_test_boundary_fake', webhookSecret });
  }

  sync(session: AuthSession) {
    return request(this.server())
      .post('/api/v1/integrations/stripe/sync')
      .set('Authorization', this.auth(session.token));
  }

  subscription(id: string, customerId: string, mrr: string, status = 'active') {
    return {
      id,
      customerId,
      name: 'Pro',
      status,
      currency: 'USD',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 2_592_000_000),
      cancelAtPeriodEnd: false,
      monthlyRecurringRevenue: mrr,
      warning: null,
    };
  }

  signature(payload: string, secret: string): string {
    return Stripe.webhooks.generateTestHeaderString({ payload, secret });
  }
}
