import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationExceptionFilter } from './common/filters/application-exception.filter';
import { JwtTenantGuard } from './common/guards/jwt-tenant.guard';
import {
  appConfig,
  authConfig,
  billingConfig,
  databaseConfig,
  emailConfig,
  redisConfig,
} from './config/configuration';
import * as entities from './database/entities';
import { NestBackendBaseline1787737000000 } from './database/migrations/1787737000000-NestBackendBaseline';
import { TenantSafeForeignKeys1787737100000 } from './database/migrations/1787737100000-TenantSafeForeignKeys';
import { AutomaticUsageIngestion1787737200000 } from './database/migrations/1787737200000-AutomaticUsageIngestion';
import { OrganizationOnboarding1787737300000 } from './database/migrations/1787737300000-OrganizationOnboarding';
import { CustomerRevenueHistory1787737400000 } from './database/migrations/1787737400000-CustomerRevenueHistory';
import { BudgetGuardrails1787737500000 } from './database/migrations/1787737500000-BudgetGuardrails';
import { HistoricalGuardrails1787737600000 } from './database/migrations/1787737600000-HistoricalGuardrails';
import { AlertNotifications1787737700000 } from './database/migrations/1787737700000-AlertNotifications';
import { DurableUsageAcceptance1787737800000 } from './database/migrations/1787737800000-DurableUsageAcceptance';
import { UsageReplayScheduling1787737900000 } from './database/migrations/1787737900000-UsageReplayScheduling';
import { PostgreSqlScalingIndexes1787738000000 } from './database/migrations/1787738000000-PostgreSqlScalingIndexes';
import { StripeSyncAttemptFencing1787738100000 } from './database/migrations/1787738100000-StripeSyncAttemptFencing';
import { StripeWebhookRetries1787738200000 } from './database/migrations/1787738200000-StripeWebhookRetries';
import { RevenueSnapshotSequence1787738300000 } from './database/migrations/1787738300000-RevenueSnapshotSequence';
import { AsyncUsageInboxPricingCatalog1787738400000 } from './database/migrations/1787738400000-AsyncUsageInboxPricingCatalog';
import { PricingCanonicalModel1787738500000 } from './database/migrations/1787738500000-PricingCanonicalModel';
import { ProtectPricingHistory1787738600000 } from './database/migrations/1787738600000-ProtectPricingHistory';
import { BackfillUsageInbox1787738700000 } from './database/migrations/1787738700000-BackfillUsageInbox';
import { PricingOperationsAudit1787738800000 } from './database/migrations/1787738800000-PricingOperationsAudit';
import { PricingActionActors1787738900000 } from './database/migrations/1787738900000-PricingActionActors';
import { PricingRefreshRequests1787739000000 } from './database/migrations/1787739000000-PricingRefreshRequests';
import { DemoSeedService } from './database/seeds/demo-seed.service';
import { AuthModule } from './modules/auth/auth.module';
import { CustomersModule } from './modules/customers/customers.module';
import { AiUsageModule } from './modules/ai-usage/ai-usage.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SettingsModule } from './modules/settings/settings.module';
import { BillingModule } from './modules/billing/stripe/billing.module';
import { MarginModule } from './modules/margin/margin.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { NotificationModule } from './modules/notifications/notification.module';
import { OperationsModule } from './modules/operations/operations.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, authConfig, databaseConfig, redisConfig, billingConfig, emailConfig],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('database.url'),
        extra: {
          max: config.getOrThrow<number>('database.poolMax'),
          idleTimeoutMillis: config.getOrThrow<number>('database.poolIdleTimeoutMs'),
          connectionTimeoutMillis: config.getOrThrow<number>('database.poolConnectionTimeoutMs'),
        },
        entities: Object.values(entities),
        migrations: [
          NestBackendBaseline1787737000000,
          TenantSafeForeignKeys1787737100000,
          AutomaticUsageIngestion1787737200000,
          OrganizationOnboarding1787737300000,
          CustomerRevenueHistory1787737400000,
          BudgetGuardrails1787737500000,
          HistoricalGuardrails1787737600000,
          AlertNotifications1787737700000,
          DurableUsageAcceptance1787737800000,
          UsageReplayScheduling1787737900000,
          PostgreSqlScalingIndexes1787738000000,
          StripeSyncAttemptFencing1787738100000,
          StripeWebhookRetries1787738200000,
          RevenueSnapshotSequence1787738300000,
          AsyncUsageInboxPricingCatalog1787738400000,
          PricingCanonicalModel1787738500000,
          ProtectPricingHistory1787738600000,
          BackfillUsageInbox1787738700000,
          PricingOperationsAudit1787738800000,
          PricingActionActors1787738900000,
          PricingRefreshRequests1787739000000,
        ],
        synchronize: false,
        migrationsRun: config.getOrThrow<boolean>('app.runMigrations'),
        logging: false,
      }),
    }),
    TypeOrmModule.forFeature([
      entities.UserEntity,
      entities.CustomerEntity,
      entities.AiUsageEventEntity,
      entities.IngestionApiKeyEntity,
    ]),
    OperationsModule,
    AuthModule,
    MarginModule,
    CustomersModule,
    AiUsageModule,
    DashboardModule,
    SettingsModule,
    BillingModule,
    OnboardingModule,
    NotificationModule,
  ],
  controllers: [],
  providers: [
    DemoSeedService,
    { provide: APP_GUARD, useClass: JwtTenantGuard },
    { provide: APP_FILTER, useClass: ApplicationExceptionFilter },
  ],
})
export class AppModule {}
