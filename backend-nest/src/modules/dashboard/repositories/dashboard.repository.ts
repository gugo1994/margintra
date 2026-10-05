import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AiUsageEventEntity, CustomerEntity, OrganizationEntity } from '../../../database/entities';
import { utcCalendarMonth } from '../../../common/helpers/calendar-month.helper';
import { StripeCustomerStatus } from '../../../common/enums/domain.enums';
import { AnalyticsSort } from '../dto/analytics-query.dto';
export interface DashboardRow {
  id: string;
  name: string;
  stripeCustomerStatus: StripeCustomerStatus;
  revenue: string;
  cost: string;
  targetGrossMarginOverride: string | null;
  warningThresholdOverride: string | null;
  criticalThresholdOverride: string | null;
}
export interface AnalyticsBreakdownRow {
  name: string;
  cost: string;
  requests: string;
}
export interface AnalyticsTrendRow {
  date: Date | string;
  cost: string;
}
export interface CustomerProfitabilityHistoryRow {
  periodStart: Date | string;
  periodEnd: Date | string;
  revenue: string;
  cost: string;
  usageEventCount: string;
  targetGrossMargin: string;
  warningThreshold: string;
  criticalThreshold: string;
}
export interface CustomerForecastUsageRow {
  firstUsageAt: Date | string | null;
  currentMonthAiCost: string;
  recentCost: string;
}
export interface OrganizationForecastUsageRow extends CustomerForecastUsageRow {
  currentRevenue: string;
}
export interface CustomerForecastInputRow extends CustomerForecastUsageRow {
  id: string;
  name: string;
  revenue: string;
  targetGrossMargin: string;
  warningThreshold: string;
  criticalThreshold: string;
}
export interface CustomerCostDriverRow {
  dimension: 'feature' | 'model';
  name: string;
  currentCost: string;
  previousCost: string;
  usageEventCount: string;
  totalAiCost: string;
}
@Injectable()
export class DashboardRepository {
  constructor(private readonly dataSource: DataSource) {}
  async target(org: string) {
    return (await this.dataSource.manager.findOneByOrFail(OrganizationEntity, { id: org }))
      .targetGrossMargin;
  }
  async guardrails(org: string) {
    const organization = await this.dataSource.manager.findOneByOrFail(OrganizationEntity, {
      id: org,
    });
    return {
      targetGrossMargin: organization.targetGrossMargin,
      warningThreshold: organization.budgetWarningThreshold,
      criticalThreshold: organization.budgetCriticalThreshold,
    };
  }
  async historicalGuardrails(org: string, end: Date) {
    const row = await this.dataSource.query<
      { targetGrossMargin: string; warningThreshold: string; criticalThreshold: string }[]
    >(
      `SELECT v."TargetGrossMargin" AS "targetGrossMargin",
         v."WarningThreshold" AS "warningThreshold", v."CriticalThreshold" AS "criticalThreshold"
       FROM organization_guardrail_versions v
       WHERE v."OrganizationId"=$1 AND v."EffectiveFrom"<$2
       ORDER BY v."EffectiveFrom" DESC, v."CreatedAt" DESC LIMIT 1`,
      [org, end],
    );
    return row[0] ?? this.guardrails(org);
  }
  rows(org: string): Promise<DashboardRow[]> {
    const { start, end } = utcCalendarMonth();
    return this.dataSource.manager
      .createQueryBuilder(CustomerEntity, 'c')
      .select('c."Id"', 'id')
      .addSelect('c."Name"', 'name')
      .addSelect('c."StripeCustomerStatus"', 'stripeCustomerStatus')
      .addSelect('c."MonthlyRevenue"', 'revenue')
      .addSelect('c."TargetGrossMarginOverride"', 'targetGrossMarginOverride')
      .addSelect('c."BudgetWarningThresholdOverride"', 'warningThresholdOverride')
      .addSelect('c."BudgetCriticalThresholdOverride"', 'criticalThresholdOverride')
      .addSelect(
        `COALESCE((SELECT SUM(u."Cost") FROM ai_usage_events u WHERE u."OrganizationId"=c."OrganizationId" AND u."CustomerId"=c."Id" AND u."OccurredAt">=:start AND u."OccurredAt"<:end),0)`,
        'cost',
      )
      .where('c."OrganizationId"=:org', { org, start, end })
      .getRawMany<DashboardRow>();
  }

