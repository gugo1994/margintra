import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  BudgetState,
  MarginStatus,
  StripeCustomerStatus,
} from '../../../common/enums/domain.enums';
import { decimalNumber } from '../../../common/helpers/decimal-response.helper';
import { MarginCalculator } from '../../margin/calculators/margin-calculator';
import {
  CustomerForecastUsageRow,
  DashboardRepository,
} from '../repositories/dashboard.repository';
import {
  AnalyticsCustomerStatus,
  AnalyticsQueryDto,
  CustomerProfitabilityHistoryQueryDto,
} from '../dto/analytics-query.dto';
import { AnalyticsRangeService } from './analytics-range.service';
import { NotFoundError } from '../../../common/errors/application.error';
import { MarginRepository } from '../../margin/repositories/margin.repository';

export interface ForecastCalculation {
  forecastStatus: 'available' | 'insufficient_data';
  asOf: string;
  revenue: number;
  currentMonthAiCost: number;
  recentWindowDays: number;
  recentDailyAverageCost: number;
  allowedAiBudget: number;
  remainingBudget: number;
  budgetExhausted: boolean;
  projectedMonthEndAiCost: number | null;
  projectedRemainingBudget: number | null;
  projectedGrossProfit: number | null;
  projectedGrossMargin: number | null;
  budgetExhaustionDate: string | null;
}
@Injectable()
export class DashboardService {
  constructor(
    private readonly repository: DashboardRepository,
    private readonly calculator: MarginCalculator,
    private readonly ranges: AnalyticsRangeService,
    @Optional() private readonly marginRepository?: MarginRepository,
  ) {}
  async overview(org: string) {
    const [guardrails, rows] = await Promise.all([
      this.repository.guardrails(org),
      this.repository.rows(org),
    ]);
    const revenue = Decimal.sum(0, ...rows.map((x) => x.revenue));
    const cost = Decimal.sum(0, ...rows.map((x) => x.cost));
    const total = this.calculator.calculate({ revenue, aiCost: cost, ...guardrails });
    const statuses = rows.map(
      (x) =>
        this.calculator.calculate({
          revenue: x.revenue,
          aiCost: x.cost,
          ...this.effectiveGuardrails(x, guardrails),
        }).status,
    );
    return {
      monthlyRevenue: decimalNumber(revenue),
      aiCost: decimalNumber(cost),
      grossProfit: decimalNumber(total.grossProfit),
      grossMargin: total.grossMargin ? decimalNumber(total.grossMargin) : null,
      targetGrossMargin: decimalNumber(guardrails.targetGrossMargin),
      customers: rows.length,
      customersAtRisk: statuses.filter((x) => x === MarginStatus.AtRisk).length,
      criticalCustomers: statuses.filter((x) => x === MarginStatus.Critical).length,
      noRevenueCustomers: statuses.filter((x) => x === MarginStatus.NoRevenue).length,
    };
  }
  async customers(org: string) {
    const [guardrails, rows] = await Promise.all([
      this.repository.guardrails(org),
      this.repository.rows(org),
    ]);
    return rows
      .map((row) => ({
        row,
        margin: this.calculator.calculate({
          revenue: row.revenue,
          aiCost: row.cost,
          ...this.effectiveGuardrails(row, guardrails),
        }),
      }))
      .sort((a, b) =>
        a.margin.grossMargin === null
          ? 1
          : b.margin.grossMargin === null
            ? -1
            : a.margin.grossMargin.comparedTo(b.margin.grossMargin),
      )
      .map((x) => ({
        customerId: x.row.id,
        name: x.row.name,
        revenue: decimalNumber(x.margin.revenue),
        aiCost: decimalNumber(x.margin.aiCost),
        grossProfit: decimalNumber(x.margin.grossProfit),
        grossMargin: x.margin.grossMargin ? decimalNumber(x.margin.grossMargin) : null,
        status: x.margin.status,
        allowedAiBudget: decimalNumber(x.margin.allowedAiBudget),
        remainingAiBudget: decimalNumber(x.margin.remainingAiBudget),
        budgetUsedPercent: x.margin.budgetUsedPercent
          ? decimalNumber(x.margin.budgetUsedPercent)
          : null,
        budgetState: x.margin.budgetState,
      }));
  }
  async features(org: string) {
    return (await this.repository.features(org)).map((x) => ({
      feature: x.feature,
      requests: Number(x.requests),
      inputTokens: Number(x.inputTokens),
      outputTokens: Number(x.outputTokens),
      cost: decimalNumber(x.cost),
    }));
  }

