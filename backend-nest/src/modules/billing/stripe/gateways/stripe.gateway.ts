import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import {
  STRIPE_PAGE_SIZE,
  STRIPE_SUBSCRIPTION_EXPANSIONS,
  STRIPE_WEBHOOK_TOLERANCE_SECONDS,
} from '../constants/stripe.constants';
import { normalizeMrr, subscriptionRevenueMrr } from '../helpers/mrr-normalizer';
import {
  IStripeGateway,
  StripeAccountState,
  StripeSubscriptionState,
} from '../interfaces/stripe-gateway.interface';
export class StripeOperationError extends Error {
  constructor(
    public readonly operation: string,
    public readonly stripeError: Stripe.errors.StripeError,
  ) {
    super(stripeError.message);
  }
}
@Injectable()
export class OfficialStripeGateway implements IStripeGateway {
  async verify(secretKey: string) {
    const stripe = new Stripe(secretKey);
    const account = await this.execute('retrieving account', () => stripe.accounts.retrieve());
    await this.execute('listing customers', () => stripe.customers.list({ limit: 1 }));
    await this.execute('listing subscriptions', () =>
      stripe.subscriptions.list({ limit: 1, status: 'all' }),
    );
    await this.execute('listing prices', () => stripe.prices.list({ limit: 1 }));
    await this.execute('listing products', () => stripe.products.list({ limit: 1 }));
    return { accountId: account.id, liveMode: secretKey.includes('_live_') };
  }
  async fetch(secretKey: string, reportingCurrency: string): Promise<StripeAccountState> {
    const stripe = new Stripe(secretKey);
    const account = await this.verify(secretKey);
    const customers: StripeAccountState['customers'] = [];
    try {
      for await (const customer of stripe.customers.list({ limit: STRIPE_PAGE_SIZE }))
        customers.push({
          id: customer.id,
          name: customer.name ?? null,
          email: customer.email ?? null,
          deleted: false,
        });
    } catch (error) {
      throw this.wrap('listing customers', error);
    }
    const subscriptions: StripeSubscriptionState[] = [];
    try {
      for await (const subscription of stripe.subscriptions.list({
        limit: STRIPE_PAGE_SIZE,
        status: 'all',
        expand: [...STRIPE_SUBSCRIPTION_EXPANSIONS],
      })) {
        let items = [...subscription.items.data];
        if (subscription.items.has_more) {
          items = [];
          try {
            for await (const item of stripe.subscriptionItems.list({
              subscription: subscription.id,
              limit: STRIPE_PAGE_SIZE,
              expand: ['data.price'],
            }))
              items.push(item);
          } catch (error) {
            throw this.wrap('listing subscription items with price expansion', error);
          }
        }
        const charges = items.map((item) => ({
          unitAmountMinor:
            item.price.unit_amount_decimal ??
            (item.price.unit_amount === null ? null : String(item.price.unit_amount)),
          quantity: item.quantity ?? 0,
          currency: item.price.currency,
          interval: item.price.recurring?.interval ?? '',
          intervalCount: item.price.recurring?.interval_count ?? 0,
          usageType: item.price.recurring?.usage_type ?? '',
          billingScheme: item.price.billing_scheme,
          hasTransformQuantity: Boolean(item.price.transform_quantity),
        }));
        const normalized = normalizeMrr(
          reportingCurrency,
          charges,
          subscription.discounts.length > 0,
        );
        const periods = items as Array<
          Stripe.SubscriptionItem & { current_period_start?: number; current_period_end?: number }
        >;
        const starts = periods.flatMap((x) =>
          x.current_period_start ? [x.current_period_start] : [],
        );
        const ends = periods.flatMap((x) => (x.current_period_end ? [x.current_period_end] : []));
        subscriptions.push({
          id: subscription.id,
          customerId:
            typeof subscription.customer === 'string'
              ? subscription.customer
              : subscription.customer.id,
          name:
            items.find((x) => x.price.nickname)?.price.nickname ??
            subscription.description ??
            subscription.id,
          status: subscription.status,
          currency: normalized.currency,
          currentPeriodStart: starts.length ? new Date(Math.min(...starts) * 1000) : null,
          currentPeriodEnd: ends.length ? new Date(Math.max(...ends) * 1000) : null,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          monthlyRecurringRevenue: subscriptionRevenueMrr({
            status: subscription.status,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            normalizedMrr: normalized.monthlyRecurringRevenue,
          }),
          warning: normalized.warning,
        });
      }
    } catch (error) {
      if (error instanceof StripeOperationError) throw error;
      throw this.wrap('listing subscriptions with price expansion', error);
    }
    return { account, customers, subscriptions };
  }
  verifyWebhook(payload: Buffer, signature: string, secret: string) {
    const stripe = new Stripe('sk_test_signature_verification_only');
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      secret,
      STRIPE_WEBHOOK_TOLERANCE_SECONDS,
    );
    return { id: event.id, type: event.type };
  }
  private async execute<T>(operation: string, action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      throw this.wrap(operation, error);
    }
  }
  private wrap(operation: string, error: unknown): StripeOperationError {
    if (error instanceof Stripe.errors.StripeError)
      return new StripeOperationError(operation, error);
    throw error;
  }
}