  currentHealthRows(org: string): Promise<DashboardRow[]> {
    const { start, end } = utcCalendarMonth();
    return this.dataSource.query<DashboardRow[]>(
      `SELECT c."Id" AS id, c."Name" AS name,
         c."StripeCustomerStatus" AS "stripeCustomerStatus",
         COALESCE(snapshot."Revenue", c."MonthlyRevenue") AS revenue,
         COALESCE(snapshot."AiCost", current_cost.cost, 0) AS cost,
         c."TargetGrossMarginOverride" AS "targetGrossMarginOverride",
         c."BudgetWarningThresholdOverride" AS "warningThresholdOverride",
         c."BudgetCriticalThresholdOverride" AS "criticalThresholdOverride"
       FROM customers c
       LEFT JOIN LATERAL (
         SELECT ms."Revenue", ms."AiCost"
         FROM margin_snapshots ms
         WHERE ms."OrganizationId"=$1 AND ms."CustomerId"=c."Id"
         ORDER BY ms."UpdatedAt" DESC, ms."CreatedAt" DESC, ms."Id" DESC
         LIMIT 1
       ) snapshot ON true
       LEFT JOIN (
         SELECT u."CustomerId", SUM(u."Cost") AS cost
         FROM ai_usage_events u
         WHERE u."OrganizationId"=$1
           AND u."OccurredAt">=$2 AND u."OccurredAt"<$3
         GROUP BY u."CustomerId"
       ) current_cost ON current_cost."CustomerId"=c."Id"
       WHERE c."OrganizationId"=$1 AND c."StripeCustomerStatus"<>$4`,
      [org, start, end, StripeCustomerStatus.Deleted],
    );
  }
  features(org: string) {
    const { start, end } = utcCalendarMonth();
    return this.dataSource.manager
      .createQueryBuilder(AiUsageEventEntity, 'u')
      .select('u."Feature"', 'feature')
      .addSelect('COUNT(*)', 'requests')
      .addSelect('SUM(u."InputTokens")', 'inputTokens')
      .addSelect('SUM(u."OutputTokens")', 'outputTokens')
      .addSelect('SUM(u."Cost")', 'cost')
      .where('u."OrganizationId"=:org AND u."OccurredAt">=:start AND u."OccurredAt"<:end', {
        org,
        start,
        end,
      })
      .groupBy('u."Feature"')
      .orderBy('SUM(u."Cost")', 'DESC')
      .getRawMany<{
        feature: string;
        requests: string;
        inputTokens: string;
        outputTokens: string;
        cost: string;
      }>();
  }

