import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { MarginAlertType } from '../../../common/enums/domain.enums';
import { utcCalendarMonth } from '../../../common/helpers/calendar-month.helper';
import {
  AiUsageEventEntity,
  BillingSubscriptionEntity,
  CustomerEntity,
  MarginAlertEntity,
  MarginSnapshotEntity,
  OrganizationEntity,
} from '../../../database/entities';
@Injectable()
export class MarginRepository {
  constructor(private readonly dataSource: DataSource) {}
  manager() {
    return this.dataSource.manager;
  }
  transaction<T>(work: (manager: EntityManager) => Promise<T>) {
    return this.dataSource.transaction(work);
  }
  async target(org: string, manager = this.dataSource.manager) {
    return (await manager.findOneByOrFail(OrganizationEntity, { id: org })).targetGrossMargin;
  }
  async guardrails(org: string, customer: CustomerEntity, manager = this.dataSource.manager) {
    const organization = await manager.findOneByOrFail(OrganizationEntity, { id: org });
    return {
      targetGrossMargin: customer.targetGrossMarginOverride ?? organization.targetGrossMargin,
      warningThreshold:
        customer.budgetWarningThresholdOverride ?? organization.budgetWarningThreshold,
      criticalThreshold:
        customer.budgetCriticalThresholdOverride ?? organization.budgetCriticalThreshold,
    };
  }
  async currentCost(org: string, customer: string, manager = this.dataSource.manager) {
    const { start, end } = utcCalendarMonth();
    const result = await manager
      .createQueryBuilder(AiUsageEventEntity, 'u')
      .select('COALESCE(SUM(u."Cost"),0)', 'cost')
      .where(
        'u."OrganizationId"=:org AND u."CustomerId"=:customer AND u."OccurredAt">=:start AND u."OccurredAt"<:end',
        { org, customer, start, end },
      )
      .getRawOne<{ cost: string }>();
    return result?.cost ?? '0';
  }
  async featureCosts(org: string, customer: string) {
    const { start, end } = utcCalendarMonth();
    return this.dataSource.manager
      .createQueryBuilder(AiUsageEventEntity, 'u')
      .select('u."Feature"', 'feature')
      .addSelect('SUM(u."Cost")', 'cost')
      .where(
        'u."OrganizationId"=:org AND u."CustomerId"=:customer AND u."OccurredAt">=:start AND u."OccurredAt"<:end',
        { org, customer, start, end },
      )
      .groupBy('u."Feature"')
      .orderBy('SUM(u."Cost")', 'DESC')
      .getRawMany<{ feature: string; cost: string }>();
  }
  recent(org: string, customer: string) {
    return this.dataSource.manager.find(AiUsageEventEntity, {
      where: { organizationId: org, customerId: customer },
      order: { occurredAt: 'DESC', id: 'DESC' },
      take: 25,
    });
  }
  snapshot(org: string, customer: string, start: Date, manager: EntityManager) {
    return manager.findOneBy(MarginSnapshotEntity, {
      organizationId: org,
      customerId: customer,
      periodStart: start,
    });
  }
  openAlerts(org: string, customer: string, manager: EntityManager) {
    return manager.find(MarginAlertEntity, {
      where: [
        {
          organizationId: org,
          customerId: customer,
          type: MarginAlertType.MarginBelowTarget,
          resolvedAt: IsNull(),
        },
        {
          organizationId: org,
          customerId: customer,
          type: MarginAlertType.NoRevenueWithCost,
          resolvedAt: IsNull(),
        },
        {
          organizationId: org,
          customerId: customer,
          type: MarginAlertType.AiBudgetWarning,
          resolvedAt: IsNull(),
        },
      ],
    });
  }
  customer(org: string, id: string, manager = this.dataSource.manager) {
    return manager.findOneBy(CustomerEntity, { organizationId: org, id });
  }
  customers(org: string, manager = this.dataSource.manager) {
    return manager.find(CustomerEntity, { where: { organizationId: org } });
  }
  subscriptions(org: string, customer: string) {
    return this.dataSource.manager.find(BillingSubscriptionEntity, {
      where: { organizationId: org, customerId: customer },
      order: { monthlyRecurringRevenue: 'DESC' },
    });
  }
}
