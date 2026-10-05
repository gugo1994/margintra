import Decimal from 'decimal.js';
import { BudgetState, MarginStatus } from '../../src/common/enums/domain.enums';
import { decimalNumber, decimalString } from '../../src/common/helpers/decimal-response.helper';
import { MarginCalculator } from '../../src/modules/margin/calculators/margin-calculator';

describe('MarginCalculator', () => {
  const calculator = new MarginCalculator();

  test.each([
    { revenue: 100, cost: 20, status: MarginStatus.Healthy, margin: '80' },
    { revenue: 100, cost: 35, status: MarginStatus.AtRisk, margin: '65' },
    { revenue: 100, cost: 100, status: MarginStatus.Critical, margin: '0' },
    { revenue: 100, cost: 120, status: MarginStatus.Critical, margin: '-20' },
  ])('calculates $status profitability for $revenue/$cost', (value) => {
    const result = calculator.calculate({
      revenue: value.revenue,
      aiCost: value.cost,
      targetGrossMargin: 70,
    });
    expect(result.status).toBe(value.status);
    expect(result.grossMargin?.eq(value.margin)).toBe(true);
  });

  it('calculates gross profit, allowed budget, and remaining budget exactly', () => {
    const result = calculator.calculate({ revenue: 100, aiCost: 35, targetGrossMargin: 70 });
    expect(result.grossProfit.eq(65)).toBe(true);
    expect(result.allowedAiBudget.eq(30)).toBe(true);
    expect(result.remainingAiBudget.eq(-5)).toBe(true);
  });

  it('represents zero revenue and zero cost as NoRevenue with no margin', () => {
    const result = calculator.calculate({ revenue: 0, aiCost: 0, targetGrossMargin: 70 });
    expect(result.status).toBe(MarginStatus.NoRevenue);
    expect(result.grossMargin).toBeNull();
    expect(result.remainingAiBudget.eq(0)).toBe(true);
    expect(result.budgetUsedPercent).toBeNull();
    expect(result.budgetState).toBe(BudgetState.Healthy);
  });

  it('represents zero revenue with cost as Critical with no margin', () => {
    const result = calculator.calculate({ revenue: 0, aiCost: 10, targetGrossMargin: 70 });
    expect(result.status).toBe(MarginStatus.Critical);
    expect(result.grossProfit.eq(-10)).toBe(true);
    expect(result.grossMargin).toBeNull();
    expect(result.budgetState).toBe(BudgetState.Critical);
  });

  it('applies warning and configurable critical budget thresholds', () => {
    const warning = calculator.calculate({
      revenue: 100,
      aiCost: 24,
      targetGrossMargin: 70,
      warningThreshold: 80,
      criticalThreshold: 95,
    });
    expect(warning.allowedAiBudget.eq(30)).toBe(true);
    expect(warning.remainingAiBudget.eq(6)).toBe(true);
    expect(warning.budgetUsedPercent?.eq(80)).toBe(true);
    expect(warning.budgetState).toBe(BudgetState.Warning);
    const critical = calculator.calculate({
      revenue: 100,
      aiCost: '28.5',
      targetGrossMargin: 70,
      warningThreshold: 80,
      criticalThreshold: 95,
    });
    expect(critical.budgetUsedPercent?.eq(95)).toBe(true);
    expect(critical.budgetState).toBe(BudgetState.Critical);
  });

  it('uses Decimal precision at the warning boundary', () => {
    const below = calculator.calculate({
      revenue: '99',
      aiCost: '23.759999999999',
      targetGrossMargin: '70',
      warningThreshold: '80',
      criticalThreshold: '100',
    });
    const exact = calculator.calculate({
      revenue: '99',
      aiCost: '23.76',
      targetGrossMargin: '70',
      warningThreshold: '80',
      criticalThreshold: '100',
    });
    expect(below.budgetState).toBe(BudgetState.Healthy);
    expect(exact.budgetUsedPercent?.eq(80)).toBe(true);
    expect(exact.budgetState).toBe(BudgetState.Warning);
  });

  it('retains and intentionally serializes repeating-decimal precision', () => {
    const result = calculator.calculate({ revenue: '99', aiCost: '40', targetGrossMargin: '70' });
    const expected = new Decimal(59).div(99).mul(100);
    expect(result.grossMargin?.eq(expected)).toBe(true);
    expect(decimalString(result.grossMargin!, 12)).toBe('59.595959595960');
    expect(decimalNumber(result.grossMargin!)).toBeCloseTo(59.5959595959596, 13);
  });

  test.each([
    [-1, 0, 70],
    [1, -1, 70],
    [1, 0, 0],
    [1, 0, 100],
  ])('rejects invalid values %s/%s/%s', (revenue, aiCost, targetGrossMargin) => {
    expect(() => calculator.calculate({ revenue, aiCost, targetGrossMargin })).toThrow(RangeError);
  });
  it('rejects inverted guardrail thresholds', () => {
    expect(() =>
      calculator.calculate({
        revenue: 100,
        aiCost: 1,
        targetGrossMargin: 70,
        warningThreshold: 90,
        criticalThreshold: 80,
      }),
    ).toThrow(RangeError);
  });
});