  analyticsCustomers(
    org: string,
    start: Date,
    end: Date,
    sort: AnalyticsSort,
    customerId?: string,
  ) {
    const order = {
      [AnalyticsSort.HighestAiCost]: 'cost DESC, c."Name" ASC',
      [AnalyticsSort.LowestGrossMargin]:
        'CASE WHEN COALESCE(revenue.revenue,0)=0 THEN 1 ELSE 0 END ASC, ((COALESCE(revenue.revenue,0)-COALESCE(costs.cost,0))/NULLIF(revenue.revenue,0)) ASC, c."Name" ASC',
      [AnalyticsSort.HighestRevenue]: 'COALESCE(revenue.revenue,0) DESC, c."Name" ASC',
      [AnalyticsSort.HighestGrossProfit]:
        '(COALESCE(revenue.revenue,0)-COALESCE(costs.cost,0)) DESC, c."Name" ASC',
    }[sort];
    return this.dataSource.query<DashboardRow[]>(
      `SELECT c."Id" AS id, c."Name" AS name, c."StripeCustomerStatus" AS "stripeCustomerStatus",
         COALESCE(revenue.revenue, 0) AS revenue,
         COALESCE(costs.cost, 0) AS cost,
         overrides."targetGrossMarginOverride", overrides."warningThresholdOverride",
         overrides."criticalThresholdOverride"
       FROM customers c
       LEFT JOIN (
         SELECT u."CustomerId", SUM(u."Cost") AS cost
         FROM ai_usage_events u
         WHERE u."OrganizationId"=$1 AND u."OccurredAt">=$2 AND u."OccurredAt"<$3
         GROUP BY u."CustomerId"
       ) costs ON costs."CustomerId"=c."Id"
       LEFT JOIN LATERAL (
         SELECT r."Revenue" AS revenue
         FROM customer_revenue_snapshots r
         WHERE r."OrganizationId"=$1 AND r."CustomerId"=c."Id" AND r."EffectiveFrom"<$3
         ORDER BY r."EffectiveFrom" DESC, r."Sequence" DESC
         LIMIT 1
       ) revenue ON true
       LEFT JOIN LATERAL (
         SELECT v."TargetGrossMarginOverride" AS "targetGrossMarginOverride",
           v."WarningThresholdOverride" AS "warningThresholdOverride",
           v."CriticalThresholdOverride" AS "criticalThresholdOverride"
         FROM customer_guardrail_versions v
         WHERE v."OrganizationId"=$1 AND v."CustomerId"=c."Id" AND v."EffectiveFrom"<$3
         ORDER BY v."EffectiveFrom" DESC, v."CreatedAt" DESC LIMIT 1
       ) overrides ON true
       WHERE c."OrganizationId"=$1${customerId ? ' AND c."Id"=$4' : ''}
       ORDER BY ${order}`,
      customerId ? [org, start, end, customerId] : [org, start, end],
    );
  }

  analyticsCustomerFeatures(org: string, customerId: string, start: Date, end: Date) {
    return this.dataSource.query<{ feature: string; cost: string }[]>(
      `SELECT u."Feature" AS feature, SUM(u."Cost") AS cost
       FROM ai_usage_events u
       WHERE u."OrganizationId"=$1 AND u."CustomerId"=$2
         AND u."OccurredAt">=$3 AND u."OccurredAt"<$4
       GROUP BY u."Feature"
       ORDER BY SUM(u."Cost") DESC, u."Feature" ASC`,
      [org, customerId, start, end],
    );
  }

  async customerCostDrivers(
    org: string,
    customerId: string,
    start: Date,
    end: Date,
    previousStart: Date,
    previousEnd: Date,
  ): Promise<CustomerCostDriverRow[]> {
    const customer = await this.dataSource.manager.findOneBy(CustomerEntity, {
      id: customerId,
      organizationId: org,
    });
    if (!customer) return [];
    return this.dataSource.query<CustomerCostDriverRow[]>(
      `WITH dimensions AS (
         SELECT 'feature'::text AS dimension, event."Feature" AS name,
           COALESCE(SUM(event."Cost") FILTER (
             WHERE event."OccurredAt">=$3 AND event."OccurredAt"<$4),0) AS "currentCost",
           COALESCE(SUM(event."Cost") FILTER (
             WHERE event."OccurredAt">=$5 AND event."OccurredAt"<$6),0) AS "previousCost",
           COUNT(*) FILTER (
             WHERE event."OccurredAt">=$3 AND event."OccurredAt"<$4) AS "usageEventCount"
         FROM ai_usage_events event
         WHERE event."OrganizationId"=$1 AND event."CustomerId"=$2
           AND event."OccurredAt">=$5 AND event."OccurredAt"<$4
         GROUP BY event."Feature"
         UNION ALL
         SELECT 'model'::text AS dimension, event."Model" AS name,
           COALESCE(SUM(event."Cost") FILTER (
             WHERE event."OccurredAt">=$3 AND event."OccurredAt"<$4),0) AS "currentCost",
           COALESCE(SUM(event."Cost") FILTER (
             WHERE event."OccurredAt">=$5 AND event."OccurredAt"<$6),0) AS "previousCost",
           COUNT(*) FILTER (
             WHERE event."OccurredAt">=$3 AND event."OccurredAt"<$4) AS "usageEventCount"
         FROM ai_usage_events event
         WHERE event."OrganizationId"=$1 AND event."CustomerId"=$2
           AND event."OccurredAt">=$5 AND event."OccurredAt"<$4
         GROUP BY event."Model"
       ), ranked AS (
         SELECT dimensions.*,
           SUM("currentCost") OVER (PARTITION BY dimension) AS "totalAiCost",
           ROW_NUMBER() OVER (
             PARTITION BY dimension ORDER BY "currentCost" DESC, name ASC) AS rank
         FROM dimensions
       )
       SELECT dimension, name, "currentCost", "previousCost", "usageEventCount", "totalAiCost"
       FROM ranked
       WHERE rank<=5 AND "currentCost">0
       ORDER BY dimension ASC, "currentCost" DESC, name ASC`,
      [org, customerId, start, end, previousStart, previousEnd],
    );
  }

