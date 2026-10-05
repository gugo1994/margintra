import { BadRequestException } from '@nestjs/common';
import {
  AnalyticsQueryDto,
  AnalyticsRange,
  AnalyticsSort,
} from '../../src/modules/dashboard/dto/analytics-query.dto';
import { AnalyticsRangeService } from '../../src/modules/dashboard/services/analytics-range.service';

describe('AnalyticsRangeService', () => {
  const service = new AnalyticsRangeService();
  const now = new Date('2026-08-31T14:00:00Z');
  const query = (range: AnalyticsRange): AnalyticsQueryDto =>
    Object.assign(new AnalyticsQueryDto(), {
      range,
      sort: AnalyticsSort.LowestGrossMargin,
    });

  it.each([
    [AnalyticsRange.SevenDays, '2026-08-25T00:00:00.000Z', '2026-09-01T00:00:00.000Z'],
    [AnalyticsRange.ThirtyDays, '2026-08-02T00:00:00.000Z', '2026-09-01T00:00:00.000Z'],
    [AnalyticsRange.CurrentMonth, '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'],
    [AnalyticsRange.PreviousMonth, '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'],
  ])('resolves %s to a half-open UTC interval', (range, start, end) => {
    const result = service.resolve(query(range), now);
    expect(result.start.toISOString()).toBe(start);
    expect(result.end.toISOString()).toBe(end);
  });

  it('makes a custom end date inclusive by returning the next UTC midnight', () => {
    const result = service.resolve(
      Object.assign(query(AnalyticsRange.Custom), {
        startDate: '2026-08-05',
        endDate: '2026-08-07',
      }),
      now,
    );
    expect(result.start.toISOString()).toBe('2026-08-05T00:00:00.000Z');
    expect(result.end.toISOString()).toBe('2026-08-08T00:00:00.000Z');
  });

  it.each([
    [AnalyticsRange.SevenDays, '2026-08-18T00:00:00.000Z', '2026-08-25T00:00:00.000Z'],
    [AnalyticsRange.ThirtyDays, '2026-07-03T00:00:00.000Z', '2026-08-02T00:00:00.000Z'],
    [AnalyticsRange.CurrentMonth, '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'],
    [AnalyticsRange.PreviousMonth, '2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'],
  ])('resolves the previous comparable %s interval', (range, start, end) => {
    const selected = service.resolve(query(range), now);
    const previous = service.previous(query(range), selected);
    expect(previous.start.toISOString()).toBe(start);
    expect(previous.end.toISOString()).toBe(end);
  });

  it('uses the same duration immediately before a custom interval', () => {
    const custom = Object.assign(query(AnalyticsRange.Custom), {
      startDate: '2026-08-05',
      endDate: '2026-08-07',
    });
    const previous = service.previous(custom, service.resolve(custom, now));
    expect(previous.start.toISOString()).toBe('2026-08-02T00:00:00.000Z');
    expect(previous.end.toISOString()).toBe('2026-08-05T00:00:00.000Z');
  });

  it('rejects reversed and impossible custom dates', () => {
    expect(() =>
      service.resolve(
        Object.assign(query(AnalyticsRange.Custom), {
          startDate: '2026-08-08',
          endDate: '2026-08-05',
        }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      service.resolve(
        Object.assign(query(AnalyticsRange.Custom), {
          startDate: '2026-02-30',
          endDate: '2026-03-01',
        }),
      ),
    ).toThrow(BadRequestException);
  });
});