  async profitability(org: string, query: AnalyticsQueryDto) {
    const period = this.ranges.resolve(query);
    const previousPeriod = this.ranges.previous(query, period);
    const [
      guardrails,
      rows,
      providers,
      models,
      features,
      trend,
      previousGuardrails,
      previousRows,
      previousFeatures,
      previousModels,
      currentGuardrails,
      currentHealthRows,
    ] = await Promise.all([
      this.repository.historicalGuardrails(org, period.end),
      this.repository.analyticsCustomers(org, period.start, period.end, query.sort),
      this.repository.analyticsBreakdown(org, period.start, period.end, 'Provider'),
      this.repository.analyticsBreakdown(org, period.start, period.end, 'Model'),
      this.repository.analyticsBreakdown(org, period.start, period.end, 'Feature'),
      this.repository.analyticsTrend(org, period.start, period.end),
      this.repository.historicalGuardrails(org, previousPeriod.end),
      this.repository.analyticsCustomers(org, previousPeriod.start, previousPeriod.end, query.sort),
      this.repository.analyticsBreakdown(org, previousPeriod.start, previousPeriod.end, 'Feature'),
      this.repository.analyticsBreakdown(org, previousPeriod.start, previousPeriod.end, 'Model'),
      this.repository.guardrails(org),
      this.repository.currentHealthRows(org),
    ]);
    const customers = rows.map((row) => this.customerResponse(row, guardrails));
    const previousCustomers = previousRows.map((row) =>
      this.customerResponse(row, previousGuardrails),
    );
    const currentHealthCustomers = currentHealthRows.map((row) =>
      this.customerResponse(row, currentGuardrails),
    );
    const criticalCustomers = currentHealthCustomers.filter(
      (customer) => customer.budgetState === BudgetState.Critical,
    );
    const warningCustomers = currentHealthCustomers.filter(
      (customer) => customer.budgetState === BudgetState.Warning,
    );
    const highestRisk =
      [...criticalCustomers, ...warningCustomers].sort(
        (a, b) =>
          (a.grossMargin ?? Number.NEGATIVE_INFINITY) - (b.grossMargin ?? Number.NEGATIVE_INFINITY),
      )[0] ?? null;
    const currentHealth = {
      critical: criticalCustomers.length,
      warning: warningCustomers.length,
      highestRisk,
    };
    const selectedBudgetState =
      query.status === AnalyticsCustomerStatus.All
        ? null
        : {
            [AnalyticsCustomerStatus.Healthy]: BudgetState.Healthy,
            [AnalyticsCustomerStatus.Warning]: BudgetState.Warning,
            [AnalyticsCustomerStatus.Critical]: BudgetState.Critical,
          }[query.status];
    const filteredCustomers =
      selectedBudgetState === null
        ? customers
        : customers.filter(
            (customer) =>
              customer.stripeCustomerStatus !== 'deleted' &&
              customer.budgetState === selectedBudgetState,
          );
    const customerPage =
      query.page === undefined
        ? customers
        : {
            items: filteredCustomers.slice(
              (query.page - 1) * query.pageSize,
              query.page * query.pageSize,
            ),
            total: filteredCustomers.length,
            page: query.page,
            pageSize: query.pageSize,
          };
    const revenue = Decimal.sum(0, ...rows.map((row) => row.revenue));
    const cost = Decimal.sum(0, ...rows.map((row) => row.cost));
    const totals = this.calculator.calculate({
      revenue,
      aiCost: cost,
      ...guardrails,
    });
    const breakdown = (values: { name: string; cost: string; requests: string }[]) =>
      values.map((value) => ({
        name: value.name,
        cost: decimalNumber(value.cost),
        requests: Number(value.requests),
      }));
    const providerBreakdown = breakdown(providers);
    const modelBreakdown = breakdown(models);
    const featureBreakdown = breakdown(features);
    const previousFeatureBreakdown = breakdown(previousFeatures);
    const previousModelBreakdown = breakdown(previousModels);
    const customerBreakdown = [...customers]
      .sort((a, b) => new Decimal(b.aiCost).comparedTo(a.aiCost))
      .map((customer) => ({ name: customer.name, cost: customer.aiCost }));
    return {
      period: {
        range: query.range,
        start: period.start.toISOString(),
        endExclusive: period.end.toISOString(),
        revenueSemantics: 'period_end_mrr',
      },
      sort: query.sort,
      totals: {
        revenue: decimalNumber(revenue),
        aiCost: decimalNumber(cost),
        grossProfit: decimalNumber(totals.grossProfit),
        grossMargin: totals.grossMargin ? decimalNumber(totals.grossMargin) : null,
      },
      trend: trend.map((value) => ({
        date: new Date(value.date).toISOString().slice(0, 10),
        cost: decimalNumber(value.cost),
      })),
      breakdowns: {
        providers: providerBreakdown,
        models: modelBreakdown,
        features: featureBreakdown,
        customers: customerBreakdown,
      },
      customers: customerPage,
      currentHealth,
      attention: currentHealth,
      insights: this.profitabilityInsights(
        customers,
        previousCustomers,
        totals,
        this.calculator.calculate({
          revenue: Decimal.sum(0, ...previousRows.map((row) => row.revenue)),
          aiCost: Decimal.sum(0, ...previousRows.map((row) => row.cost)),
          ...previousGuardrails,
        }),
        featureBreakdown,
        previousFeatureBreakdown,
      ),
      anomalies: this.costAnomalies(
        customers,
        previousCustomers,
        featureBreakdown,
        previousFeatureBreakdown,
        modelBreakdown,
        previousModelBreakdown,
      ),
      topCostDrivers: {
        customers: customerBreakdown.slice(0, 3),
        features: featureBreakdown.slice(0, 3),
        models: modelBreakdown.slice(0, 3),
      },
    };
  }

