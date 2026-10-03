/**
 * №197 (S10): тесты flagSuspiciousListings — чистая локальная скам-эвристика.
 *  Проверяем пороги, границы применимости и отсутствие ложных пометок.
 */

import { describe, expect, it } from 'vitest';
import { flagSuspiciousListings, SUSPICIOUS_CHEAP_REL, SUSPICIOUS_EXPENSIVE_REL } from '../src/trade.js';
import type { PriceEstimate, TradeListing } from '../src/types.js';

function est(median: number, confidence: PriceEstimate['confidence'] = 'exact'): PriceEstimate {
  return { median, confidence };
}

function listing(price: number, chaos: number | null): TradeListing {
  return { price, currency: chaos == null ? 'exotic' : 'divine', chaos };
}

describe('flagSuspiciousListings', () => {
  it('помечает too-cheap при цене <= 25% медианы', () => {
    const ls = [listing(5, 5), listing(30, 30)];
    const n = flagSuspiciousListings(ls, est(30));
    expect(n).toBe(1);
    expect(ls[0].flags).toEqual(['too-cheap']);
    expect(ls[1].flags).toBeUndefined();
  });

  it('помечает overpriced при цене >= 4× медианы', () => {
    const ls = [listing(125, 125), listing(10, 10)];
    const n = flagSuspiciousListings(ls, est(30));
    expect(n).toBe(1);
    expect(ls[0].flags).toEqual(['overpriced']);
  });

  it('не вешает флаги при low confidence и отсутствии estimate', () => {
    const ls = [listing(1, 1), listing(50, 50)];
    expect(flagSuspiciousListings(ls, est(20, 'low'))).toBe(0);
    expect(flagSuspiciousListings(ls, null)).toBe(0);
    expect(flagSuspiciousListings(ls, est(20, 'no-data'))).toBe(0);
    expect(ls[0].flags).toBeUndefined();
  });

  it('не вешает флаги при медиане < 5 chaos', () => {
    const ls = [listing(1, 1), listing(4, 4)];
    expect(flagSuspiciousListings(ls, est(4)).valueOf()).toBe(0);
    expect(ls[0].flags).toBeUndefined();
  });

  it('игнорирует листинги без курса (chaos == null) и нулевые цены', () => {
    const ls = [listing(1, null), listing(0, 0)];
    expect(flagSuspiciousListings(ls, est(100))).toBe(0);
    expect(ls[0].flags).toBeUndefined();
    expect(ls[1].flags).toBeUndefined();
  });

  it('снимает устаревший флаг при повторном прогоне без срабатывания', () => {
    // chaos=15 при медиане 30: в границах нормы — флаг должен сняться
    const ls = [listing(15, 15)];
    ls[0].flags = ['too-cheap'];
    flagSuspiciousListings(ls, est(30));
    expect(ls[0].flags).toBeUndefined();
  });

  it('граничные значения: ровно пороги тоже флажатся (<= и >=)', () => {
    const median = 40;
    const ls = [listing(0.1, median * SUSPICIOUS_CHEAP_REL), listing(999, median * SUSPICIOUS_EXPENSIVE_REL)];
    const n = flagSuspiciousListings(ls, est(median));
    expect(n).toBe(2);
    expect(ls[0].flags).toEqual(['too-cheap']);
    expect(ls[1].flags).toEqual(['overpriced']);
  });
});
