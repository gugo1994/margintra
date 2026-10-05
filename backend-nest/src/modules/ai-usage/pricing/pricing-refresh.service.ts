import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AiProvider } from '../../../common/enums/domain.enums';
import { MetricsService } from '../../operations/metrics.service';
import { PricingCatalogSyncService } from './pricing-catalog-sync.service';
import { PROVIDER_PRICING_ADAPTERS, ProviderPricingAdapter } from './provider-pricing.adapter';

export interface PricingRefreshResult {
  provider: AiProvider;
  checked: number;
  unchanged: number;
  pendingCreated: number;
  unavailable: boolean;
  busy: boolean;
}

@Injectable()
export class PricingRefreshService {
  private readonly logger = new Logger(PricingRefreshService.name);
  constructor(
    private readonly dataSource: DataSource,
    private readonly catalog: PricingCatalogSyncService,
    @Inject(PROVIDER_PRICING_ADAPTERS) private readonly adapters: ProviderPricingAdapter[],
    private readonly metrics: MetricsService,
  ) {}

  providers(): AiProvider[] {
    return this.adapters.map((adapter) => adapter.provider);
  }

  async refresh(
    provider: AiProvider,
    models: readonly string[] = [],
  ): Promise<PricingRefreshResult> {
    const adapter = new Map(this.adapters.map((item) => [item.provider, item])).get(provider);
    if (!adapter)
      return {
        provider,
        checked: 0,
        unchanged: 0,
        pendingCreated: 0,
        unavailable: true,
        busy: false,
      };
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    const lockKey = `PRICING_REFRESH:${provider}`;
    try {
      const lock = (await runner.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',
        [lockKey],
      )) as Array<{ acquired: boolean }>;
      if (!lock[0]?.acquired)
        return {
          provider,
          checked: 0,
          unchanged: 0,
          pendingCreated: 0,
          unavailable: false,
          busy: true,
        };
      this.metrics.pricingRefresh('attempt', provider);
      if (!adapter.automaticSourceAvailable) {
        this.metrics.pricingRefresh('unavailable', provider);
        this.logger.warn({
          event: 'PricingAutomaticSourceUnavailable',
          provider,
          manualVerificationRequired: true,
        });
        return {
          provider,
          checked: 0,
          unchanged: 0,
          pendingCreated: 0,
          unavailable: true,
          busy: false,
        };
      }
      const candidates = await adapter.discover([...new Set(models.map((model) => model.trim()))]);
      let unchanged = 0;
      let pendingCreated = 0;
      for (const raw of candidates) {
        const outcome = await this.catalog.applyCandidateWithOutcome(this.catalog.normalize(raw));
        if (outcome.created) pendingCreated += 1;
        else unchanged += 1;
      }
      this.metrics.pricingRefresh('success', provider);
      this.metrics.pricingRefreshCandidates(provider, unchanged, pendingCreated);
      this.metrics.pricingRefreshSucceededAt(provider, new Date());
      this.logger.log({
        event: 'PricingRefreshSucceeded',
        provider,
        checked: candidates.length,
        unchanged,
        pendingCreated,
      });
      return {
        provider,
        checked: candidates.length,
        unchanged,
        pendingCreated,
        unavailable: false,
        busy: false,
      };
    } catch (error) {
      this.metrics.pricingRefresh('failure', provider);
      this.logger.error({
        event: 'PricingRefreshFailed',
        provider,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      throw error;
    } finally {
      try {
        await runner.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockKey]);
      } finally {
        await runner.release();
      }
    }
  }
}
