import { describe, it, expect } from 'vitest';
import { getWaystoneSearchRegex, getVendorRegexPatterns, getWaystoneModGroups } from '../src/dataset.js';

/**
 * P9-мерж (№281-W2): waystone_mods.json + search_regex (poe2-quest-tracker MIT)
 * и vendor_regex.json. Наши PoB-tier-группы НЕ изменены (вектор регрессии №236);
 * донорские паттерны — verified=false (данные 2025-12, до 0.5 Forbidden Rites).
 */
describe('waystone search_regex + vendor_regex (P9, №281-W2)', () => {
  it('PoB-tier-группы не тронуты: 74 группы, префиксы/суффиксы', () => {
    const groups = getWaystoneModGroups();
    expect(groups.length).toBe(74);
    expect(groups.filter((g) => g.kind === 'prefix').length).toBe(43);
    expect(groups.filter((g) => g.kind === 'suffix').length).toBe(31);
    expect(groups.every((g) => g.verified === true)).toBe(true);
  });

  it('search_regex: 48 донорских записей, каждая с regex в лимите 45', () => {
    const pool = getWaystoneSearchRegex();
    expect(pool.length).toBe(48);
    for (const e of pool) {
      expect(e.id).toBeTruthy();
      expect(e.regex.length).toBeLessThanOrEqual(45);
      expect(typeof e.isPositive).toBe('boolean');
    }
    expect(pool.some((e) => e.id === 'magic_ignited' && e.regex === 'ign')).toBe(true);
  });

  it('search_regex: категории донора на месте', () => {
    const cats = new Set(getWaystoneSearchRegex().map((e) => e.category));
    for (const c of ['Magic+', 'Rare+', 'Packs', 'Rewards']) expect(cats.has(c)).toBe(true);
  });

  it('vendor_regex: 78 записей, class-паттерны в лимите 45', () => {
    const items = getVendorRegexPatterns();
    expect(items.length).toBe(78);
    const rings = items.find((i) => i.id === 'rings')!;
    expect(rings.regex).toBe('class.*ring');
    expect(rings.regex.length).toBeLessThanOrEqual(45);
    expect(items.every((i) => i.regex.length <= 45)).toBe(true);
  });
});
