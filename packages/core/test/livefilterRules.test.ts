import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHUNK_SIZE,
  MAX_AUTO_STACK,
  MIN_EXCEPTIONAL_LISTINGS_TO_HIDE,
  MIN_UNIQUE_LISTINGS_TO_HIDE,
  LIVE_FILTER_SCHEMA_VERSION,
  generateDynamicBlock,
  parseUncutGemLevel,
  validateSnapshot,
  type CurrencyPrice,
  type KnownFilterSets,
  type LiveFilterSnapshot,
} from '../src/livefilter/rules.js';

/** Фиксированный снапшот для golden-теста (все цены в exalts). */
function makeSnapshot(over: Partial<LiveFilterSnapshot> = {}): LiveFilterSnapshot {
  const cur: CurrencyPrice[] = [
    { name: 'Divine Orb', category: 'currency', valueEx: 500 },
    { name: 'Chaos Orb', category: 'currency', valueEx: 0.5 },
    { name: 'Exalted Orb', category: 'currency', valueEx: 1 },
    { name: 'Uncut Spirit Gem (Level 20)', category: 'gems', valueEx: 30 },
    { name: 'Awakeners Orb', category: 'currency', valueEx: 200 },
    { name: 'Scroll of Wisdom', category: 'currency', valueEx: 0.001 }, // слишком дешёвая даже для стека
  ];
  return {
    schemaVersion: LIVE_FILTER_SCHEMA_VERSION,
    league: 'forbiddenrites',
    generatedAt: '2026-10-12T00:00:00Z',
    rates: { divineEx: 500, chaosEx: 0.5 },
    currency: cur,
    uniqueBases: {
      Amulet: {
        topName: 'Prismatic Grasp', maxEx: 900,
        uniques: [{ name: 'Prismatic Grasp', category: 'amulet', valueEx: 900, listings: 12 }],
      },
      Ring: {
        topName: 'Sad Sprint', maxEx: 2,
        uniques: [{ name: 'Sad Sprint', category: 'ring', valueEx: 2, listings: 15 }],
      },
      Belt: {
        topName: 'Void Coil', maxEx: 1,
        uniques: [{ name: 'Void Coil', category: 'belt', valueEx: 1, listings: 2 }], // < 3 listings — guardrail
      },
    },
    exceptional: [
      { base: 'Half Plate', kind: 'sockets', min: 5, minIlvl: 79, maxIlvl: 81, valueEx: 100, listings: 30, samples: 10 },
      { base: 'Goat Hide', kind: 'quality', min: 30, valueEx: 0.4, listings: 40, samples: 20 }, // дешёвая — no proof-hide
    ],
    sources: { poeninja: { ok: true, fetchedAt: '2026-10-12T00:00:00Z' } },
    ...over,
  };
}

const KNOWN: KnownFilterSets = {
  classes: new Set(['Amulets', 'Rings', 'Uncut Gems', 'Waystones', 'Body Armours', 'Helmets']),
  bases: new Set([
    'Divine Orb', 'Chaos Orb', 'Exalted Orb', 'Awakeners Orb', 'Scroll of Wisdom',
    'Amulet', 'Ring', 'Belt', 'Half Plate', 'Goat Hide',
  ]),
};

describe('validateSnapshot (порт snapshot.go:98-112)', () => {
  const ok = makeSnapshot();
  it('годный снапшот → пустая строка', () => {
    expect(validateSnapshot(ok)).toBe('');
    expect(validateSnapshot(null)).toBe('пустой снапшот');
  });
  it('schema mismatch / нет divine / нет данных → ошибки', () => {
    expect(validateSnapshot(makeSnapshot({ schemaVersion: 99 }))).toContain('schema_version');
    expect(validateSnapshot(makeSnapshot({ rates: { divineEx: 0, chaosEx: 1 } }))).toContain('divine');
    expect(validateSnapshot(makeSnapshot({ currency: [], uniqueBases: {} }))).toContain('нет данных');
  });
});

