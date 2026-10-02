import { describe, it, expect } from 'vitest';
import {
  applyStatHandlers,
  statRangeMatches,
  resolveStatTags,
  normalizeStatPattern,
  findStatIdByPattern,
  renderStatText,
  statDescSupportedHandlers,
  getStatDescRecord,
} from '../src/statdesc.js';

// Датасет data/game/stat_descriptions/*.json лежит в репо — тесты офлайн.

describe('statdesc: applyStatHandlers', () => {
  it('числовые шаги-индексы пропускаются, функции применяются', () => {
    expect(applyStatHandlers(['negate'], 5)).toBe(-5);
    expect(applyStatHandlers(['1'], 5)).toBe(5); // индекс плейсхолдера
    expect(applyStatHandlers(['negate', '1'], 40)).toBe(-40);
    expect(applyStatHandlers(['canonical_line'], 7)).toBe(7);
    expect(applyStatHandlers(['times_twenty'], 3)).toBe(60);
    expect(applyStatHandlers(['per_minute_to_per_second'], 240)).toBeCloseTo(4, 10);
    expect(applyStatHandlers(['milliseconds_to_seconds'], 1500)).toBe(2);
  });

  it('неизвестная функция → null (честный отказ, не неверное число)', () => {
    expect(applyStatHandlers(['no_such_fn'], 5)).toBeNull();
    expect(applyStatHandlers(['negate', 'no_such_fn'], 5)).toBeNull();
  });
});

describe('statdesc: statRangeMatches', () => {
  it('"#" и null — любое значение', () => {
    expect(statRangeMatches('#', -100)).toBe(true);
    expect(statRangeMatches(null, 555)).toBe(true);
  });

  it('точное значение, отрицание, диапазоны', () => {
    expect(statRangeMatches('5', 5)).toBe(true);
    expect(statRangeMatches('5', 6)).toBe(false);
    expect(statRangeMatches('!0', 0)).toBe(false);
    expect(statRangeMatches('!0', 3)).toBe(true);
    expect(statRangeMatches('1|5', 3)).toBe(true);
    expect(statRangeMatches('1|5', 6)).toBe(false);
    expect(statRangeMatches('10|#', 999)).toBe(true);
    expect(statRangeMatches('#|10', 5)).toBe(true);
    expect(statRangeMatches('#|10', 999)).toBe(false);
    expect(statRangeMatches('10|#', 5)).toBe(false);
  });
});

describe('statdesc: теги и нормализация', () => {
  it('resolveStatTags: [Tag|Display] → Display, [Tag] → Tag', () => {
    expect(resolveStatTags('[Totem|Totems]')).toBe('Totems');
    expect(resolveStatTags('[Glory]')).toBe('Glory');
  });

  it('normalizeStatPattern: плейсхолдеры и числа → "#", lower, пробелы схлопнуты', () => {
    expect(normalizeStatPattern('{0:+d} to maximum Life')).toBe('# to maximum life');
    expect(normalizeStatPattern('+40 to maximum Life')).toBe('# to maximum life');
    expect(normalizeStatPattern('{0:+d}  to   maximum Life')).toBe('# to maximum life');
    // trade-текст и шаблон датамайна эквивалентны после нормализации
    expect(normalizeStatPattern('# to maximum Life')).toBe(
      normalizeStatPattern('{0:+d} to maximum Life'),
    );
  });
});

describe('statdesc: рендер по реальному датасету (офлайн, из репо)', () => {
  it('base_maximum_life + 40 → "+40 to maximum Life"', () => {
    expect(renderStatText('base_maximum_life', 40)).toBe('+40 to maximum Life');
  });

  it('findStatIdByPattern("# to maximum life") → base_maximum_life', () => {
    const hit = findStatIdByPattern('# to maximum life');
    expect(hit?.statId).toBe('base_maximum_life');
    expect(hit?.template).toContain('maximum Life');
  });

  it('неизвестный stat_id и запись без подходящей ветки → null', () => {
    expect(renderStatText('totally_unknown_stat_id_xyz', 1)).toBeNull();
    expect(getStatDescRecord('totally_unknown_stat_id_xyz')).toBeNull();
  });

  it('все поддержанные handlers дают не-null на эталонном значении', () => {
    for (const h of statDescSupportedHandlers()) {
      expect(applyStatHandlers([h], 100)).not.toBeNull();
    }
  });
});
