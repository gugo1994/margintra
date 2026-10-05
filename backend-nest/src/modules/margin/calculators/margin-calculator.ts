import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { BudgetState, MarginStatus } from '../../../common/enums/domain.enums';
export interface MarginCalculationInput {
  revenue: Decimal.Value;
  aiCost: Decimal.Value;
  targetGrossMargin: Decimal.Value;
  warningThreshold?: Decimal.Value;
  criticalThreshold?: Decimal.Value;
}
export interface MarginCalculationResult {
  revenue: Decimal;
  aiCost: Decimal;
  grossProfit: Decimal;
  grossMargin: Decimal | null;
  targetGrossMargin: Decimal;
  allowedAiBudget: Decimal;
  remainingAiBudget: Decimal;
  budgetUsedPercent: Decimal | null;
  warningThreshold: Decimal;
  criticalThreshold: Decimal;
  budgetState: BudgetState;
  status: MarginStatus;
}
export interface IMarginCalculator {
  calculate(input: MarginCalculationInput): MarginCalculationResult;
}
@Injectable()
export class MarginCalculator implements IMarginCalculator {
  calculate(input: MarginCalculationInput): MarginCalculationResult {
    const revenue = new Decimal(input.revenue);
    const aiCost = new Decimal(input.aiCost);
    const target = new Decimal(input.targetGrossMargin);
    const warningThreshold = new Decimal(input.warningThreshold ?? 80);
    const criticalThreshold = new Decimal(input.criticalThreshold ?? 100);
    if (
      revenue.isNegative() ||
      aiCost.isNegative() ||
      target.lte(0) ||
      target.gte(100) ||
      warningThreshold.isNegative() ||
      warningThreshold.gte(criticalThreshold) ||
      criticalThreshold.gt(100)
    )
      throw new RangeError('Invalid margin calculation input.');
    const grossProfit = revenue.minus(aiCost);
    const grossMargin = revenue.isZero() ? null : grossProfit.div(revenue).mul(100);
    const allowedAiBudget = revenue.mul(new Decimal(1).minus(target.div(100)));
    const remainingAiBudget = allowedAiBudget.minus(aiCost);
    const budgetUsedPercent = allowedAiBudget.isZero()
      ? null
      : aiCost.div(allowedAiBudget).mul(100);
    const status = revenue.isZero()
      ? aiCost.isZero()
        ? MarginStatus.NoRevenue
        : MarginStatus.Critical
      : aiCost.gte(revenue) && aiCost.gt(0)
        ? MarginStatus.Critical
        : grossMargin!.lt(target)
          ? MarginStatus.AtRisk
          : MarginStatus.Healthy;
    const budgetState = revenue.isZero()
      ? aiCost.isZero()
        ? BudgetState.Healthy
        : BudgetState.Critical
      : remainingAiBudget.lte(0) ||
          budgetUsedPercent!.gte(criticalThreshold) ||
          status === MarginStatus.Critical
        ? BudgetState.Critical
        : budgetUsedPercent!.gte(warningThreshold)
          ? BudgetState.Warning
          : BudgetState.Healthy;
    return {
      revenue,
      aiCost,
      grossProfit,
      grossMargin,
      targetGrossMargin: target,
      allowedAiBudget,
      remainingAiBudget,
      budgetUsedPercent,
      warningThreshold,
      criticalThreshold,
      budgetState,
      status,
    };
  }
}
