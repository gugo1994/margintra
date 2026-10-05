import { STRIPE_SUBSCRIPTION_EXPANSIONS } from '../../src/modules/billing/stripe/constants/stripe.constants';

describe('Stripe subscription expansions', () => {
  it('expands subscription item prices without exceeding Stripe depth', () => {
    expect(STRIPE_SUBSCRIPTION_EXPANSIONS).toEqual(['data.items.data.price']);
  });

  it('never requests the invalid nested product expansion', () => {
    expect(STRIPE_SUBSCRIPTION_EXPANSIONS).not.toContain('data.items.data.price.product');
  });
});
