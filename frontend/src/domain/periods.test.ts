import { describe, expect, it } from 'vitest';
import { defaultPeriod, formatRange, isValidRange, monthBounds, monthPeriod, shiftYearMonth, todayInSeoul } from './periods';

describe('periods', () => {
  it('uses the Seoul calendar date for today', () => {
    // UTC 2026-11-06 16:00 은 서울 2026-11-07 01:00
    expect(todayInSeoul(new Date(Date.UTC(2026, 10, 6, 16)))).toBe('2026-11-07');
  });

  it('builds month bounds across leap years and year boundaries', () => {
    expect(monthBounds('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(monthBounds('2027-02').end).toBe('2027-02-28');
    expect(shiftYearMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftYearMonth('2026-12', 1)).toBe('2027-01');
  });

  it('limits the current month to today and past months to month end', () => {
    expect(defaultPeriod('2026-11-07')).toEqual({ kind: 'month', start: '2026-11-01', end: '2026-11-07', comparison: 'same_range' });
    expect(monthPeriod('2026-10', '2026-11-07').end).toBe('2026-10-31');
  });

  it('validates and formats ranges', () => {
    expect(isValidRange('2026-11-01', '2026-11-01')).toBe(true);
    expect(isValidRange('2026-11-02', '2026-11-01')).toBe(false);
    expect(formatRange('2026-11-01', '2026-11-07')).toBe('2026.11.01 – 11.07');
    expect(formatRange('2025-12-20', '2026-01-05')).toBe('2025.12.20 – 2026.01.05');
  });
});