  private costAnomalies(
    customers: ReturnType<DashboardService['customerResponse']>[],
    previousCustomers: ReturnType<DashboardService['customerResponse']>[],
    features: { name: string; cost: number }[],
    previousFeatures: { name: string; cost: number }[],
    models: { name: string; cost: number }[],
    previousModels: { name: string; cost: number }[],
  ) {
    type Candidate = {
      dimension: 'customer' | 'feature' | 'model';
      name: string;
      currentCost: Decimal.Value;
      previousCost: Decimal.Value;
      customerId?: string;
    };
    const previousCustomerCosts = new Map(
      previousCustomers.map((customer) => [customer.customerId, customer.aiCost]),
    );
    const previousFeatureCosts = new Map(
      previousFeatures.map((feature) => [feature.name, feature.cost]),
    );
    const previousModelCosts = new Map(previousModels.map((model) => [model.name, model.cost]));
    const candidates: Candidate[] = [
      ...customers
        .filter((customer) => customer.stripeCustomerStatus !== 'deleted')
        .map((customer) => ({
          dimension: 'customer' as const,
          name: customer.name,
          customerId: customer.customerId,
          currentCost: customer.aiCost,
          previousCost: previousCustomerCosts.get(customer.customerId) ?? 0,
        })),
      ...features.map((feature) => ({
        dimension: 'feature' as const,
        name: feature.name,
        currentCost: feature.cost,
        previousCost: previousFeatureCosts.get(feature.name) ?? 0,
      })),
      ...models.map((model) => ({
        dimension: 'model' as const,
        name: model.name,
        currentCost: model.cost,
        previousCost: previousModelCosts.get(model.name) ?? 0,
      })),
    ];
    return candidates
      .map((candidate) => {
        const currentCost = new Decimal(candidate.currentCost);
        const previousCost = new Decimal(candidate.previousCost);
        const absoluteIncrease = currentCost.minus(previousCost);
        const percentageIncrease = previousCost.isZero()
          ? null
          : absoluteIncrease.dividedBy(previousCost).times(100);
        return { ...candidate, currentCost, previousCost, absoluteIncrease, percentageIncrease };
      })
      .filter(
        (candidate) =>
          candidate.absoluteIncrease.greaterThanOrEqualTo(5) &&
          (candidate.previousCost.isZero() ||
            candidate.percentageIncrease!.greaterThanOrEqualTo(50)),
      )
      .sort((a, b) => b.absoluteIncrease.comparedTo(a.absoluteIncrease))
      .slice(0, 3)
      .map((candidate) => ({
        dimension: candidate.dimension,
        name: candidate.name,
        customerId: candidate.customerId,
        currentCost: decimalNumber(candidate.currentCost),
        previousCost: decimalNumber(candidate.previousCost),
        absoluteIncrease: decimalNumber(candidate.absoluteIncrease),
        percentageIncrease: candidate.percentageIncrease
          ? decimalNumber(candidate.percentageIncrease)
          : null,
        severity:
          candidate.absoluteIncrease.greaterThanOrEqualTo(25) ||
          candidate.percentageIncrease?.greaterThanOrEqualTo(100)
            ? 'critical'
            : 'warning',
      }));
  }