  analyticsCustomerRecent(org: string, customerId: string, start: Date, end: Date) {
    return this.dataSource.manager
      .createQueryBuilder(AiUsageEventEntity, 'u')
      .where(
        'u."OrganizationId"=:org AND u."CustomerId"=:customerId AND u."OccurredAt">=:start AND u."OccurredAt"<:end',
        { org, customerId, start, end },
      )
      .orderBy('u."OccurredAt"', 'DESC')
      .limit(25)
      .getMany();
  }

  customerProfitabilityHistory(
    org: string,
    customerId: string,
    start: Date,
    end: Date,
  ): Promise<CustomerProfitabilityHistoryRow[]> {
    return this.dataSource.query<CustomerProfitabilityHistoryRow[]>(
      `WITH months AS (
         SELECT month_start AS "periodStart", month_start + interval '1 month' AS "periodEnd"
         FROM generate_series($3::timestamptz, $4::timestamptz - interval '1 month',
           interval '1 month') month_start
       )
       SELECT months."periodStart", months."periodEnd",
         COALESCE(revenue."Revenue", 0) AS revenue,
         COALESCE(usage.cost, 0) AS cost,
         COALESCE(usage.count, 0) AS "usageEventCount",
         COALESCE(customer_guardrails."TargetGrossMarginOverride",
           organization_guardrails."TargetGrossMargin", organization."TargetGrossMargin")
           AS "targetGrossMargin",
         COALESCE(customer_guardrails."WarningThresholdOverride",
           organization_guardrails."WarningThreshold", organization."BudgetWarningThreshold")
           AS "warningThreshold",
         COALESCE(customer_guardrails."CriticalThresholdOverride",
           organization_guardrails."CriticalThreshold", organization."BudgetCriticalThreshold")
           AS "criticalThreshold"
       FROM customers customer
       JOIN organizations organization ON organization."Id"=customer."OrganizationId"
       CROSS JOIN months
       LEFT JOIN LATERAL (
         SELECT snapshot."Revenue"
         FROM customer_revenue_snapshots snapshot
         WHERE snapshot."OrganizationId"=$1 AND snapshot."CustomerId"=customer."Id"
           AND snapshot."EffectiveFrom"<months."periodEnd"
         ORDER BY snapshot."EffectiveFrom" DESC, snapshot."Sequence" DESC
         LIMIT 1
       ) revenue ON true
       LEFT JOIN LATERAL (
         SELECT SUM(event."Cost") AS cost, COUNT(*) AS count
         FROM ai_usage_events event
         WHERE event."OrganizationId"=$1 AND event."CustomerId"=customer."Id"
           AND event."OccurredAt">=months."periodStart"
           AND event."OccurredAt"<months."periodEnd"
       ) usage ON true
       LEFT JOIN LATERAL (
         SELECT version."TargetGrossMargin", version."WarningThreshold",
           version."CriticalThreshold"
         FROM organization_guardrail_versions version
         WHERE version."OrganizationId"=$1 AND version."EffectiveFrom"<months."periodEnd"
         ORDER BY version."EffectiveFrom" DESC, version."CreatedAt" DESC LIMIT 1
       ) organization_guardrails ON true
       LEFT JOIN LATERAL (
         SELECT version."TargetGrossMarginOverride", version."WarningThresholdOverride",
           version."CriticalThresholdOverride"
         FROM customer_guardrail_versions version
         WHERE version."OrganizationId"=$1 AND version."CustomerId"=customer."Id"
           AND version."EffectiveFrom"<months."periodEnd"
         ORDER BY version."EffectiveFrom" DESC, version."CreatedAt" DESC LIMIT 1
       ) customer_guardrails ON true
       WHERE customer."OrganizationId"=$1 AND customer."Id"=$2
       ORDER BY months."periodStart" ASC`,
      [org, customerId, start, end],
    );
  }

