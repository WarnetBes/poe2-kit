/**
 * Этап 2 (№246): stat-id — первичный ключ матчинга, текст — фолбэк.
 *
 * Обоснование (EU-дайджест _research/poe2_eu_digest_2026-10.md §2.1 п.7):
 * торговый UI в DE/FR/PT-клиентах отдаёт СМЕСЬ EN и локализованных строк,
 * FR-текст длиннее EN на ~25% (обрезки), один термин переведён двумя
 * способами ⇒ матчинг по тексту ненадёжен вне EN-клиента.
 *
 * Проверяем: (а) DE-строка с EN-вкраплением матчится по stat-id идентично
 * EN-строке; (б) FR-обрезка не влияет на stat-id-матчинг; (в) i18n-алиасы
 * («Wegstein», «Piedra guía», …) распознаются в text-фолбэке; (г) дефолтное
 * поведение (без новых параметров) — как раньше (additive-поле matchedBy).
 *
 * Каталог — injectable (opts.offlineEntries), алиасы — реальный
 * data/game/i18n/aliases.json (офлайн, без сети).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  matchStat,
  matchStatsBulkResult,
  resetStatMatchingCaches,
  type StatCatalogEntry,
} from '../src/statMatching.js';
import {
  getI18nTermAliases,
  i18nAliasesMeta,
  resetI18nAliasesCache,
} from '../src/i18nAliases.js';
import { matchModsToStatFilters } from '../src/trade.js';

// Мок-каталог с терминами, покрытыми алиасами (Waystone/Tier/Delirium),
// и классическими плейсхолдер-шаблонами (регресс кейсы).
const MOCK: StatCatalogEntry[] = [
  { id: 'explicit.stat_W1', text: 'Waystone (Tier #) Delirium Reward', type: 'explicit' },
  { id: 'explicit.stat_AC1', text: 'Adds # to # Physical Damage', type: 'explicit' },
  { id: 'explicit.stat_S1', text: '#% increased Attack Speed', type: 'explicit' },
];

const offlineOpts = { offlineEntries: MOCK, noLive: true } as const;

beforeEach(() => {
  resetStatMatchingCaches();
  resetI18nAliasesCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Этап 2 №246: data-файл i18n-алиасов (честность данных)', () => {
  it('aliases.json грузится: термины из дайджестов, патч-мета на месте', () => {
    const terms = getI18nTermAliases();
    expect(terms.length).toBeGreaterThanOrEqual(15);
    const ens = terms.map((t) => t.en);
    for (const expected of [
      'Waystone',
      'Exalted Orb',
      'Divine Orb',
      'Simulacrum',
      'Simulacrum Splinter',
      'Delirium',
      'Tier',
      'Chaos Orb',
      'Shrine',
    ]) {
      expect(ens).toContain(expected);
    }
    expect(i18nAliasesMeta().patch).toBe('0.5.x');
    expect(i18nAliasesMeta().languages).toEqual(['de', 'es', 'fr', 'pt', 'ru']);
  });

  it('честность: Simulacrum без pt, Delirium без de (не переведено — не выдумано)', () => {
    const terms = getI18nTermAliases();
    const sim = terms.find((t) => t.en === 'Simulacrum');
    const del = terms.find((t) => t.en === 'Delirium');
    expect(sim).toBeTruthy();
    expect(del).toBeTruthy();
    expect(sim!.pt).toBeUndefined(); // PT: «Simulacrum» не переведён (EU-дайджест §2)
    expect(del!.de).toBeUndefined(); // DE: «Delirium» не переведён (EU-дайджест §2)
    expect(sim!.de).toEqual(['Simulakrum']);
    expect(del!.ru).toEqual(['Делириум']); // офиц. RU (RU-дайджест §1.2)
  });

  it('Heist=«Кража»/Blight=«Скверна» НЕ включены (PoE1-заимствования, проверка отложена до 1.0)', () => {
    const ens = getI18nTermAliases().map((t) => t.en);
    expect(ens).not.toContain('Heist');
    expect(ens).not.toContain('Blight');
  });

  it('дубль-термин Shrine = «Святыня»/«Алтарь» — матчатся оба варианта', () => {
    const shrine = getI18nTermAliases().find((t) => t.en === 'Shrine');
    expect(shrine!.ru).toEqual(['Святыня', 'Алтарь']);
  });
});

describe('Этап 2 №246: stat-id — первичный ключ (MatchStrategy)', () => {
  it('(а) DE-строка с EN-вкраплением: stat-id-матч идентичен EN-строке', async () => {
    const en = await matchStat('Waystone (Tier 12) Delirium Reward', offlineOpts);
    expect(en.id).toBe('explicit.stat_W1');
    expect(en.matchedBy).toBe('text'); // EN-текст — родной текст-матч

    const de = await matchStat(
      { text: 'Wegstein (Level 12) mit Delirium Reward', id: 'explicit.stat_W1' },
      offlineOpts,
    );
    expect(de.id).toBe('explicit.stat_W1');
    expect(de.matchedBy).toBe('stat-id'); // id-первичный: локаль не влияет
    expect(de.id).toBe(en.id);

    // Без id та же DE-смесь текстом НЕ матчится («mit» нет в каталоге) —
    // честный unknown, а не подгонка.
    const deNoId = await matchStat('Wegstein (Level 12) mit Delirium Reward', offlineOpts);
    expect(deNoId.id).toBeNull();
    expect(deNoId.source).toBe('unknown');
  });

  it('(б) FR-обрезка текста не влияет на stat-id-матчинг', async () => {
    // FR-текст длиннее EN на ~25% → строки обрезаются (EU-дайджест §2.1 п.1);
    // обрезок не существует ни в одном каталоге — id-матч переживает всё.
    const fr = await matchStat(
      { text: 'Pierre de téléporta', id: 'explicit.stat_W1' },
      offlineOpts,
    );
    expect(fr.id).toBe('explicit.stat_W1');
    expect(fr.matchedBy).toBe('stat-id');
    expect(fr.source).toBe('offline');
    expect(fr.matchedText).toBe('Waystone (Tier #) Delirium Reward');
    expect(fr.min).toBeUndefined(); // числа из обрезка не извлекаются — честно

    const textOnly = await matchStat('Pierre de téléporta', offlineOpts);
    expect(textOnly.id).toBeNull();
  });

  it('strategy=‘text’ форсирует текст-путь (id входа игнорируется) — поведение до №246', async () => {
    const m = await matchStat(
      { text: 'Adds 4 to 8 Physical Damage', id: 'explicit.stat_W1' },
      { ...offlineOpts, strategy: 'text' },
    );
    expect(m.id).toBe('explicit.stat_AC1'); // матч по ТЕКСТУ, а не по навязанному id
    expect(m.matchedBy).toBe('text');
  });

  it('неизвестный датасету id → прозрачно падаем в text-фолбэк', async () => {
    const m = await matchStat(
      { text: 'Adds 4 to 8 Physical Damage', id: 'explicit.stat_GHOST' },
      offlineOpts,
    );
    expect(m.id).toBe('explicit.stat_AC1');
    expect(m.matchedBy).toBe('text');
  });

  it('bulk Result-обёртка: matchedBy размечен per-stat, unknown — честно', async () => {
    const r = await matchStatsBulkResult(
      [
        'Adds 4 to 8 Physical Damage',
        { text: 'Wegstein (Level 12) mit Delirium Reward', id: 'explicit.stat_W1' },
        { text: 'Совсем неизвестный мод' },
      ],
      offlineOpts,
    );
    expect(r.ok).toBe(true);
    expect(r.payload.matches).toHaveLength(3);
    expect(r.payload.matches[0]!.match.matchedBy).toBe('text');
    expect(r.payload.matches[1]!.match.matchedBy).toBe('stat-id');
    expect(r.payload.matches[1]!.match.id).toBe('explicit.stat_W1');
    expect(r.payload.matches[2]!.tradeReady).toBe(false);
    expect(r.payload.unknown).toEqual(['Совсем неизвестный мод']);
  });
});

describe('Этап 2 №246: i18n-алиасы в text-фолбэке (расширение вариантов)', () => {
  it('(в-DE) «Wegstein (Level 12)» матчится к Waystone-моду', async () => {
    const m = await matchStat('Wegstein (Level 12) Delirium Reward', offlineOpts);
    expect(m.id).toBe('explicit.stat_W1');
    expect(m.matchedBy).toBe('text');
    expect(m.matchedText).toBe('Waystone (Tier #) Delirium Reward');
  });

  it('(в-ES) «Piedra guía (grado 5)» распознаётся', async () => {
    const m = await matchStat('Piedra guía (grado 5) Delirio Reward', offlineOpts);
    expect(m.id).toBe('explicit.stat_W1');
  });

  it('(в-FR/PT/RU) Pierre de téléportation / Pedra-guia / Путевой камень (Ур. N)', async () => {
    expect((await matchStat('Pierre de téléportation (Palier 3) Délire Reward', offlineOpts)).id).toBe(
      'explicit.stat_W1',
    );
    expect((await matchStat('Pedra-guia (Nível 2) Delírio Reward', offlineOpts)).id).toBe(
      'explicit.stat_W1',
    );
    // Официальный RU-термин («Путевой камень», НЕ «камень пути» — RU-дайджест §1.2)
    expect((await matchStat('Путевой камень (Ур. 7) Делириум Reward', offlineOpts)).id).toBe(
      'explicit.stat_W1',
    );
  });

  it('родной EN-кандидат бьёт алиас-вариант (порядок кандидатов не сломан)', async () => {
    // «Waystone» в EN-строке — родной матч, алиасы вообще не участвуют.
    const m = await matchStat('Waystone (Tier 12) Delirium Reward', offlineOpts);
    expect(m.id).toBe('explicit.stat_W1');
    expect(m.matchedText).toBe('Waystone (Tier #) Delirium Reward');
    // EN-строки со словом «Level»/«Attack Speed» не страдают от tier-алиаса:
    const s = await matchStat('12% increased Attack Speed', offlineOpts);
    expect(s.id).toBe('explicit.stat_S1');
  });

  it('(г) регресс: дефолт без новых параметров — прежний результат + matchedBy:text', async () => {
    const m = await matchStat('Adds 4 to 8 Physical Damage', offlineOpts);
    expect(m).toEqual({
      id: 'explicit.stat_AC1',
      source: 'offline',
      text: 'Adds 4 to 8 Physical Damage',
      matchedBy: 'text',
      min: 7.2, // 8 × 0.9 — паритет matchStatFilter
      matchedText: 'Adds # to # Physical Damage',
    });
  });
});

describe('Этап 2 №246: trade.ts проксирует стратегию (реальный датасет, offline)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      (() => {
        throw new TypeError('network disabled in offline tests');
      }) as unknown as typeof fetch,
    );
    resetStatMatchingCaches();
    resetI18nAliasesCache();
  });

  it('matchModsToStatFilters: известный stat-id бьёт мусорный/локализованный текст', async () => {
    // Шаг 1: узнём реальный id из живого дампа текстовым матчем.
    const probe = await matchModsToStatFilters([{ text: 'Adds 10 to 20 Physical Damage' }]);
    expect(probe.filters).toHaveLength(1);
    const realId = probe.filters[0]!.id!;
    expect(realId).toMatch(/^explicit\.stat_\d+/);

    // Шаг 2: тот же id с текстом, который текстом НЕ матчится
    // (DE-смесь, EN-вкрапление) — id-первичный матч cứuет прайс-чек.
    const viaId = await matchModsToStatFilters([
      { text: 'Erhabene Sphäre fügt 10 bis 20 physical Damage hinzu', id: realId },
    ]);
    expect(viaId.filters).toHaveLength(1);
    expect(viaId.filters[0]!.id).toBe(realId);

    // Контроль: тот же текст БЕЗ id — unknown, ничего не выдумано.
    const noId = await matchModsToStatFilters([
      { text: 'Erhabene Sphäre fügt 10 bis 20 physical Damage hinzu' },
    ]);
    expect(noId.filters).toEqual([]);
    expect(noId.unmatched).toHaveLength(1);
  });
});
