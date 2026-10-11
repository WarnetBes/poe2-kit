import { describe, expect, it } from 'vitest';
import {
  apportionEstCounts,
  normalizeBuildIndexState,
  normalizeMetaLeague,
  trendLabel,
  type MetaLeague,
} from '../src/metaLadder.js';

/** Фикстура в форме живого feed (distill.py:249-256). */
const raw = {
  leagueBuilds: [
    {
      leagueName: 'Forbidden Rites',
      leagueUrl: 'forbiddenrites',
      total: 124248,
      statistics: [
        { class: 'Martial Artist', percentage: 24.5, trend: 1 },
        { class: 'Stormweaver', percentage: 18.2, trend: 0 },
        { class: 'Invoker', percentage: 9.7, trend: -1 },
        { class: 'Unknown New Asc', percentage: 1.3, trend: 0 },
      ],
    },
    {
      leagueName: 'Standard',
      leagueUrl: 'standard',
      total: '55000',
      statistics: [], // permanent-лига: breakdown не публикуется
    },
    {
      leagueName: 'Broken',
      leagueUrl: '', // фальшивый url → пропустить
      total: 99,
      statistics: [{ class: 'Titan', percentage: 50 }],
    },
    {
      leagueName: 'Dup',
      leagueUrl: 'forbiddenrites', // дубликат — НЕ перезаписывает первый
      total: 5,
      statistics: [],
    },
    {
      leagueName: 'Garbage',
      leagueUrl: 'garbage',
      total: 'abc', // мусорный total → 0, не ValueError (distill.py:258-263)
      statistics: [{ class: 'Titan', percentage: 3.3, trend: 1 }],
    },
  ],
};

describe('normalizeBuildIndexState (P7, донор Tincture distill.py, MIT)', () => {
  const leagues: MetaLeague[] = normalizeBuildIndexState(raw);

  it('фальшивые url пропущены, дубли не перезаписывают первый', () => {
    expect(leagues).toHaveLength(3);
    const fr = leagues.find((l) => l.url === 'forbiddenrites')!;
    expect(fr.name).toBe('Forbidden Rites');
    expect(fr.total).toBe(124248); // первый, не Dup(5)
  });

  it('total-мусор coerced в 0, строки с запятыми парсятся', () => {
    const st = leagues.find((l) => l.url === 'standard')!;
    expect(st.total).toBe(55000);
    const gb = leagues.find((l) => l.url === 'garbage')!;
    expect(gb.total).toBe(0);
  });

  it('топы отсортированы по доле, estCount суммарно ≤ total', () => {
    const fr = leagues.find((l) => l.url === 'forbiddenrites')!;
    expect(fr.tops.map((t) => t.asc)).toEqual([
      'Martial Artist', 'Stormweaver', 'Invoker', 'Unknown New Asc',
    ]);
    const sum = fr.tops.reduce((a, t) => a + t.estCount, 0);
    expect(sum).toBeLessThanOrEqual(124248);
    expect(sum).toBeGreaterThan(60000); // 53.7% долей от 124248 ≈ 66.7k
    expect(fr.tops[0]!.estCount).toBeGreaterThan(fr.tops[3]!.estCount);
  });

  it('ASC_TO_CLASS: известные → класс, новые → пустая строка', () => {
    const fr = leagues.find((l) => l.url === 'forbiddenrites')!;
    expect(fr.tops[0]!.className).toBe('Monk'); // Martial Artist
    expect(fr.tops[3]!.className).toBe('');
  });

  it('trend маппится: 1 рост / 0 стабильно / -1 падает', () => {
    const fr = leagues.find((l) => l.url === 'forbiddenrites')!;
    expect(fr.tops[0]!.trend).toBe(1);
    expect(fr.tops[1]!.trend).toBe(0);
    expect(fr.tops[2]!.trend).toBe(-1);
    expect(trendLabel(1)).toBe('растёт');
    expect(trendLabel(0)).toBe('стабильно');
    expect(trendLabel(-1)).toBe('падает');
  });

  it('permanent-лига: пустые tops, честная заглушка (Statistics: [])', () => {
    const st = leagues.find((l) => l.url === 'standard')!;
    expect(st.tops).toEqual([]);
  });

  it('normalizeMetaLeague: без url → null, нечисловые статы пропущены', () => {
    expect(normalizeMetaLeague({ total: 10 })).toBeNull();
    const l = normalizeMetaLeague({
      leagueUrl: 'x',
      total: 100,
      statistics: [
        { class: '', percentage: 5 }, // пустой class → skip
        { class: 'Titan', percentage: 'abc' }, // NaN → skip
        null,
        { class: 'Titan', percentage: 40, trend: 'up' }, // trend-мусор → 0
      ],
    })!;
    expect(l.tops).toHaveLength(1);
    expect(l.tops[0]!.trend).toBe(0);
  });

  it('estCount при total=0 → нули (не деление)', () => {
    const l = normalizeMetaLeague({ leagueUrl: 'z', total: 'x', statistics: [{ class: 'Titan', percentage: 50 }] })!;
    expect(l.total).toBe(0);
    expect(l.tops[0]!.estCount).toBe(0);
  });
});

describe('apportionEstCounts (largest-remainder, distill.py:296-330)', () => {
  it('сумма floor + остатки по убыванию дробной части', () => {
    const ns = apportionEstCounts([30.5, 30.3, 30.2], 100);
    expect(ns.reduce((a, b) => a + b, 0)).toBe(91); // 30.5% ×100/100 → floor 30,30,30 + deficit 1
    expect(ns).toEqual([31, 30, 30]);
  });

  it('доли top-N могут переваливать за 100% — пропорциональный скейл', () => {
    const ns = apportionEstCounts([60, 50], 1000);
    expect(ns.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1000);
    expect(ns[0]).toBeGreaterThan(ns[1]);
  });

  it('пустые доли / нулевой total', () => {
    expect(apportionEstCounts([], 500)).toEqual([]);
    expect(apportionEstCounts([50, 50], 0)).toEqual([0, 0]);
  });
});