  async customerForecastUsage(
    org: string,
    customerId: string,
    monthStart: Date,
    monthEnd: Date,
    todayStart: Date,
    tomorrowStart: Date,
  ): Promise<CustomerForecastUsageRow> {
    const rows = await this.dataSource.query<CustomerForecastUsageRow[]>(
      `WITH current_events AS (
         SELECT event."Cost", event."OccurredAt"
         FROM ai_usage_events event
         WHERE event."OrganizationId"=$1 AND event."CustomerId"=$2
           AND event."OccurredAt">=$3 AND event."OccurredAt"<$4
       ), facts AS (
         SELECT COALESCE(SUM("Cost"),0) AS "currentMonthAiCost",
           MIN("OccurredAt") FILTER (WHERE "OccurredAt"<$6) AS "firstUsageAt"
         FROM current_events
       )
       SELECT facts."currentMonthAiCost", facts."firstUsageAt",
         CASE WHEN facts."firstUsageAt" IS NULL THEN 0 ELSE COALESCE((
           SELECT SUM(event."Cost") FROM current_events event
           WHERE event."OccurredAt">=GREATEST(
             $3::timestamptz,
             $5::timestamptz - interval '6 days',
             date_trunc('day', facts."firstUsageAt" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
           ) AND event."OccurredAt"<$6
         ),0) END AS "recentCost"
       FROM facts`,
      [org, customerId, monthStart, monthEnd, todayStart, tomorrowStart],
    );
    return rows[0] ?? { firstUsageAt: null, currentMonthAiCost: '0', recentCost: '0' };
  }

  async organizationForecastUsage(
    org: string,
    monthStart: Date,
    monthEnd: Date,
    todayStart: Date,
    tomorrowStart: Date,
  ): Promise<OrganizationForecastUsageRow> {
    const rows = await this.dataSource.query<OrganizationForecastUsageRow[]>(
      `WITH current_events AS (
         SELECT event."Cost", event."OccurredAt"
         FROM ai_usage_events event
         WHERE event."OrganizationId"=$1
           AND event."OccurredAt">=$2 AND event."OccurredAt"<$3
       ), facts AS (
         SELECT COALESCE(SUM("Cost"),0) AS "currentMonthAiCost",
           MIN("OccurredAt") FILTER (WHERE "OccurredAt"<$5) AS "firstUsageAt"
         FROM current_events
       )
       SELECT COALESCE((
           SELECT SUM(customer."MonthlyRevenue") FROM customers customer
           WHERE customer."OrganizationId"=$1 AND customer."StripeCustomerStatus"<>$6
         ),0) AS "currentRevenue",
         facts."currentMonthAiCost", facts."firstUsageAt",
         CASE WHEN facts."firstUsageAt" IS NULL THEN 0 ELSE COALESCE((
           SELECT SUM(event."Cost") FROM current_events event
           WHERE event."OccurredAt">=GREATEST(
             $2::timestamptz,
             $4::timestamptz - interval '6 days',
             date_trunc('day', facts."firstUsageAt" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
           ) AND event."OccurredAt"<$5
         ),0) END AS "recentCost"
       FROM facts`,
      [org, monthStart, monthEnd, todayStart, tomorrowStart, StripeCustomerStatus.Deleted],
    );
    return (
      rows[0] ?? {
        currentRevenue: '0',
        firstUsageAt: null,
        currentMonthAiCost: '0',
        recentCost: '0',
      }
    );
  }

