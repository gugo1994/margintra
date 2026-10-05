import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AiModelPricingEntity,
  AiUsageEventEntity,
  IngestionApiKeyEntity,
  UsageEventProcessingEntity,
  UsageIngestionInboxEntity,
  PricingRefreshRequestEntity,
} from '../../database/entities';
import { CustomersModule } from '../customers/customers.module';
import { MarginModule } from '../margin/margin.module';
import { UsageController } from './controllers/usage.controller';
import { UsageRepository } from './repositories/usage.repository';
import { UsageIngestionService } from './services/usage-ingestion.service';
import { ApiKeyController } from './api-keys/api-key.controller';
import { ApiKeyRepository } from './api-keys/api-key.repository';
import { ApiKeyService } from './api-keys/api-key.service';
import { IngestionApiKeyGuard } from './api-keys/ingestion-api-key.guard';
import { IngestionController } from './controllers/ingestion.controller';
import { AiPricingService } from './pricing/ai-pricing.service';
import { OpenAiPricingAdapter } from './pricing/openai/openai-pricing.adapter';
import { PricingCatalogRepository } from './pricing/pricing-catalog.repository';
import { PricingCatalogSyncService } from './pricing/pricing-catalog-sync.service';
import { PricingOperationsService } from './pricing/pricing-operations.service';
import { PROVIDER_PRICING_ADAPTERS } from './pricing/provider-pricing.adapter';
import { PricingRefreshRequestService } from './pricing/pricing-refresh-request.service';
import { PricingRefreshService } from './pricing/pricing-refresh.service';
import { PricingRefreshWorkerService } from './pricing/pricing-refresh-worker.service';
import { IngestionInboxRepository } from './repositories/ingestion-inbox.repository';
import { IngestionRateLimitService } from './services/ingestion-rate-limit.service';
import { ProductionIngestionService } from './services/production-ingestion.service';
import { UsageProcessingService } from './services/usage-processing.service';
import { UsageReplayWorkerService } from './services/usage-replay-worker.service';
import { UsageInboxProcessorService } from './services/usage-inbox-processor.service';
import { UsageInboxWorkerService } from './services/usage-inbox-worker.service';
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiUsageEventEntity,
      IngestionApiKeyEntity,
      UsageEventProcessingEntity,
      UsageIngestionInboxEntity,
      AiModelPricingEntity,
      PricingRefreshRequestEntity,
    ]),
    CustomersModule,
    MarginModule,
  ],
  controllers: [UsageController, ApiKeyController, IngestionController],
  providers: [
    UsageRepository,
    UsageIngestionService,
    ApiKeyRepository,
    ApiKeyService,
    IngestionApiKeyGuard,
    AiPricingService,
    PricingCatalogRepository,
    PricingCatalogSyncService,
    PricingOperationsService,
    PricingRefreshRequestService,
    PricingRefreshService,
    PricingRefreshWorkerService,
    OpenAiPricingAdapter,
    {
      provide: PROVIDER_PRICING_ADAPTERS,
      inject: [OpenAiPricingAdapter],
      useFactory: (openai: OpenAiPricingAdapter) => [openai],
    },
    IngestionInboxRepository,
    ProductionIngestionService,
    IngestionRateLimitService,
    UsageProcessingService,
    UsageReplayWorkerService,
    UsageInboxProcessorService,
    UsageInboxWorkerService,
  ],
  exports: [
    UsageInboxWorkerService,
    PricingCatalogSyncService,
    PricingOperationsService,
    PricingRefreshService,
    PricingRefreshWorkerService,
  ],
})
export class AiUsageModule {}
