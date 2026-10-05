import Decimal from 'decimal.js';
import {
  countsAsRevenue,
  normalizeMrr,
  subscriptionRevenueMrr,
} from '../../src/modules/billing/stripe/helpers/mrr-normalizer';

const charge = (
  unitAmountMinor: string,
  quantity: number,
  interval = 'month',
  intervalCount = 1,
) => ({
  unitAmountMinor,
  quantity,
  currency: 'usd',
  interval,
  intervalCount,
  usageType: 'licensed',
  billingScheme: 'per_unit',
  hasTransformQuantity: false,
});

describe('MRR normalization', () => {
  it.each([
    [charge('10000', 1), '100.000000'],
    [charge('120000', 1, 'year'), '100.000000'],
    [charge('30000', 1, 'month', 3), '100.000000'],
    [charge('2000', 10), '200.000000'],
    [charge('10000', 1, 'week'), new Decimal(100).mul(52).div(12).toFixed(6)],
    [charge('10000', 1, 'day'), new Decimal(100).mul(365).div(12).toFixed(6)],
  ])('normalizes recurring charge %#', (input, expected) => {
    expect(normalizeMrr('USD', [input]).monthlyRecurringRevenue).toBe(expected);
  });

  it('sums multiple subscription items exactly', () => {
    expect(
      normalizeMrr('USD', [charge('9900', 1), charge('4900', 1)]).monthlyRecurringRevenue,
    ).toBe('148.000000');
  });

  it('excludes transformed package pricing with a clear warning', () => {
    const result = normalizeMrr('USD', [{ ...charge('1000', 25), hasTransformQuantity: true }]);
    expect(result.monthlyRecurringRevenue).toBe('0.000000');
    expect(result.warning).toContain('transform_quantity');
  });

  it('continues to normalize ordinary licensed per-unit pricing', () => {
    const result = normalizeMrr('USD', [charge('2500', 2)]);
    expect(result.monthlyRecurringRevenue).toBe('50.000000');
    expect(result.warning).toBeNull();
  });

  it('preserves supported fixed MRR in a mixed fixed and transformed subscription', () => {
    const result = normalizeMrr('USD', [
      charge('4900', 1),
      { ...charge('1000', 25), hasTransformQuantity: true },
    ]);
    expect(result.monthlyRecurringRevenue).toBe('49.000000');
    expect(result.warning).toContain('transform_quantity');
  });

  it('excludes incompatible currency and metered pricing with warnings', () => {
    const result = normalizeMrr('USD', [
      { ...charge('1000', 1), currency: 'eur' },
      { ...charge('1000', 1), usageType: 'metered' },
    ]);
    expect(result.monthlyRecurringRevenue).toBe('0.000000');
    expect(result.warning).toContain('Currency EUR');
    expect(result.warning).toContain('Metered');
  });

  it('does not silently guess tiered, missing-price, or discounted billing', () => {
    const unsupported = normalizeMrr('USD', [{ ...charge('1000', 1), billingScheme: 'tiered' }]);
    expect(unsupported.monthlyRecurringRevenue).toBe('0.000000');
    expect(unsupported.warning).toContain('tiered');
    const discounted = normalizeMrr('USD', [charge('9900', 1)], true);
    expect(discounted.monthlyRecurringRevenue).toBe('99.000000');
    expect(discounted.warning).toContain('list price');
  });

  it.each(['active', 'past_due'])('counts %s subscriptions as revenue', (status) => {
    expect(countsAsRevenue(status)).toBe(true);
  });

  it.each(['trialing', 'incomplete', 'incomplete_expired', 'unpaid', 'paused', 'canceled'])(
    'does not count %s subscriptions as revenue',
    (status) => {
      expect(countsAsRevenue(status)).toBe(false);
      expect(
        subscriptionRevenueMrr({ status, cancelAtPeriodEnd: false, normalizedMrr: '99.000000' }),
      ).toBe('0');
    },
  );

  it.each(['active', 'past_due'])(
    'continues to count %s subscriptions when cancellation is scheduled',
    (status) => {
      expect(
        subscriptionRevenueMrr({ status, cancelAtPeriodEnd: true, normalizedMrr: '99.000000' }),
      ).toBe('99.000000');
    },
  );
});
