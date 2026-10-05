export interface StripeVerifiedAccount {
  accountId: string;
  liveMode: boolean;
}
export interface StripeCustomerState {
  id: string;
  name: string | null;
  email: string | null;
  deleted: boolean;
}
export interface StripeSubscriptionState {
  id: string;
  customerId: string;
  name: string;
  status: string;
  currency: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  monthlyRecurringRevenue: string;
  warning: string | null;
}
export interface StripeAccountState {
  account: StripeVerifiedAccount;
  customers: StripeCustomerState[];
  subscriptions: StripeSubscriptionState[];
}
export interface VerifiedStripeEvent {
  id: string;
  type: string;
}
export interface IStripeGateway {
  verify(secretKey: string): Promise<StripeVerifiedAccount>;
  fetch(secretKey: string, reportingCurrency: string): Promise<StripeAccountState>;
  verifyWebhook(payload: Buffer, signature: string, secret: string): VerifiedStripeEvent;
}
export const STRIPE_GATEWAY = Symbol('STRIPE_GATEWAY');
