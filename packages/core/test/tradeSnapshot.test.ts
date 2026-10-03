/**
 * №196-bis (S7-UI): консолидация снапшота каталога статов + surface API.
 *
 * Контролируем:
 *  - tradeSnapshot читает ЕДИНЫЙ файл data/game/trade/trade_stats.json
 *    (старый stats_snapshot.json удалён как дубль) — без него слой фолбэка пуст;
 *  - matchModsToStatFilters: filters/unmatched/liveMatches из реального дампа
 *    без сети (кандидаты текстов порождаются из самого дампа — не хардкод).
 */
import { describe, expect, it, vi } from 'vitest';
import { getTradeStatSnapshot, tradeSnapshotInfo } from '../src/tradeSnapshot.js';
import { matchModsToStatFilters } from '../src/trade.js';

describe('tradeSnapshot: единый файл trade_stats.json (без дубля)', () => {
  it('снапшот загружен и полон (>= 8000 записей, >= 8 групп)', () => {
    const snap = getTradeStatSnapshot();
    expect(snap.length).toBeGreaterThanOrEqual(8000);
    const info = tradeSnapshotInfo();
    expect(info.entries).toBe(snap.length);
    expect(info.groups).toBeGreaterThanOrEqual(8);
    // Форма записи — плоский {id,text,type}
    expect(snap[0]!.id).toMatch(/^(explicit|implicit|pseudo|crafted|fractured|enchant|utility|monster|armour|weapon)\./);
    expect(typeof snap[0]!.text).toBe('string');
  });
});

describe('matchModsToStatFilters: сводка матчинга для UI-баннера', () => {
  it('реальные шаблоны дампа → filters без unmatched, live-fолбэк не дёргался', async () => {
    // Берём explicit-шаблоны прямо из дампа, подставляем число вместо '#'
    // → оффлайн-контур обязан закрыть матчинг сам (0 live, 0 unmatched).
    const templates = getTradeStatSnapshot()
      .filter((e) => e.type === 'explicit' && e.text.includes('#'))
      .slice(0, 3);
    expect(templates.length).toBe(3);
    const mods = templates.map((t) => t.text.replace(/#/g, '10'));
    const { filters, unmatched, liveMatches } = await matchModsToStatFilters(mods);
    expect(filters.length).toBe(3);
    expect(unmatched).toEqual([]);
    expect(liveMatches).toBe(0);
    expect(filters.every((f) => f.id && f.id.startsWith('explicit.'))).toBe(true);
  });

  it('несуществующий мод честно попадает в unmatched (сигнал баннера UI)', async () => {
    // Сеть в unit-тесте запрещена: live-фолбэк обязан спокойно промолчать.
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network disabled in unit test');
    }));
    try {
      const { filters, unmatched } = await matchModsToStatFilters([
        'Absolutely Nonexistent Mod Text 12345',
      ]);
      expect(filters.length).toBe(0);
      expect(unmatched).toEqual(['Absolutely Nonexistent Mod Text 12345']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
