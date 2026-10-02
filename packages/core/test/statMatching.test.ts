/**
 * S7 (№183): слой statMatching — оффлайн-дамп каталога trade2 + live-fallback +
 * learn-слой + HasTradeSupport-разметка. Все тесты офлайн: живой fetch — мок
 * (opts.fetchLive / vi.stubGlobal), датасет — injectable (opts.offlineEntries).
 *
 * Приёмы портированы по идеям Exiled-Exchange-2 (stat-translations.ts) и
 * Sidekick (StatParser.cs, HasTradeSupport) — оба MIT, reimplement-by-design.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  matchStat,
  matchStatsBulk,
  matchStatsBulkResult,
  resetStatMatchingCaches,
  statMatchingInfo,
  type StatCatalogEntry,
} from '../src/statMatching.js';
import { matchModsToStatFilters } from '../src/trade.js';

// Мок-каталог: покрывает все ветки марвчинга (точный/плейсхолдер/negate/combo/legacy).
const MOCK: StatCatalogEntry[] = [
  { id: 'explicit.stat_A1', text: 'Bow Attacks fire an additional Arrow', type: 'explicit' },
  { id: 'explicit.stat_A2', text: 'Adds # to # Physical Damage', type: 'explicit' },
  { id: 'explicit.stat_A3', text: '#% increased Attack Speed', type: 'explicit' },
  { id: 'explicit.stat_A4', text: '#% to Cold Resistance', type: 'explicit' },
  { id: 'implicit.stat_A4', text: '#% to Cold Resistance', type: 'implicit' },
  { id: 'explicit.stat_A5', text: 'Adds 3 to # Lightning Damage to Spells', type: 'explicit' },
  { id: 'explicit.stat_A6', text: 'Whatever stat text here (Legacy)', type: 'explicit' },
];

const offlineOpts = { offlineEntries: MOCK, noLive: true } as const;

beforeEach(() => {
  resetStatMatchingCaches();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('statMatching: оффлайн-мод, базовые макеты', () => {
  it('точный матч без чисел → source offline, id найден', async () => {
    const m = await matchStat('Bow Attacks fire an additional Arrow', offlineOpts);
    expect(m.id).toBe('explicit.stat_A1');
    expect(m.source).toBe('offline');
    expect(m.min).toBeUndefined();
  });

  it('нормализация: трим/регистр/двойные пробелы не ломают lookup', async () => {
    const m = await matchStat('  bow   ATTACKS fire an Additional arrow ', offlineOpts);
    expect(m.id).toBe('explicit.stat_A1');
  });

  it('placeholder с числами: min = max(роллов) × 0.9 (паритет matchStatFilter)', async () => {
    const m = await matchStat('Adds 15 to 25 Physical Damage', offlineOpts);
    expect(m.id).toBe('explicit.stat_A2');
    expect(m.source).toBe('offline');
    expect(m.min).toBeCloseTo(22.5, 5);
  });

  it('preferredType=explicit бьёт implicit-дубль при равном тексте', async () => {
    const m = await matchStat('12% to Cold Resistance', offlineOpts);
    expect(m.id).toBe('explicit.stat_A4');
    expect(m.min).toBeCloseTo(12 * 0.9, 5);
  });

  it('отрицательный ролл: знак срезается в # (−15% ≡ шаблону #% to …)', async () => {
    const m = await matchStat('-15% to Cold Resistance', offlineOpts);
    expect(m.id).toBe('explicit.stat_A4');
    expect(m.min).toBeCloseTo(-15 * 0.9, 5);
  });

  it('negate-вариант: «reduced» матчится к «increased»-шаблону, min не ставится', async () => {
    const m = await matchStat('20% reduced Attack Speed', offlineOpts);
    expect(m.id).toBe('explicit.stat_A3');
    expect(m.source).toBe('offline');
    expect(m.min).toBeUndefined();
  });

  it('родной «reduced»-шаблон каталога бьёт swap-вариант (порядок кандидатов)', async () => {
    const catalogue: StatCatalogEntry[] = [
      ...MOCK,
      { id: 'explicit.stat_A7', text: '#% reduced Flask Charges gained', type: 'explicit' },
    ];
    const m = await matchStat('20% reduced Flask Charges gained', {
      offlineEntries: catalogue,
      noLive: true,
    });
    expect(m.id).toBe('explicit.stat_A7');
  });

  it('combination-кандидат: одно число литеральное в шаблоне — «оставить одно» матчится', async () => {
    const m = await matchStat('Adds 3 to 12 Lightning Damage to Spells', offlineOpts);
    expect(m.id).toBe('explicit.stat_A5');
    // литеральная «3» не участвует в min: min от captures = 12 × 0.9
    expect(m.min).toBeCloseTo(10.8, 5);
  });

  it('legacy-скобки: суффикс «(Legacy)» вырезается с обеих сторон матча', async () => {
    const byItem = await matchStat('Whatever stat text here', offlineOpts);
    expect(byItem.id).toBe('explicit.stat_A6');
    const byTemplate = await matchStat('Whatever stat text here (legacy)', offlineOpts);
    expect(byTemplate.id).toBe('explicit.stat_A6');
  });

  it('unknown: промах офлайн и live запрещён → id null, source unknown', async () => {
    const m = await matchStat('Totally unknown mod text', offlineOpts);
    expect(m.id).toBeNull();
    expect(m.source).toBe('unknown');
  });

  it('больше 4 чисел — комбинации не генерируются (защита от зоопарка), базовые кандидаты живы', async () => {
    const m = await matchStat('1 2 3 4 5', offlineOpts);
    expect(m.source).toBe('unknown');
  });
});

describe('statMatching: live-fallback и мемоизация', () => {
  it('промах офлайн → один живой запрос, source live; второй вызов — из мемо-кэша', async () => {
    let calls = 0;
    const fetchLive = async (): Promise<StatCatalogEntry[]> => {
      calls++;
      return [{ id: 'explicit.stat_L1', text: '#% increased Movement Speed', type: 'explicit' }];
    };
    const opts = { offlineEntries: MOCK, fetchLive };

    const first = await matchStat('30% increased Movement Speed', opts);
    expect(first.id).toBe('explicit.stat_L1');
    expect(first.source).toBe('live');

    // мемоизация: тот же fetcher — сеть не трогаем второй раз
    await matchStat('25% increased Movement Speed', opts);
    await matchStatsBulk(['30% increased Movement Speed'], opts);
    expect(calls).toBe(1);
  });

  it('unknown даже в live: negative-memo не даёт долбить лежащий API', async () => {
    let calls = 0;
    const fetchLive = async (): Promise<StatCatalogEntry[]> => {
      calls++;
      throw new TypeError('fetch failed');
    };
    const opts = { offlineEntries: MOCK, fetchLive };
    const first = await matchStat('Nothing matches this', opts);
    expect(first.source).toBe('unknown');
    // negative-memo: повтор в окне 5 минут — без нового запроса
    const again = await matchStat('Nothing matches this either', opts);
    expect(again.source).toBe('unknown');
    expect(calls).toBe(1);
  });

  it('на bulk — максимум ОДИН live-запрос на список неизвестных статов', async () => {
    let calls = 0;
    const fetchLive = async (): Promise<StatCatalogEntry[]> => {
      calls++;
      return [
        { id: 'explicit.stat_L2', text: '#% increased Evasion Rating', type: 'explicit' },
        { id: 'explicit.stat_L3', text: '#% increased Stun Threshold', type: 'explicit' },
      ];
    };
    const payload = await matchStatsBulk(
      ['120% increased Evasion Rating', '40% increased Stun Threshold', 'Still unknown mod'],
      { offlineEntries: MOCK, fetchLive },
    );
    expect(payload.liveMatches).toBe(2);
    expect(payload.offlineMatches).toBe(0);
    expect(payload.unknown).toEqual(['Still unknown mod']);
    expect(calls).toBe(1);
  });

  it('noLive: живой фолбэк отключается, промах остаётся unknown', async () => {
    const fetchLive = vi.fn(async () => [{ id: 'x', text: '#' }]);
    const m = await matchStat('30% increased Movement Speed', {
      offlineEntries: MOCK,
      fetchLive,
      noLive: true,
    });
    expect(m.source).toBe('unknown');
    expect(fetchLive).not.toHaveBeenCalled();
  });
});

describe('statMatching: bulk + HasTradeSupport + Result-обёртка', () => {
  it('каждый стат размечен trade-ready | text-only (Sidekick-паттерн)', async () => {
    const payload = await matchStatsBulk(
      ['Adds 5 to 9 Physical Damage', 'Mystery non-catalogue mod'],
      offlineOpts,
    );
    expect(payload.matches).toHaveLength(2);
    expect(payload.matches[0]!.tradeReady).toBe(true);
    expect(payload.matches[0]!.match.id).toBe('explicit.stat_A2');
    expect(payload.matches[1]!.tradeReady).toBe(false);
    expect(payload.matches[1]!.match.id).toBeNull();
    expect(payload.unknown).toEqual(['Mystery non-catalogue mod']);
  });

  it('частичный матч → Result ok, unknown перечислен в payload', async () => {
    const r = await matchStatsBulkResult(['Adds 5 to 9 Physical Damage', '??? mod'], offlineOpts);
    expect(r.ok).toBe(true);
    expect(r.payload.unknown).toEqual(['??? mod']);
    if (r.ok) expect(r.data.matches).toHaveLength(2);
  });

  it('полный промах → Result-совместимый err(parse), не ретраится, unknown в payload', async () => {
    const r = await matchStatsBulkResult(['Nope one', 'Nope two'], offlineOpts);
    expect(r.ok).toBe(false);
    expect(r.error.kind).toBe('parse');
    expect(r.error.retryable).toBe(false);
    expect(r.error.message).toContain('Nope one');
    expect(r.payload.unknown).toEqual(['Nope one', 'Nope two']);
  });
});

describe('statMatching: реальный датасет и интеграция trade.ts', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      (() => {
        throw new TypeError('network disabled in offline tests');
      }) as unknown as typeof fetch,
    );
    resetStatMatchingCaches();
  });

  it('бандловый датасет trade_stats.json грузится и матчит реальные тексты (offline, без сети)', async () => {
    const info = statMatchingInfo();
    expect(info.offlineEntries).toBeGreaterThan(5000); // дамп: ~8300 записей + learned
    expect(info.dumpFetchedAt).toBeTruthy();
    expect(info.dumpStale).toBe(false);

    const m = await matchStat('Adds 10 to 20 Physical Damage', { noLive: true });
    expect(m.id).toBeTruthy();
    expect(m.source).toBe('offline');
    expect(m.min).toBeCloseTo(18, 5);
  });

  it('matchModsToStatFilters (trade.ts): фильтры из нового слоя, без сети', async () => {
    const { filters, unmatched } = await matchModsToStatFilters([
      'Adds 10 to 20 Physical Damage',
      '12% to Cold Resistance',
    ]);
    expect(filters).toHaveLength(2);
    expect(filters[0]!.id).toMatch(/^explicit\.stat_\d+/);
    expect(filters[0]!.min).toBeCloseTo(18, 5);
    expect(unmatched).toEqual([]);
  });
});