describe('guardrails-константы (rules.go:23-29)', () => {
  it('minimum evidence before HIDE', () => {
    expect(MIN_UNIQUE_LISTINGS_TO_HIDE).toBe(3);
    expect(MIN_EXCEPTIONAL_LISTINGS_TO_HIDE).toBe(10);
    expect(MAX_AUTO_STACK).toBe(50);
    expect(DEFAULT_CHUNK_SIZE).toBe(15);
  });

  it('уник-база без листингов НЕ скрывается (Belt: 2 listings < 3)', () => {
    const { text, stats } = generateDynamicBlock(makeSnapshot(), { thresholdEx: 10 }, KNOWN);
    expect(text).not.toMatch(/Hide[\s\S]*?BaseType == "Belt"/);
    expect(stats.cheapUniqueBases).toBe(1); // только Ring спрятан
    expect(text).toMatch(/# cheap unique bases/);
  });
});

describe('generateDynamicBlock — семантика групп', () => {
  const cfg = { thresholdEx: 10, alwaysShow: ['Exalted Orb'], uncutGemMinLevel: 15, waystoneMinTier: 5 };

  it('self-rate: Divine/Chaos по rates, не по листингу (rules.go:263-273)', () => {
    const snap = makeSnapshot({
      currency: [
        { name: 'Divine Orb', category: 'currency', valueEx: 0.001 }, // листинг-мусор
        { name: 'Chaos Orb', category: 'currency', valueEx: 999 }, // листинг-спайк
      ],
    });
    const { text, stats } = generateDynamicBlock(snap, cfg, KNOWN);
    expect(text).toMatch(/divine spotlight/);
    // Divine по self-rate 500 → ценный; Chaos по self-rate 0.5 → дешёвый авто-стек x20
    expect(stats.valuableCurrency).toBe(1);
    expect(text).toMatch(/auto-stack: Chaos Orb x20/);
  });

  it('авто-стек: N = ceil(threshold/unit), потолок MAX_AUTO_STACK; Scroll of Wisdom — plain Hide', () => {
    const { text, stats } = generateDynamicBlock(makeSnapshot(), { thresholdEx: 10 }, KNOWN);
    // Chaos 0.5 ex → стек 20; Exalted 1 ex → стек x10; Awakeners → ценный;
    // Scroll 0.001 ex → N=10000 > MAX_AUTO_STACK → plain Hide
    expect(text).toMatch(/auto-stack: Chaos Orb x20/);
    expect(text).toMatch(/StackSize >= 20/);
    expect(text).toMatch(/auto-stack: Exalted Orb x10/);
    expect(stats.stackRules).toBe(2);
    expect(text).toMatch(/cheap currency below threshold/);
    expect(text).toMatch(/BaseType == "Scroll of Wisdom"/);
  });

  it('uncut gems — по GemLevel-слайдеру, НЕ по цене (дешёвый ценный гем не в ценном Show)', () => {
    const { text } = generateDynamicBlock(makeSnapshot(), cfg, KNOWN);
    expect(text).toMatch(/uncut gems >= level 15/);
    expect(text).toMatch(/GemLevel >= 15/);
    expect(text).toMatch(/valuable uncut gems \(level 20\)/);
    expect(text).toMatch(/GemLevel == 20/);
  });

  it('waystones — WaystoneTier-слайдер', () => {
    const { text } = generateDynamicBlock(makeSnapshot(), cfg, KNOWN);
    expect(text).toMatch(/waystones >= tier 5/);
    expect(text).toMatch(/WaystoneTier < 5/);
  });

  it('exceptional: ilvl-бакеты 79-81 в Show; дешёвый без proof — не прячется', () => {
    const { text } = generateDynamicBlock(makeSnapshot(), { thresholdEx: 10 }, KNOWN);
    expect(text).toMatch(/exceptional sockets >= 5 ilvl 79-81/);
    expect(text).toMatch(/ItemLevel >= 79/);
    expect(text).toMatch(/ItemLevel <= 81/);
    expect(text).toMatch(/Sockets >= 5/);
    expect(text).toMatch(/Rarity == "Normal"/);
    expect(text).not.toMatch(/Hide[\s\S]*?"Goat Hide"/);
  });

  it('порядок групп: first-match-wins — всегда-show/дивайн/ценное ДО любых Hide', () => {
    const { text } = generateDynamicBlock(makeSnapshot(), cfg, KNOWN);
    const firstHide = text.indexOf('\nHide');
    for (const marker of ['auto-stack', 'always-show', 'divine spotlight', 'value tier', 'valuable unique bases']) {
      expect(text.indexOf(marker)).toBeGreaterThan(-1);
      expect(text.indexOf(marker)).toBeLessThan(firstHide);
    }
  });

  it('known-sets: незнакомая валюта не попадает в блок, фиксируется warning', () => {
    const snap = makeSnapshot({
      currency: [{ name: 'Catalyst', category: 'currency', valueEx: 999 }],
    });
    const { text, stats } = generateDynamicBlock(snap, { thresholdEx: 10 }, KNOWN);
    expect(text).not.toMatch(/Catalyst/);
    expect(stats.warnings.join(' ')).toContain('Catalyst');
  });

  it('инъекция переноса строки в имени не может начать свою строку (rules.go:60-65)', () => {
    const snap = makeSnapshot({
      currency: [{ name: 'Evil\nOrb', category: 'currency', valueEx: 500 }],
      uniqueBases: {},
      exceptional: [],
    });
    // known не задан → имя без канонизации попадает в сериализацию, где и санируется
    const { text } = generateDynamicBlock(snap, { thresholdEx: 10, hideLowRarityGear: false });
    expect(text).toMatch(/"Evil Orb"/); // \n срезан до пробела
    // ни одна строка текста не начинается с осколка имени
    for (const line of text.split('\n')) expect(line.startsWith('Orb')).toBe(false);
  });

  it('blanket gear Hide: Rarity Normal/Magic loose + только известные классы', () => {
    const { text } = generateDynamicBlock(makeSnapshot(), { thresholdEx: 10 }, KNOWN);
    expect(text).toMatch(/Rarity "Normal" "Magic"/); // loose-список, без == (двусмысленность = грабля)
    expect(text).toMatch(/Class == "Amulets" "Body Armours" "Helmets" "Rings"/); // гир-классы донора (rules.go:166-170); Uncut Gems/Waystones НЕ гир
    expect(text).not.toMatch(/low-rarity gear[\s\S]*?"Uncut Gems"/);
    expect(text).not.toMatch(/low-rarity gear[\s\S]*?"Waystones"/);
  });

  it('golden: полный текст на фиксированном снапшоте детерминирован', () => {
    const a = generateDynamicBlock(makeSnapshot(), cfg, KNOWN);
    const b = generateDynamicBlock(makeSnapshot(), cfg, KNOWN);
    expect(a.text).toBe(b.text);
    expect(a.text).toMatch(/^#={20,}\n# \[\[DYNAMIC LOOT FILTER\]\]/m);
    expect(a.text).toMatch(/# \[\[END DYNAMIC LOOT FILTER\]\]/);
  });

  it('дегенеративный снапшот: пустая валюта — блок без Hide-валюты, guardrails не прячут', () => {
    const { text, stats } = generateDynamicBlock(
      makeSnapshot({ currency: [{ name: 'Exalted Orb', category: 'currency', valueEx: 1 }], uniqueBases: {} }),
      { thresholdEx: 5 },
      KNOWN,
    );
    expect(text).not.toMatch(/cheap currency below threshold/);
    expect(text).not.toMatch(/cheap unique bases/);
    // Exalted (1 ex < порога 5) спасён авто-стеком x5, НЕ спрятан — guardrail честен
    expect(stats.cheapCurrency).toBe(1);
    expect(stats.stackRules).toBe(1);
    expect(stats.cheapUniqueBases).toBe(0);
    expect(text).toMatch(/auto-stack: Exalted Orb x5/);
  });
});

describe('parseUncutGemLevel', () => {
  it('«Uncut Spirit Gem (Level 20)» → 20; прочее → null', () => {
    expect(parseUncutGemLevel('Uncut Spirit Gem (Level 20)')).toBe(20);
    expect(parseUncutGemLevel('Uncut Skil Gem (Level 7)')).toBe(7);
    expect(parseUncutGemLevel('Divine Orb')).toBeNull();
  });
});
