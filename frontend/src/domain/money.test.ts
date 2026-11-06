import { describe, expect, it } from 'vitest';
import { formatMoney, fromUnits, percentChange, relativeHeight, signOf, toUnits } from './money';

describe('money formatting', () => {
  it('formats decimal strings without float conversion', () => {
    expect(formatMoney('3482000.0000', 'KRW')).toBe('₩3,482,000');
    expect(formatMoney('-12000', 'KRW')).toBe('−₩12,000');
    expect(formatMoney('10.5000', 'USD')).toBe('$10.50');
    expect(formatMoney('12345678901234567.1234', 'KRW')).toBe('₩12,345,678,901,234,567.1234');
    expect(formatMoney('0.0000', 'KRW', { signed: true })).toBe('₩0');
    expect(formatMoney('5', 'XYZ', { signed: true })).toBe('+XYZ 5');
  });

  it('sums exactly with integer units', () => {
    expect(fromUnits(toUnits('0.1') + toUnits('0.2'))).toBe('0.3000');
    expect(fromUnits(toUnits('-1.5') + toUnits('1'))).toBe('-0.5000');
    expect(toUnits('bad')).toBe(0n);
  });

  it('reports sign, change and bar height for display', () => {
    expect(signOf('-0.0')).toBe(0);
    expect(signOf('-1')).toBe(-1);
    expect(percentChange('110', '100')).toBe('10.0%');
    expect(percentChange('1', '0')).toBeNull();
    expect(relativeHeight('0', '100')).toBe(0);
    expect(relativeHeight('1', '100')).toBe(2);
  });
});
