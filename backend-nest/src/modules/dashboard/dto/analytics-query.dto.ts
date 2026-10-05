import { Type } from 'class-transformer';
import { IsEnum, IsISO8601, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

export enum AnalyticsRange {
  SevenDays = '7d',
  ThirtyDays = '30d',
  CurrentMonth = 'current_month',
  PreviousMonth = 'previous_month',
  Custom = 'custom',
}

export enum AnalyticsSort {
  HighestAiCost = 'highest_ai_cost',
  LowestGrossMargin = 'lowest_gross_margin',
  HighestRevenue = 'highest_revenue',
  HighestGrossProfit = 'highest_gross_profit',
}

export enum AnalyticsCustomerStatus {
  All = 'all',
  Healthy = 'healthy',
  Warning = 'warning',
  Critical = 'critical',
}

export class AnalyticsQueryDto {
  @IsOptional()
  @IsEnum(AnalyticsRange)
  range: AnalyticsRange = AnalyticsRange.CurrentMonth;

  @ValidateIf((value: AnalyticsQueryDto) => value.range === AnalyticsRange.Custom)
  @IsISO8601({ strict: true })
  startDate?: string;

  @ValidateIf((value: AnalyticsQueryDto) => value.range === AnalyticsRange.Custom)
  @IsISO8601({ strict: true })
  endDate?: string;

  @IsOptional()
  @IsEnum(AnalyticsSort)
  sort: AnalyticsSort = AnalyticsSort.LowestGrossMargin;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  @IsOptional()
  @IsEnum(AnalyticsCustomerStatus)
  status: AnalyticsCustomerStatus = AnalyticsCustomerStatus.All;
}

export class CustomerProfitabilityHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  start?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  end?: string;
}
