import { describe, expect, it } from 'vitest';
import { formatoGs } from './formato.js';

describe('formatoGs', () => {
  it('cero', () => {
    expect(formatoGs(0)).toBe('Gs. 0');
    expect(formatoGs(0n)).toBe('Gs. 0');
    expect(formatoGs(-0)).toBe('Gs. 0');
  });

  it('menos de mil, sin punto', () => {
    expect(formatoGs(5)).toBe('Gs. 5');
    expect(formatoGs(999)).toBe('Gs. 999');
  });

  it('miles y millones con punto de miles', () => {
    expect(formatoGs(1000)).toBe('Gs. 1.000');
    expect(formatoGs(300000)).toBe('Gs. 300.000');
    expect(formatoGs(1250000)).toBe('Gs. 1.250.000');
    expect(formatoGs(1000000000)).toBe('Gs. 1.000.000.000');
  });

  it('negativos con signo menos (U+2212)', () => {
    expect(formatoGs(-15000)).toBe('−Gs. 15.000');
    expect(formatoGs(-1n)).toBe('−Gs. 1');
  });

  it('bigint más allá de Number.MAX_SAFE_INTEGER sin perder precisión', () => {
    expect(formatoGs(9007199254740993n)).toBe('Gs. 9.007.199.254.740.993');
    expect(formatoGs(-123456789012345678901n)).toBe('−Gs. 123.456.789.012.345.678.901');
  });

  it('sin decimales: redondea los number', () => {
    expect(formatoGs(1500.4)).toBe('Gs. 1.500');
    expect(formatoGs(1500.5)).toBe('Gs. 1.501');
  });

  it('rechaza NaN e Infinity', () => {
    expect(() => formatoGs(Number.NaN)).toThrow(RangeError);
    expect(() => formatoGs(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