  customerForecastInputs(
    org: string,
    monthStart: Date,
    monthEnd: Date,
    todayStart: Date,
    tomorrowStart: Date,
  ): Promise<CustomerForecastInputRow[]> {
    return this.dataSource.query<CustomerForecastInputRow[]>(
      `WITH current_events AS (
         SELECT event."CustomerId", event."Cost", event."OccurredAt"
         FROM ai_usage_events event
         WHERE event."OrganizationId"=$1
           AND event."OccurredAt">=$2 AND event."OccurredAt"<$3
       ), facts AS (
         SELECT event."CustomerId",
           COALESCE(SUM(event."Cost"),0) AS "currentMonthAiCost",
           MIN(event."OccurredAt") FILTER (WHERE event."OccurredAt"<$5) AS "firstUsageAt"
         FROM current_events event GROUP BY event."CustomerId"
       ), recent AS (
         SELECT event."CustomerId", COALESCE(SUM(event."Cost"),0) AS "recentCost"
         FROM current_events event
         JOIN facts ON facts."CustomerId"=event."CustomerId"
         WHERE event."OccurredAt">=GREATEST(
             $2::timestamptz,
             $4::timestamptz - interval '6 days',
             date_trunc('day', facts."firstUsageAt" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
           ) AND event."OccurredAt"<$5
         GROUP BY event."CustomerId"
       )
       SELECT customer."Id" AS id, customer."Name" AS name,
         customer."MonthlyRevenue" AS revenue,
         COALESCE(customer."TargetGrossMarginOverride", organization."TargetGrossMargin")
           AS "targetGrossMargin",
         COALESCE(customer."BudgetWarningThresholdOverride", organization."BudgetWarningThreshold")
           AS "warningThreshold",
         COALESCE(customer."BudgetCriticalThresholdOverride", organization."BudgetCriticalThreshold")
           AS "criticalThreshold",
         facts."firstUsageAt",
         COALESCE(facts."currentMonthAiCost",0) AS "currentMonthAiCost",
         COALESCE(recent."recentCost",0) AS "recentCost"
       FROM customers customer
       JOIN organizations organization ON organization."Id"=customer."OrganizationId"
       LEFT JOIN facts ON facts."CustomerId"=customer."Id"
       LEFT JOIN recent ON recent."CustomerId"=customer."Id"
       WHERE customer."OrganizationId"=$1 AND customer."StripeCustomerStatus"<>$6
       ORDER BY customer."Id" ASC`,
      [org, monthStart, monthEnd, todayStart, tomorrowStart, StripeCustomerStatus.Deleted],
    );
  }

  analyticsBreakdown(
    org: string,
    start: Date,
    end: Date,
    dimension: 'Provider' | 'Model' | 'Feature',
  ) {
    return this.dataSource.query<AnalyticsBreakdownRow[]>(
      `SELECT u."${dimension}" AS name, SUM(u."Cost") AS cost, COUNT(*) AS requests
       FROM ai_usage_events u
       WHERE u."OrganizationId"=$1 AND u."OccurredAt">=$2 AND u."OccurredAt"<$3
       GROUP BY u."${dimension}"
       ORDER BY SUM(u."Cost") DESC, u."${dimension}" ASC`,
      [org, start, end],
    );
  }

  analyticsTrend(org: string, start: Date, end: Date) {
    return this.dataSource.query<AnalyticsTrendRow[]>(
      `SELECT date_trunc('day', u."OccurredAt" AT TIME ZONE 'UTC') AS date,
         SUM(u."Cost") AS cost
       FROM ai_usage_events u
       WHERE u."OrganizationId"=$1 AND u."OccurredAt">=$2 AND u."OccurredAt"<$3
       GROUP BY date_trunc('day', u."OccurredAt" AT TIME ZONE 'UTC')
       ORDER BY date_trunc('day', u."OccurredAt" AT TIME ZONE 'UTC') ASC`,
      [org, start, end],
    );
  }
}
