import { utcCalendarMonth } from '../../src/common/helpers/calendar-month.helper';

describe('UTC calendar month', () => {
  it('uses half-open UTC boundaries', () => {
    const { start, end } = utcCalendarMonth(new Date('2026-03-31T23:59:59Z'));
    expect(start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('normalizes offset instants before choosing the month', () => {
    const { start, end } = utcCalendarMonth(new Date('2026-04-01T02:30:00+04:00'));
    expect(start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
});
