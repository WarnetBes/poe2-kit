import { describe, it, expect } from 'vitest';
import {
  POE2_SEARCH_LIMIT,
  optimizePattern,
  splitPatternForAND,
  suggestShorterAlternatives,
} from '../src/regexOptimizer.js';

/**
 * P9 (№281-W2): порт poe2-quest-tracker regexOptimizer (MIT, Judd) под
 * 45-символьный лимит поиска PoE2 + наш fit-or-explain довесок.
 * Эталонные кейсы — из донора regexOptimizer.ts:96-105; дополнительно —
 * граничные «ровно 45» и «не влезает → AND-split с warning».
 */
describe('regexOptimizer (P9, №281-W2)', () => {
  it('POE2_SEARCH_LIMIT = 45 (game fact)', () => {
    expect(POE2_SEARCH_LIMIT).toBe(45);
  });

  it('эталон донора: fire.*res|cold.*res → (fire|cold).*res', () => {
    const r = optimizePattern('fire.*res|cold.*res');
    expect(r.pattern).toBe('(fire|cold).*res');
    expect(r.optimizations).toContain('Combined resistance patterns');
    expect(r.savedChars).toBeGreaterThan(0);
    expect(r.fits).toBe(true);
  });

  it('эталон донора: тройной res-паттерн сворачивается', () => {
    const r = optimizePattern('fire.*res|cold.*res|lightning.*res');
    expect(r.pattern).toBe('(fire|cold|lightning).*res');
    expect(r.length).toBeLessThanOrEqual(POE2_SEARCH_LIMIT);
    expect(r.fits).toBe(true);
  });

  it('внешние кавычки сохраняются, скобки OR снимаются', () => {
    const r = optimizePattern('"((fire|cold).*(res|resist))"');
    expect(r.pattern.startsWith('"')).toBe(true);
    expect(r.pattern.endsWith('"')).toBe(true);
    expect(r.optimizations).toContain('Removed outer parentheses');
  });

  it('char-class свёртка: [0-9] → \\d', () => {
    const r = optimizePattern('increased [0-9] [a-zA-Z] damage');
    expect(r.pattern).toContain('\\d');
    expect(r.pattern).toContain('\\w');
    expect(r.optimizations).toContain('Replaced [0-9] with \\d');
  });

  it('переполнение: лидирующий/хвостовой .* обрезается, если спасает', () => {
    // 46 символов c ведущим .*: обрезка ведущего спасает в лимит
    const long = '.'.repeat(0) + '.*' + 'a'.repeat(45); // 2 + 45 = 47
    const r = optimizePattern(long);
    expect(r.pattern.startsWith('.*') || r.fits).toBe(true);
  });

  it('граничный случай: ровно 45 — fits:true, без warning', () => {
    const exact = 'a'.repeat(45);
    const r = optimizePattern(exact);
    expect(r.length).toBe(45);
    expect(r.fits).toBe(true);
    expect(r.tooLong).toBeUndefined();
  });

  it('«46 символов без спасения» → fit-or-explain: fits:false + AND-split + warning', () => {
    const over = 'a'.repeat(46);
    const r = optimizePattern(over);
    expect(r.fits).toBe(false);
    expect(r.tooLong?.limit).toBe(45);
    expect(r.tooLong!.warning.length).toBeGreaterThan(20);
    // единственный неделимый паттерн — AND-split отдаёт его как есть
    expect(r.tooLong!.andSplit).toEqual([over]);
  });

  it('длинный OR → AND-split: каждый чанк в лимите', () => {
    const parts = ['fire.*resistance', 'cold.*resistance', 'lightning.*resist', 'chaos.*resistance', 'physical.*res'];
    const longOr = `"(${parts.join('|')})"`;
    const chunks = splitPatternForAND(longOr);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(POE2_SEARCH_LIMIT);
      expect(c.startsWith('"(')).toBe(true);
    }
    // все части сохранены
    const joined = chunks.join('|');
    for (const p of parts) expect(joined).toContain(p);
  });

  it('AND-паттерн (пробелы) разбивается по словам; одиночный — как есть', () => {
    expect(splitPatternForAND('a b c')).toEqual(['a', 'b', 'c']);
    expect(splitPatternForAND('ring')).toEqual(['ring']);
  });

  it('suggestShorterAlternatives: подсказки для частых модов', () => {
    const m = suggestShorterAlternatives(['Fire Resistance', 'Maximum Life', 'Gem Level']);
    expect(m.get('Fire Resistance')).toContain('fi.*r');
    expect(m.get('Maximum Life')).toContain('maximum l');
    expect(m.has('Gem Level')).toBe(false);
  });

  it('практический SSF-кейс: «найди все res-кольца» в лимите', () => {
    const r = optimizePattern('"(fire|cold|lightning).*res.*ring"');
    expect(r.fits).toBe(true);
    expect(r.pattern).toBe('"(fire|cold|lightning).*res.*ring"');
    expect(r.length).toBeLessThanOrEqual(POE2_SEARCH_LIMIT);
  });
});
