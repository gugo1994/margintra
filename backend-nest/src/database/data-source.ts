import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as entities from './entities';
import { NestBackendBaseline1787737000000 } from './migrations/1787737000000-NestBackendBaseline';
import { TenantSafeForeignKeys1787737100000 } from './migrations/1787737100000-TenantSafeForeignKeys';
import { AutomaticUsageIngestion1787737200000 } from './migrations/1787737200000-AutomaticUsageIngestion';
import { OrganizationOnboarding1787737300000 } from './migrations/1787737300000-OrganizationOnboarding';
import { CustomerRevenueHistory1787737400000 } from './migrations/1787737400000-CustomerRevenueHistory';
import { BudgetGuardrails1787737500000 } from './migrations/1787737500000-BudgetGuardrails';
import { HistoricalGuardrails1787737600000 } from './migrations/1787737600000-HistoricalGuardrails';
import { AlertNotifications1787737700000 } from './migrations/1787737700000-AlertNotifications';
import { DurableUsageAcceptance1787737800000 } from './migrations/1787737800000-DurableUsageAcceptance';
import { UsageReplayScheduling1787737900000 } from './migrations/1787737900000-UsageReplayScheduling';
import { PostgreSqlScalingIndexes1787738000000 } from './migrations/1787738000000-PostgreSqlScalingIndexes';
import { StripeSyncAttemptFencing1787738100000 } from './migrations/1787738100000-StripeSyncAttemptFencing';
import { StripeWebhookRetries1787738200000 } from './migrations/1787738200000-StripeWebhookRetries';
import { RevenueSnapshotSequence1787738300000 } from './migrations/1787738300000-RevenueSnapshotSequence';
import { AsyncUsageInboxPricingCatalog1787738400000 } from './migrations/1787738400000-AsyncUsageInboxPricingCatalog';
import { PricingCanonicalModel1787738500000 } from './migrations/1787738500000-PricingCanonicalModel';
import { ProtectPricingHistory1787738600000 } from './migrations/1787738600000-ProtectPricingHistory';
import { BackfillUsageInbox1787738700000 } from './migrations/1787738700000-BackfillUsageInbox';
import { PricingOperationsAudit1787738800000 } from './migrations/1787738800000-PricingOperationsAudit';
import { PricingActionActors1787738900000 } from './migrations/1787738900000-PricingActionActors';
import { PricingRefreshRequests1787739000000 } from './migrations/1787739000000-PricingRefreshRequests';
const positiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error('Database pool configuration is invalid');
  return parsed;
};
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  extra: {
    max: positiveInteger(process.env.DB_POOL_MAX, 10),
    idleTimeoutMillis: positiveInteger(process.env.DB_POOL_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMillis: positiveInteger(process.env.DB_POOL_CONNECTION_TIMEOUT_MS, 5_000),
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
});
