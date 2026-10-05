import Decimal from 'decimal.js';
export interface RecurringCharge {
  unitAmountMinor: string | null;
  quantity: number;
  currency: string;
  interval: string;
  intervalCount: number;
  usageType: string;
  billingScheme: string;
  hasTransformQuantity: boolean;
}
const REVENUE_STATUSES = new Set(['active', 'past_due']);

export const countsAsRevenue = (status: string) => REVENUE_STATUSES.has(status.toLowerCase());

export const subscriptionRevenueMrr = (subscription: {
  status: string;
  cancelAtPeriodEnd: boolean;
  normalizedMrr: string;
}) => (countsAsRevenue(subscription.status) ? subscription.normalizedMrr : '0');
export const normalizeMrr = (
  reportingCurrency: string,
  charges: RecurringCharge[],
  hasDiscount = false,
) => {
  const currency = reportingCurrency.toUpperCase();
  let total = new Decimal(0);
  const warnings: string[] = [];
  for (const charge of charges) {
    if (charge.currency.toUpperCase() !== currency) {
      warnings.push(
        `Currency ${charge.currency.toUpperCase()} is excluded; organization reporting currency is ${currency}.`,
      );
      continue;
    }
    if (charge.hasTransformQuantity) {
      warnings.push('Package pricing using transform_quantity is excluded from MRR.');
      continue;
    }
    if (
      charge.usageType !== 'licensed' ||
      charge.billingScheme !== 'per_unit' ||
      charge.unitAmountMinor === null
    ) {
      warnings.push('Metered, tiered, or custom pricing is excluded from MRR.');
      continue;
    }
    const billed = new Decimal(charge.unitAmountMinor).div(100).mul(charge.quantity);
    switch (charge.interval) {
      case 'month':
        total = total.plus(billed.div(charge.intervalCount));
        break;
      case 'year':
        total = total.plus(billed.div(new Decimal(12).mul(charge.intervalCount)));
        break;
      case 'week':
        total = total.plus(billed.mul(52).div(new Decimal(12).mul(charge.intervalCount)));
        break;
      case 'day':
        total = total.plus(billed.mul(365).div(new Decimal(12).mul(charge.intervalCount)));
        break;
      default:
        warnings.push('Unsupported recurring interval is excluded from MRR.');
    }
  }
  if (hasDiscount)
    warnings.push('Stripe discounts are not applied; MRR uses recurring list price.');
  return {
    monthlyRecurringRevenue: total.toFixed(6),
    currency,
    warning: [...new Set(warnings)].join(' ') || null,
  };
};
