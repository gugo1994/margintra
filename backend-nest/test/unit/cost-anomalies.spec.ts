import { DashboardRepository } from '../../src/modules/dashboard/repositories/dashboard.repository';
import { DashboardService } from '../../src/modules/dashboard/services/dashboard.service';
import { AnalyticsRangeService } from '../../src/modules/dashboard/services/analytics-range.service';
import { MarginCalculator } from '../../src/modules/margin/calculators/margin-calculator';

type CostCustomer = {
  customerId: string;
  name: string;
  stripeCustomerStatus: string;
  aiCost: number;
};
type CostDimension = { name: string; cost: number };
type CostAnomaly = {
  dimension: 'customer' | 'feature' | 'model';
  name: string;
  customerId?: string;
  absoluteIncrease: number;
  percentageIncrease: number | null;
};

describe('Overview cost anomalies', () => {
  const service = new DashboardService(
    {} as DashboardRepository,
    new MarginCalculator(),
    new AnalyticsRangeService(),
  );
  const detect = (
    customers: CostCustomer[],
    previousCustomers: CostCustomer[],
    features: CostDimension[] = [],
    previousFeatures: CostDimension[] = [],
    models: CostDimension[] = [],
    previousModels: CostDimension[] = [],
  ) =>
    (
      service as unknown as {
        costAnomalies(
          customers: CostCustomer[],
          previousCustomers: CostCustomer[],
          features: CostDimension[],
          previousFeatures: CostDimension[],
          models: CostDimension[],
          previousModels: CostDimension[],
        ): CostAnomaly[];
      }
    ).costAnomalies(
      customers,
      previousCustomers,
      features,
      previousFeatures,
      models,
      previousModels,
    );

  it('requires both thresholds, excludes deleted customers, and ranks by absolute increase', () => {
    const anomalies = detect(
      [
        {
          customerId: 'active',
          name: 'Active customer',
          stripeCustomerStatus: 'active',
          aiCost: 25,
        },
        {
          customerId: 'deleted',
          name: 'Deleted customer',
          stripeCustomerStatus: 'deleted',
          aiCost: 100,
        },
      ],
      [
        {
          customerId: 'active',
          name: 'Active customer',
          stripeCustomerStatus: 'active',
          aiCost: 10,
        },
        {
          customerId: 'deleted',
          name: 'Deleted customer',
          stripeCustomerStatus: 'active',
          aiCost: 1,
        },
      ],
      [
        { name: 'large-but-low-percent', cost: 20 },
        { name: 'new-feature', cost: 5 },
      ],
      [{ name: 'large-but-low-percent', cost: 15 }],
      [{ name: 'small-absolute-change', cost: 4 }],
      [{ name: 'small-absolute-change', cost: 1 }],
    );

    expect(anomalies.map((anomaly) => anomaly.name)).toEqual(['Active customer', 'new-feature']);
    expect(anomalies[0]).toMatchObject({ absoluteIncrease: 15, percentageIncrease: 150 });
    expect(anomalies[1]).toMatchObject({ absoluteIncrease: 5, percentageIncrease: null });
  });

  it('returns only the three strongest qualifying anomalies', () => {
    const anomalies = detect(
      [],
      [],
      [
        { name: 'feature-a', cost: 20 },
        { name: 'feature-b', cost: 15 },
      ],
      [],
      [
        { name: 'model-a', cost: 30 },
        { name: 'model-b', cost: 10 },
      ],
      [],
    );
    expect(anomalies.map((anomaly) => anomaly.name)).toEqual(['model-a', 'feature-a', 'feature-b']);
  });
});
