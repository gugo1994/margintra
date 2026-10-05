import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PricingRefreshRequestService } from './pricing-refresh-request.service';
import { PricingRefreshService } from './pricing-refresh.service';

@Injectable()
export class PricingRefreshWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PricingRefreshWorkerService.name);
  private timer?: NodeJS.Timeout;
  private inFlight: Promise<number> | null = null;
  private shuttingDown = false;

  constructor(
    private readonly requests: PricingRefreshRequestService,
    private readonly refreshService: PricingRefreshService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!(this.config.get<boolean>('app.pricingRefreshEnabled') ?? true)) return;
    const pollMs = this.config.get<number>('app.pricingRefreshPollIntervalMs') ?? 60_000;
    this.timer = setInterval(() => {
      this.tick();
    }, pollMs);
    this.timer.unref();
    this.tick();
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) clearInterval(this.timer);
    if (this.inFlight) await this.inFlight;
  }

  async processOne(): Promise<number> {
    if (this.shuttingDown) return 0;
    for (const provider of this.refreshService.providers())
      await this.requests.ensureProvider(provider);
    const claimTimeoutMs = this.config.get<number>('app.pricingRefreshClaimTimeoutMs') ?? 900_000;
    const request = await this.requests.claim(claimTimeoutMs);
    if (!request) return 0;
    const intervalMs = this.config.get<number>('app.pricingRefreshIntervalMs') ?? 43_200_000;
    try {
      const result = await this.refreshService.refresh(request.provider, request.requestedModels);
      if (result.busy) {
        await this.requests.fail(request.provider, 30_000, 'provider_refresh_busy');
        return 0;
      }
      await this.requests.complete(request.provider, intervalMs, !result.unavailable);
      return 1;
    } catch (error) {
      const retryMs = Math.min(intervalMs, 60_000 * 2 ** Math.min(request.attemptCount, 6));
      await this.requests.fail(
        request.provider,
        retryMs,
        error instanceof Error ? error.name : 'refresh_failure',
      );
      return 0;
    }
  }

  private tick(): void {
    if (this.shuttingDown || this.inFlight) return;
    this.inFlight = this.processOne()
      .catch((error: unknown) => {
        this.logger.error({
          event: 'PricingRefreshWorkerIterationFailed',
          errorType: error instanceof Error ? error.name : 'unknown',
        });
        return 0;
      })
      .finally(() => {
        this.inFlight = null;
      });
  }
}
