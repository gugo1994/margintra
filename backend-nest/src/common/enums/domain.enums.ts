export enum OrganizationRole {
  Owner = 'Owner',
  Admin = 'Admin',
  Member = 'Member',
}
export enum MarginStatus {
  Healthy = 'healthy',
  AtRisk = 'atRisk',
  Critical = 'critical',
  NoRevenue = 'noRevenue',
}
export enum BudgetState {
  Healthy = 'healthy',
  Warning = 'warning',
  Critical = 'critical',
}
export enum MarginAlertType {
  MarginBelowTarget = 'MarginBelowTarget',
  AiBudgetWarning = 'AiBudgetWarning',
  NoRevenueWithCost = 'NoRevenueWithCost',
  AiBudgetExceeded = 'AiBudgetExceeded',
  HighAiCost = 'HighAiCost',
}
export enum AlertSeverity {
  Info = 'Info',
  Warning = 'Warning',
  Critical = 'Critical',
}
export enum RevenueSource {
  Manual = 'Manual',
  Stripe = 'Stripe',
}
export enum StripeCustomerStatus {
  Active = 'Active',
  Deleted = 'Deleted',
  Unknown = 'Unknown',
}
export enum BillingProvider {
  Stripe = 'Stripe',
}
export enum StripeConnectionStatus {
  NotConnected = 'NotConnected',
  Connected = 'Connected',
  Syncing = 'Syncing',
  Error = 'Error',
}
export enum WebhookProcessingStatus {
  Processing = 'Processing',
  Processed = 'Processed',
  Failed = 'Failed',
}
export enum AiProvider {
  OpenAI = 'openai',
}
export enum AiCostSource {
  Explicit = 'explicit',
  Calculated = 'calculated',
}
export enum UsageProcessingStatus {
  Pending = 'pending',
  Processing = 'processing',
  Processed = 'processed',
  Failed = 'failed',
}
export enum InboxProcessingStatus {
  Pending = 'pending',
  Processing = 'processing',
  PendingPricing = 'pending_pricing',
  Processed = 'processed',
  Failed = 'failed',
}
export enum PricingStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}
export enum PricingSourceType {
  BuiltInMigration = 'built_in_migration',
  VerifiedManual = 'verified_manual',
  Provider = 'provider',
}
export enum IngestionApiKeyStatus {
  Active = 'active',
  Revoked = 'revoked',
}
