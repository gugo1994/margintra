import { BadRequestException, Injectable } from '@nestjs/common';
import { AnalyticsQueryDto, AnalyticsRange } from '../dto/analytics-query.dto';

export interface AnalyticsPeriod {
  start: Date;
  end: Date;
}

@Injectable()
export class AnalyticsRangeService {
  resolve(query: AnalyticsQueryDto, now = new Date()): AnalyticsPeriod {
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    if (query.range === AnalyticsRange.SevenDays)
      return { start: this.daysBefore(tomorrow, 7), end: tomorrow };
    if (query.range === AnalyticsRange.ThirtyDays)
      return { start: this.daysBefore(tomorrow, 30), end: tomorrow };
    if (query.range === AnalyticsRange.PreviousMonth) {
      return {
        start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
        end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      };
    }
    if (query.range === AnalyticsRange.Custom) {
      const start = this.utcDate(query.startDate!);
      const end = this.utcDate(query.endDate!);
      end.setUTCDate(end.getUTCDate() + 1);
      if (start >= end) throw new BadRequestException('startDate must not be after endDate.');
      return { start, end };
    }
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    };
  }

  previous(query: AnalyticsQueryDto, period: AnalyticsPeriod): AnalyticsPeriod {
    const end = new Date(period.start);
    if (
      query.range === AnalyticsRange.CurrentMonth ||
      query.range === AnalyticsRange.PreviousMonth
    ) {
      return {
        start: new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1)),
        end,
      };
    }
    return {
      start: new Date(period.start.getTime() - (period.end.getTime() - period.start.getTime())),
      end,
    };
  }

  private daysBefore(value: Date, days: number) {
    const result = new Date(value);
    result.setUTCDate(result.getUTCDate() - days);
    return result;
  }

  private utcDate(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new BadRequestException('Custom dates must use YYYY-MM-DD.');
    const result = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== value)
      throw new BadRequestException('Custom dates must be valid calendar dates.');
    return result;
  }
}
