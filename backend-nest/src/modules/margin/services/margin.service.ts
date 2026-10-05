import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  AlertSeverity,
  BudgetState,
  MarginAlertType,
  RevenueSource,
  StripeCustomerStatus,
} from '../../../common/enums/domain.enums';
import { NotFoundError } from '../../../common/errors/application.error';
import { decimalNumber, decimalString } from '../../../common/helpers/decimal-response.helper';
import { utcCalendarMonth } from '../../../common/helpers/calendar-month.helper';
import {
  CustomerEntity,
  MarginAlertEntity,
  MarginSnapshotEntity,
} from '../../../database/entities';
import { MarginCalculationResult, MarginCalculator } from '../calculators/margin-calculator';
import { MarginRepository } from '../repositories/margin.repository';
import { NotificationService } from '../../notifications/notification.service';
@Injectable()
export class MarginService {
  constructor(
    private readonly repository: MarginRepository,
    private readonly calculator: MarginCalculator,
    private readonly notifications: NotificationService,
  ) {}
  async get(org: string, customerId: string) {
    const customer = await this.repository.customer(org, customerId);
    if (!customer) throw new NotFoundError();
    const result = await this.calculate(org, customer);
    const features = (await this.repository.featureCosts(org, customerId)).map((x) => ({
      feature: x.feature,
      cost: decimalNumber(x.cost),
    }));
    const recent = (await this.repository.recent(org, customerId)).map((x) => ({
      id: x.id,
      provider: x.provider,
      model: x.model,
      feature: x.feature,
      inputTokens: Number(x.inputTokens),
      outputTokens: Number(x.outputTokens),
      cost: decimalNumber(x.cost),
      occurredAt: x.occurredAt.toISOString(),
    }));
    const subscriptions =
      customer.revenueSource === RevenueSource.Stripe
        ? (await this.repository.subscriptions(org, customerId)).map((x) => ({
            id: x.id,
            externalSubscriptionId: x.externalSubscriptionId,
            name: x.name,
            status: x.status,
            currency: x.currency,
            monthlyRecurringRevenue: decimalNumber(x.monthlyRecurringRevenue),
            currentPeriodStart: x.currentPeriodStart?.toISOString() ?? null,
            currentPeriodEnd: x.currentPeriodEnd?.toISOString() ?? null,
            cancelAtPeriodEnd: x.cancelAtPeriodEnd,
            warning: x.warning,
          }))
        : null;
    return {
      customerId: customer.id,
      name: customer.name,
      ...this.response(result),
      features,
      recentUsage: recent,
      revenueSource: customer.revenueSource === RevenueSource.Stripe ? 'stripe' : 'manual',
      stripeCustomerId: customer.stripeCustomerId,
      revenueStale: customer.revenueStale,
      revenueUpdatedAt: customer.revenueUpdatedAt?.toISOString() ?? null,
      subscriptions,
      stripeCustomerStatus: this.stripeStatus(customer.stripeCustomerStatus),
      targetGrossMarginOverride:
        customer.targetGrossMarginOverride === null
          ? null
          : decimalNumber(customer.targetGrossMarginOverride),
      warningThresholdOverride:
        customer.budgetWarningThresholdOverride === null
          ? null
          : decimalNumber(customer.budgetWarningThresholdOverride),
      criticalThresholdOverride:
        customer.budgetCriticalThresholdOverride === null
          ? null
          : decimalNumber(customer.budgetCriticalThresholdOverride),
    };
  }
  async calculate(org: string, customer: CustomerEntity, manager?: EntityManager) {
    const guardrails = await this.repository.guardrails(org, customer, manager);
    return this.calculator.calculate({
      revenue: customer.monthlyRevenue,
      aiCost: await this.repository.currentCost(org, customer.id, manager),
      ...guardrails,
    });
  }
  async recalculate(org: string, customerId: string, manager?: EntityManager) {
    if (manager) {
      const customer = await this.repository.customer(org, customerId, manager);
      if (customer) await this.persist(org, customer, manager);
      return;
    }
    await this.repository.transaction(async (tx) => {
      const customer = await this.repository.customer(org, customerId, tx);
      if (customer) await this.persist(org, customer, tx);
    });
  }
  private async persist(org: string, customer: CustomerEntity, manager: EntityManager) {
    const result = await this.calculate(org, customer, manager);
    const { start, end } = utcCalendarMonth();
    let snapshot = await this.repository.snapshot(org, customer.id, start, manager);
    const now = new Date();
    if (!snapshot)
      snapshot = manager.create(MarginSnapshotEntity, {
        id: randomUUID(),
        organizationId: org,
        customerId: customer.id,
        periodStart: start,
        periodEnd: end,
        createdAt: now,
      });
    Object.assign(snapshot, {
      revenue: decimalString(result.revenue, 2),
      aiCost: decimalString(result.aiCost, 6),
      grossProfit: decimalString(result.grossProfit, 6),
      grossMargin: result.grossMargin ? decimalString(result.grossMargin, 4) : null,
      allowedAiBudget: decimalString(result.allowedAiBudget, 6),
      remainingAiBudget: decimalString(result.remainingAiBudget, 6),
      updatedAt: now,
    });
    await manager.save(snapshot);
    await this.updateAlerts(org, customer.id, result, manager);
  }
  private async updateAlerts(
    org: string,
    customerId: string,
    result: MarginCalculationResult,
    manager: EntityManager,
  ) {
    const alerts = await this.repository.openAlerts(org, customerId, manager);
    const margin = alerts.find((x) => x.type === MarginAlertType.MarginBelowTarget);
    const budgetWarning = alerts.find((x) => x.type === MarginAlertType.AiBudgetWarning);
    const noRevenue = alerts.find((x) => x.type === MarginAlertType.NoRevenueWithCost);
    const now = new Date();
    if (result.budgetState === BudgetState.Healthy) {
      await this.resolveAlert(margin, now, org, manager);
      await this.resolveAlert(budgetWarning, now, org, manager);
      await this.resolveAlert(noRevenue, now, org, manager);
    } else if (result.revenue.isZero()) {
      await this.resolveAlert(margin, now, org, manager);
      await this.resolveAlert(budgetWarning, now, org, manager);
      await this.upsertAlert(
        noRevenue,
        MarginAlertType.NoRevenueWithCost,
        AlertSeverity.Critical,
        'AI cost is being incurred with no current revenue.',
        org,
        customerId,
        manager,
      );
    } else {
      await this.resolveAlert(noRevenue, now, org, manager);
      const severity =
        result.budgetState === BudgetState.Critical
          ? AlertSeverity.Critical
          : AlertSeverity.Warning;
      const budgetExhausted = result.remainingAiBudget.lte(0);
      const type = budgetExhausted
        ? MarginAlertType.MarginBelowTarget
        : MarginAlertType.AiBudgetWarning;
      if (type === MarginAlertType.MarginBelowTarget)
        await this.resolveAlert(budgetWarning, now, org, manager);
      if (type === MarginAlertType.AiBudgetWarning)
        await this.resolveAlert(margin, now, org, manager);
      await this.upsertAlert(
        type === MarginAlertType.MarginBelowTarget ? margin : budgetWarning,
        type,
        severity,
        result.budgetState === BudgetState.Critical
          ? `AI budget is critical: ${result.budgetUsedPercent!.toFixed(2)}% used with ${result.remainingAiBudget.toFixed(2)} remaining.`
          : `AI budget warning: ${result.budgetUsedPercent!.toFixed(2)}% used (warning at ${result.warningThreshold.toFixed(2)}%).`,
        org,
        customerId,
        manager,
      );
    }
    await manager.save(alerts);
  }
  private async upsertAlert(
    current: MarginAlertEntity | undefined,
    type: MarginAlertType,
    severity: AlertSeverity,
    message: string,
    org: string,
    customerId: string,
    manager: EntityManager,
  ) {
    if (current) {
      const previousSeverity = current.severity;
      current.severity = severity;
      current.message = message;
      if (previousSeverity !== severity)
        await this.notifications.enqueue(
          org,
          current.id,
          severity,
          severity === AlertSeverity.Critical ? 'escalated_critical' : 'deescalated_warning',
          manager,
        );
      return;
    }
    const created = await manager.save(
      manager.create(MarginAlertEntity, {
        id: randomUUID(),
        organizationId: org,
        customerId,
        type,
        severity,
        message,
        metadataJson: '{}',
        resolvedAt: null,
        createdAt: new Date(),
      }),
    );
    await this.notifications.enqueue(
      org,
      created.id,
      severity,
      severity === AlertSeverity.Critical ? 'opened_critical' : 'opened_warning',
      manager,
    );
  }
  private async resolveAlert(
    alert: MarginAlertEntity | undefined,
    now: Date,
    org: string,
    manager: EntityManager,
  ) {
    if (!alert || alert.resolvedAt) return;
    alert.resolvedAt = now;
    await this.notifications.enqueue(org, alert.id, alert.severity, 'resolved', manager);
  }
  response(x: MarginCalculationResult) {
    return {
      revenue: decimalNumber(x.revenue),
      aiCost: decimalNumber(x.aiCost),
      grossProfit: decimalNumber(x.grossProfit),
      grossMargin: x.grossMargin ? decimalNumber(x.grossMargin) : null,
      targetGrossMargin: decimalNumber(x.targetGrossMargin),
      allowedAiBudget: decimalNumber(x.allowedAiBudget),
      remainingAiBudget: decimalNumber(x.remainingAiBudget),
      budgetUsedPercent: x.budgetUsedPercent ? decimalNumber(x.budgetUsedPercent) : null,
      warningThreshold: decimalNumber(x.warningThreshold),
      criticalThreshold: decimalNumber(x.criticalThreshold),
      budgetState: x.budgetState,
      status: x.status,
    };
  }
  private stripeStatus(x: StripeCustomerStatus) {
    return x === StripeCustomerStatus.Active
      ? 'active'
      : x === StripeCustomerStatus.Deleted
        ? 'deleted'
        : 'unknown';
  }
}
