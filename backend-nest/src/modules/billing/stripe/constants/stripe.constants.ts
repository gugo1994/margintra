export const STRIPE_EVENT = {
  CustomerCreated: 'customer.created',
  CustomerUpdated: 'customer.updated',
  CustomerDeleted: 'customer.deleted',
  SubscriptionCreated: 'customer.subscription.created',
  SubscriptionUpdated: 'customer.subscription.updated',
  SubscriptionDeleted: 'customer.subscription.deleted',
  SubscriptionPaused: 'customer.subscription.paused',
  SubscriptionResumed: 'customer.subscription.resumed',
  PriceUpdated: 'price.updated',
  ProductUpdated: 'product.updated',
} as const;
export const STRIPE_SYNC_EVENTS = new Set<string>(Object.values(STRIPE_EVENT));
export const STRIPE_SUBSCRIPTION_EXPANSIONS = ['data.items.data.price'] as const;
export const STRIPE_PAGE_SIZE = 100;
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;
