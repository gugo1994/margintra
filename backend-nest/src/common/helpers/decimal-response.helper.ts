import Decimal from 'decimal.js';
export const decimalNumber = (value: Decimal.Value): number => new Decimal(value).toNumber();
export const decimalString = (value: Decimal.Value, scale?: number): string =>
  scale === undefined ? new Decimal(value).toString() : new Decimal(value).toFixed(scale);