  private profitabilityInsights(
    customers: ReturnType<DashboardService['customerResponse']>[],
    previousCustomers: ReturnType<DashboardService['customerResponse']>[],
    totals: ReturnType<MarginCalculator['calculate']>,
    previousTotals: ReturnType<MarginCalculator['calculate']>,
    features: { name: string; cost: number; requests: number }[],
    previousFeatures: { name: string; cost: number; requests: number }[],
  ) {
    const insights: {
      tone: 'critical' | 'healthy' | 'neutral';
      text: string;
      customerId?: string;
    }[] = [];
    const previousByCustomer = new Map(
      previousCustomers.map((customer) => [customer.customerId, customer]),
    );
    const activeCustomers = customers.filter(
      (customer) => customer.stripeCustomerStatus !== 'deleted',
    );
    const becameCritical = activeCustomers
      .filter((customer) => {
        const previous = previousByCustomer.get(customer.customerId);
        return (
          previous &&
          previous.stripeCustomerStatus !== 'deleted' &&
          previous.budgetState !== BudgetState.Critical &&
          customer.budgetState === BudgetState.Critical
        );
      })
      .sort((a, b) => new Decimal(b.aiCost).comparedTo(a.aiCost))[0];
    if (becameCritical)
      insights.push({
        tone: 'critical',
        text: `${becameCritical.name} became Critical vs previous period`,
        customerId: becameCritical.customerId,
      });

    const previousCost = previousTotals.aiCost;
    if (!previousCost.isZero()) {
      const costChange = totals.aiCost.minus(previousCost).dividedBy(previousCost).times(100);
      if (
        costChange.abs().greaterThanOrEqualTo(10) &&
        totals.aiCost.minus(previousCost).abs().greaterThanOrEqualTo(1)
      )
        insights.push({
          tone: costChange.isPositive() ? 'critical' : 'healthy',
          text: `AI cost ${costChange.isPositive() ? 'increased' : 'decreased'} ${costChange.abs().toDecimalPlaces(0).toString()}% vs previous comparable period`,
        });
    }

    if (totals.grossMargin !== null && previousTotals.grossMargin !== null) {
      const marginChange = totals.grossMargin.minus(previousTotals.grossMargin);
      if (marginChange.abs().greaterThanOrEqualTo(5))
        insights.push({
          tone: marginChange.isNegative() ? 'critical' : 'healthy',
          text: `Gross margin ${marginChange.isNegative() ? 'dropped' : 'improved'} from ${previousTotals.grossMargin.toDecimalPlaces(0).toString()}% to ${totals.grossMargin.toDecimalPlaces(0).toString()}%`,
        });
    }

    const recovered = activeCustomers
      .filter((customer) => {
        const previous = previousByCustomer.get(customer.customerId);
        return (
          previous &&
          previous.stripeCustomerStatus !== 'deleted' &&
          previous.budgetState !== BudgetState.Healthy &&
          customer.budgetState === BudgetState.Healthy
        );
      })
      .sort((a, b) => new Decimal(b.aiCost).comparedTo(a.aiCost))[0];
    if (recovered)
      insights.push({
        tone: 'healthy',
        text: `${recovered.name} improved to Healthy vs previous period`,
        customerId: recovered.customerId,
      });

    const topFeature = features[0];
    if (topFeature && topFeature.cost >= 1 && previousFeatures[0]?.name !== topFeature.name)
      insights.push({ tone: 'neutral', text: `${topFeature.name} is now the top cost driver` });
    return insights.slice(0, 3);
  }
  async customerProfitability(org: string, customerId: string, query: AnalyticsQueryDto) {
    const period = this.ranges.resolve(query);
    const [guardrails, rows, features, recent] = await Promise.all([
      this.repository.historicalGuardrails(org, period.end),
      this.repository.analyticsCustomers(org, period.start, period.end, query.sort, customerId),
      this.repository.analyticsCustomerFeatures(org, customerId, period.start, period.end),
      this.repository.analyticsCustomerRecent(org, customerId, period.start, period.end),
    ]);
    const row = rows[0];
    if (!row) throw new NotFoundError();
    return {
      period: {
        range: query.range,
        start: period.start.toISOString(),
        endExclusive: period.end.toISOString(),
        revenueSemantics: 'period_end_mrr',
      },
      ...this.customerResponse(row, guardrails),
      features: features.map((feature) => ({
        feature: feature.feature,
        cost: decimalNumber(feature.cost),
      })),
      recentUsage: recent.map((usage) => ({
        id: usage.id,
        provider: usage.provider,
        model: usage.model,
        feature: usage.feature,
        inputTokens: Number(usage.inputTokens),
        outputTokens: Number(usage.outputTokens),
        cost: decimalNumber(usage.cost),
        occurredAt: usage.occurredAt.toISOString(),
      })),
    };
  }
  async customerCostDrivers(org: string, customerId: string, query: AnalyticsQueryDto) {
    const period = this.ranges.resolve(query);
    const previous = this.ranges.previous(query, period);
    const rows = await this.repository.customerCostDrivers(
      org,
      customerId,
      period.start,
      period.end,
      previous.start,
      previous.end,
    );
    if (rows.length === 0) {
      const customer = await this.marginRepository?.customer(org, customerId);
      if (!customer) throw new NotFoundError();
    }
    const totalAiCost = new Decimal(rows[0]?.totalAiCost ?? 0);
    const items = (dimension: 'feature' | 'model') =>
      rows
        .filter((row) => row.dimension === dimension)
        .map((row) => {
          const current = new Decimal(row.currentCost);
          const previousCost = new Decimal(row.previousCost);
          const absoluteChange = current.minus(previousCost);
          return {
            name: row.name,
            aiCost: decimalNumber(current),
            shareOfCustomerAiCost: totalAiCost.eq(0)
              ? 0
              : decimalNumber(current.div(totalAiCost).mul(100)),
            previousPeriodAiCost: decimalNumber(previousCost),
            absoluteChange: decimalNumber(absoluteChange),
            percentChange: previousCost.eq(0)
              ? null
              : decimalNumber(absoluteChange.div(previousCost).mul(100)),
            direction: absoluteChange.gt(0) ? 'up' : absoluteChange.lt(0) ? 'down' : 'flat',
            usageEventCount: Number(row.usageEventCount),
          };
        });
    return {
      range: {
        value: query.range,
        start: period.start.toISOString(),
        endExclusive: period.end.toISOString(),
        previousStart: previous.start.toISOString(),
        previousEndExclusive: previous.end.toISOString(),
      },
      totalAiCost: decimalNumber(totalAiCost),
      features: items('feature'),
      models: items('model'),
    };
  }
  async customerProfitabilityHistory(
    org: string,
    customerId: string,
    query: CustomerProfitabilityHistoryQueryDto,
  ) {
    const now = new Date();
    let end: Date;
    let start: Date;
    if (query.start !== undefined || query.end !== undefined) {
      if (!query.start || !query.end)
        throw new BadRequestException('start and end must be provided together.');
      start = new Date(query.start);
      end = new Date(query.end);
      if (start >= end) throw new BadRequestException('start must be before end.');
      const isUtcMonthBoundary = (value: Date) =>
        value.getUTCHours() === 0 &&
        value.getUTCMinutes() === 0 &&
        value.getUTCSeconds() === 0 &&
        value.getUTCMilliseconds() === 0 &&
        value.getUTCDate() === 1;
      if (!isUtcMonthBoundary(start) || !isUtcMonthBoundary(end))
        throw new BadRequestException('start and end must be UTC calendar-month boundaries.');
      const monthCount =
        (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
        end.getUTCMonth() -
        start.getUTCMonth();
      if (monthCount > 24) throw new BadRequestException('History range cannot exceed 24 months.');
    } else {
      const months = query.months ?? 12;
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, 1));
    }
    const rows = await this.repository.customerProfitabilityHistory(org, customerId, start, end);
    if (rows.length === 0) throw new NotFoundError();
    return rows.map((row) => {
      const margin = this.calculator.calculate({
        revenue: row.revenue,
        aiCost: row.cost,
        targetGrossMargin: row.targetGrossMargin,
        warningThreshold: row.warningThreshold,
        criticalThreshold: row.criticalThreshold,
      });
      return {
        periodStart: new Date(row.periodStart).toISOString(),
        periodEnd: new Date(row.periodEnd).toISOString(),
        revenue: decimalNumber(margin.revenue),
        aiCost: decimalNumber(margin.aiCost),
        grossProfit: decimalNumber(margin.grossProfit),
        grossMargin: margin.grossMargin ? decimalNumber(margin.grossMargin) : null,
        status: margin.status,
        usageEventCount: Number(row.usageEventCount),
      };
    });
  }
  async customerProfitabilityForecast(org: string, customerId: string, asOf = new Date()) {
    if (!this.marginRepository) throw new Error('Margin repository is unavailable.');
    const customer = await this.marginRepository.customer(org, customerId);
    if (!customer) throw new NotFoundError();
    const monthStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 1));
    const todayStart = new Date(
      Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
    );
    const tomorrowStart = new Date(todayStart.getTime() + 86_400_000);
    const [guardrails, usage] = await Promise.all([
      this.marginRepository.guardrails(org, customer),
      this.repository.customerForecastUsage(
        org,
        customerId,
        monthStart,
        monthEnd,
        todayStart,
        tomorrowStart,
      ),
    ]);
    return this.calculateForecast(customer.monthlyRevenue, guardrails, usage, asOf);
  }

  async profitabilityForecastSummary(org: string, asOf = new Date()) {
    const dates = this.forecastDates(asOf);
    const [organizationUsage, customerRows] = await Promise.all([
      this.repository.organizationForecastUsage(org, ...dates),
      this.repository.customerForecastInputs(org, ...dates),
    ]);
    const organizationWindow = this.forecastWindow(organizationUsage, asOf);
    const currentRevenue = new Decimal(organizationUsage.currentRevenue);
    const currentMonthAiCost = new Decimal(organizationUsage.currentMonthAiCost);
    const recentDailyAverageCost =
      organizationWindow.recentWindowDays === 0
        ? new Decimal(0)
        : new Decimal(organizationUsage.recentCost).div(organizationWindow.recentWindowDays);
    const organizationAvailable = organizationWindow.recentWindowDays >= 3;
    const remainingDays = this.remainingForecastDays(asOf);
    const projectedMonthEndAiCost = organizationAvailable
      ? currentMonthAiCost.plus(recentDailyAverageCost.mul(remainingDays))
      : null;
    const customerForecasts = customerRows.map((row) => ({
      row,
      forecast: this.calculateForecast(
        row.revenue,
        {
          targetGrossMargin: row.targetGrossMargin,
          warningThreshold: row.warningThreshold,
          criticalThreshold: row.criticalThreshold,
        },
        row,
        asOf,
      ),
    }));
    const alreadyExhausted = customerForecasts.filter(({ forecast }) => forecast.budgetExhausted);
    const insufficient = customerForecasts.filter(
      ({ forecast }) =>
        !forecast.budgetExhausted && forecast.forecastStatus === 'insufficient_data',
    );
    const projectedToExhaust = customerForecasts.filter(
      ({ forecast }) =>
        !forecast.budgetExhausted &&
        forecast.forecastStatus === 'available' &&
        forecast.budgetExhaustionDate !== null,
    );
    const highest = [...alreadyExhausted, ...projectedToExhaust].sort((a, b) => {
      if (a.forecast.budgetExhausted !== b.forecast.budgetExhausted)
        return a.forecast.budgetExhausted ? -1 : 1;
      return (a.forecast.budgetExhaustionDate ?? '').localeCompare(
        b.forecast.budgetExhaustionDate ?? '',
      );
    })[0];
    const projectedGrossProfit =
      projectedMonthEndAiCost === null ? null : currentRevenue.minus(projectedMonthEndAiCost);
    return {
      forecastStatus: organizationAvailable ? 'available' : 'insufficient_data',
      asOf: asOf.toISOString(),
      scope: 'current_month',
      currentRevenue: decimalNumber(currentRevenue),
      currentMonthAiCost: decimalNumber(currentMonthAiCost),
      recentWindowDays: organizationWindow.recentWindowDays,
      recentDailyAverageCost: decimalNumber(recentDailyAverageCost),
      projectedMonthEndAiCost:
        projectedMonthEndAiCost === null ? null : decimalNumber(projectedMonthEndAiCost),
      projectedGrossProfit:
        projectedGrossProfit === null ? null : decimalNumber(projectedGrossProfit),
      projectedGrossMargin:
        projectedGrossProfit === null || currentRevenue.isZero()
          ? null
          : decimalNumber(projectedGrossProfit.div(currentRevenue).mul(100)),
      customersEvaluated: customerForecasts.length,
      customersInsufficientData: insufficient.length,
      customersAlreadyBudgetExhausted: alreadyExhausted.length,
      customersProjectedToExhaustBudgetThisMonth: projectedToExhaust.length,
      highestForecastRisk: highest
        ? {
            customerId: highest.row.id,
            customerName: highest.row.name,
            projectedMonthEndAiCost: highest.forecast.projectedMonthEndAiCost,
            allowedAiBudget: highest.forecast.allowedAiBudget,
            budgetExhaustionDate: highest.forecast.budgetExhaustionDate,
          }
        : null,
    };
  }

  private calculateForecast(
    revenue: Decimal.Value,
    guardrails: {
      targetGrossMargin: Decimal.Value;
      warningThreshold: Decimal.Value;
      criticalThreshold: Decimal.Value;
    },
    usage: CustomerForecastUsageRow,
    asOf: Date,
  ): ForecastCalculation {
    const { monthEnd, todayStart } = this.forecastCalendar(asOf);
    const { recentWindowDays } = this.forecastWindow(usage, asOf);
    const currentMonthAiCost = new Decimal(usage.currentMonthAiCost);
    const recentDailyAverageCost =
      recentWindowDays === 0 ? new Decimal(0) : new Decimal(usage.recentCost).div(recentWindowDays);
    const actual = this.calculator.calculate({
      revenue,
      aiCost: currentMonthAiCost,
      ...guardrails,
    });
    const budgetExhausted = actual.remainingAiBudget.lte(0);
    const base = {
      forecastStatus:
        recentWindowDays < 3 ? ('insufficient_data' as const) : ('available' as const),
      asOf: asOf.toISOString(),
      revenue: decimalNumber(actual.revenue),
      currentMonthAiCost: decimalNumber(currentMonthAiCost),
      recentWindowDays,
      recentDailyAverageCost: decimalNumber(recentDailyAverageCost),
      allowedAiBudget: decimalNumber(actual.allowedAiBudget),
      remainingBudget: decimalNumber(actual.remainingAiBudget),
      budgetExhausted,
    };
    if (recentWindowDays < 3)
      return {
        ...base,
        projectedMonthEndAiCost: null,
        projectedRemainingBudget: null,
        projectedGrossProfit: null,
        projectedGrossMargin: null,
        budgetExhaustionDate: budgetExhausted ? todayStart.toISOString() : null,
      };
    const remainingDays = this.remainingForecastDays(asOf);
    const projectedMonthEndAiCost = currentMonthAiCost.plus(
      recentDailyAverageCost.mul(remainingDays),
    );
    const projected = this.calculator.calculate({
      revenue,
      aiCost: projectedMonthEndAiCost,
      ...guardrails,
    });
    let budgetExhaustionDate: string | null = budgetExhausted ? todayStart.toISOString() : null;
    if (!budgetExhausted && actual.allowedAiBudget.gt(0) && recentDailyAverageCost.gt(0)) {
      const daysUntilExhaustion = actual.remainingAiBudget.div(recentDailyAverageCost);
      const exhaustion = new Date(
        todayStart.getTime() + daysUntilExhaustion.mul(86_400_000).toDecimalPlaces(0).toNumber(),
      );
      if (exhaustion < monthEnd) budgetExhaustionDate = exhaustion.toISOString();
    }
    return {
      ...base,
      projectedMonthEndAiCost: decimalNumber(projectedMonthEndAiCost),
      projectedRemainingBudget: decimalNumber(projected.remainingAiBudget),
      projectedGrossProfit: decimalNumber(projected.grossProfit),
      projectedGrossMargin:
        projected.grossMargin === null ? null : decimalNumber(projected.grossMargin),
      budgetExhaustionDate,
    };
  }

  private forecastDates(asOf: Date): [Date, Date, Date, Date] {
    const { monthStart, monthEnd, todayStart, tomorrowStart } = this.forecastCalendar(asOf);
    return [monthStart, monthEnd, todayStart, tomorrowStart];
  }

  private forecastCalendar(asOf: Date) {
    const monthStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 1));
    const todayStart = new Date(
      Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
    );
    const tomorrowStart = new Date(todayStart.getTime() + 86_400_000);
    return { monthStart, monthEnd, todayStart, tomorrowStart };
  }

  private forecastWindow(usage: CustomerForecastUsageRow, asOf: Date) {
    const { monthStart, todayStart } = this.forecastCalendar(asOf);
    const firstUsageDay =
      usage.firstUsageAt === null
        ? null
        : new Date(
            Date.UTC(
              new Date(usage.firstUsageAt).getUTCFullYear(),
              new Date(usage.firstUsageAt).getUTCMonth(),
              new Date(usage.firstUsageAt).getUTCDate(),
            ),
          );
    const sevenDayStart = new Date(todayStart.getTime() - 6 * 86_400_000);
    const recentStart =
      firstUsageDay === null
        ? null
        : new Date(
            Math.max(monthStart.getTime(), sevenDayStart.getTime(), firstUsageDay.getTime()),
          );
    return {
      recentWindowDays:
        recentStart === null
          ? 0
          : Math.floor((todayStart.getTime() - recentStart.getTime()) / 86_400_000) + 1,
    };
  }

  private remainingForecastDays(asOf: Date) {
    const { monthEnd, tomorrowStart } = this.forecastCalendar(asOf);
    return Math.max(0, Math.round((monthEnd.getTime() - tomorrowStart.getTime()) / 86_400_000));
  }
  private customerResponse(
    row: {
      id: string;
      name: string;
      stripeCustomerStatus: StripeCustomerStatus;
      revenue: string;
      cost: string;
      targetGrossMarginOverride: string | null;
      warningThresholdOverride: string | null;
      criticalThresholdOverride: string | null;
    },
    guardrails: {
      targetGrossMargin: string;
      warningThreshold: string;
      criticalThreshold: string;
    },
  ) {
    const effective = this.effectiveGuardrails(row, guardrails);
    const margin = this.calculator.calculate({
      revenue: row.revenue,
      aiCost: row.cost,
      ...effective,
    });
    return {
      customerId: row.id,
      name: row.name,
      stripeCustomerStatus:
        row.stripeCustomerStatus === StripeCustomerStatus.Active
          ? 'active'
          : row.stripeCustomerStatus === StripeCustomerStatus.Deleted
            ? 'deleted'
            : 'unknown',
      revenue: decimalNumber(margin.revenue),
      aiCost: decimalNumber(margin.aiCost),
      grossProfit: decimalNumber(margin.grossProfit),
      grossMargin: margin.grossMargin ? decimalNumber(margin.grossMargin) : null,
      status: margin.status,
      targetGrossMargin: decimalNumber(margin.targetGrossMargin),
      warningThreshold: decimalNumber(margin.warningThreshold),
      criticalThreshold: decimalNumber(margin.criticalThreshold),
      allowedAiBudget: decimalNumber(margin.allowedAiBudget),
      remainingAiBudget: decimalNumber(margin.remainingAiBudget),
      budgetUsedPercent: margin.budgetUsedPercent ? decimalNumber(margin.budgetUsedPercent) : null,
      budgetState: margin.budgetState,
    };
  }
  private effectiveGuardrails(
    row: {
      targetGrossMarginOverride: string | null;
      warningThresholdOverride: string | null;
      criticalThresholdOverride: string | null;
    },
    organization: {
      targetGrossMargin: string;
      warningThreshold: string;
      criticalThreshold: string;
    },
  ) {
    return {
      targetGrossMargin: row.targetGrossMarginOverride ?? organization.targetGrossMargin,
      warningThreshold: row.warningThresholdOverride ?? organization.warningThreshold,
      criticalThreshold: row.criticalThresholdOverride ?? organization.criticalThreshold,
    };
  }
}
