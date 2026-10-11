import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as fsSync from 'node:fs';
import * as pathSync from 'node:path';
import * as osSync from 'node:os';
import { maxModSlots, resolveModTiers, tiersBadgeText } from '../src/modTiers.js';
import { resetRepoeCaches } from '../src/repoe.js';
import { resetHttpState } from '../src/http.js';

// ─── Фейковый RePoE: минимальные base_items.json + mods.json ─────────────────

const FAKE_BASE_ITEMS = {
  gloves: {
    domain: 'item',
    release_state: 'released',
    name: 'Leather Gloves',
    item_class: 'Gloves',
    tags: ['gloves', 'armour', 'default', 'agility'],
    drop_level: 3,
    properties: { armour: { min: 42 } },
    requirements: { level: 3 },
  },
};

const FAKE_MODS = {
  // Линейка suffix "+# to Maximum Life": T1 (lvl45, 40–50), T2 (lvl10, 10–20)
  life_t1: {
    domain: 'item',
    generation_type: 'suffix',
    name: 'Of the Health',
    required_level: 45,
    stats: [{ min: 40, max: 50 }],
    text: '+# to Maximum Life',
    type: 'life_stat',
    groups: ['maximum_life'],
    spawn_weights: [{ tag: 'gloves', weight: 1000 }, { tag: 'default', weight: 0 }],
  },
  life_t2: {
    domain: 'item',
    generation_type: 'suffix',
    name: 'Of the Health',
    required_level: 10,
    stats: [{ min: 10, max: 20 }],
    text: '+# to Maximum Life',
    type: 'life_stat',
    groups: ['maximum_life'],
    spawn_weights: [{ tag: 'gloves', weight: 1000 }, { tag: 'default', weight: 0 }],
  },
  // Префикс: холод к атакам
  cold_t1: {
    domain: 'item',
    generation_type: 'prefix',
    name: 'Frost',
    required_level: 50,
    stats: [{ min: 20, max: 30 }],
    text: 'Adds # to # Cold Damage to Attacks',
    type: 'cold_attacks',
    groups: ['cold_attacks'],
    spawn_weights: [{ tag: 'gloves', weight: 500 }, { tag: 'default', weight: 0 }],
  },
  // Реальный формат RePoE: диапазон в скобках. Клиент покажет «13% increased
  // Attack Speed» — регрессия на выравнивание «(5-7)%» vs «13%» (живая находка P2).
  as_t1: {
    domain: 'item',
    generation_type: 'suffix',
    name: 'of the Swift',
    required_level: 37,
    stats: [{ min: 11, max: 13 }],
    text: '(11-13)% increased Attack Speed',
    type: 'attack_speed',
    groups: ['attack_speed'],
    spawn_weights: [{ tag: 'gloves', weight: 800 }, { tag: 'default', weight: 0 }],
  },
  // Essence-only не должен индексироваться
  essence_life: {
    domain: 'item',
    generation_type: 'prefix',
    name: 'Essence',
    required_level: 1,
    stats: [{ min: 60, max: 70 }],
    text: '+# to Maximum Life',
    type: 'life_stat',
    groups: ['maximum_life'],
    is_essence_only: true,
    spawn_weights: [{ tag: 'gloves', weight: 1000 }],
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubRepoe(): void {
  vi.stubGlobal('fetch', ((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/base_items.json')) return Promise.resolve(jsonResponse(200, FAKE_BASE_ITEMS));
    if (url.endsWith('/mods.json')) return Promise.resolve(jsonResponse(200, FAKE_MODS));
    return Promise.reject(new TypeError('unexpected url ' + url));
  }) as typeof fetch);
}

const RARE_GLOVES = `Rarity: Rare
Storm Warden
Leather Gloves
--------
Quality: +20%
Armour: 42
--------
Item Level: 50
--------
+20 to Maximum Life
Adds 25 to 25 Cold Damage to Attacks
13% increased Attack Speed
+12 to Strength (implicit)
`;

const MAGIC_GLOVES = `Rarity: Magic
Sturdy Leather Gloves
Leather Gloves
--------
Item Level: 12
--------
+15 to Maximum Life
`;

describe('modTiers: maxModSlots', () => {
  it('Rare 3/3, Magic 1/1, прочее 0/0 (семантика poe2-mcp-server)', () => {
    expect(maxModSlots('Rare')).toEqual({ prefixes: 3, suffixes: 3 });
    expect(maxModSlots('Magic')).toEqual({ prefixes: 1, suffixes: 1 });
    expect(maxModSlots('Unique')).toEqual({ prefixes: 0, suffixes: 0 });
    expect(maxModSlots('Normal')).toEqual({ prefixes: 0, suffixes: 0 });
  });
});

describe('modTiers: tiersBadgeText', () => {
  it('«T2 из 5»-формат бейджа', () => {
    expect(tiersBadgeText({ tier: 2, totalTiers: 5 })).toBe('T2 из 5');
    expect(tiersBadgeText({ tier: 1, totalTiers: 1 })).toBe('T1 из 1');
  });
});

describe('modTiers: resolveModTiers (фейковый RePoE)', () => {
  beforeEach(() => {
    resetRepoeCaches();
    resetHttpState(); // статический лимит repoe-fork.github.io 5/60с — чистые окна на каждый тест
    stubRepoe();
    process.env['POE2_KIT_CACHE_DIR'] = fsSync.mkdtempSync(
      pathSync.join(osSync.tmpdir(), 'poe2kit-modtiers-test-'),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Rare-предмет: тиры, rollPct, слоты, unmatched-implicit', async () => {
    const d = await resolveModTiers(RARE_GLOVES);
    expect(d.base?.name).toBe('Leather Gloves');
    // explicit-моды: +20 к жизни (ни в один тир — 10..20 это T2? 20 в границе!)
    // значение 20 попадает в T2 (10–20): сортировка по req level ↓: T1=45lvl, T2=10lvl.
    const life = d.modTiers.find((t) => t.modText.includes('Maximum Life'));
    expect(life).toBeDefined();
    expect(life!.tier).toBe(2);
    expect(life!.totalTiers).toBe(2);
    expect(life!.range).toEqual([10, 20]);
    expect(life!.prefixSuffix).toBe('suffix');
    expect(life!.bestTierAtIlvl).toBe(1); // ilvl 50 → доступен T1
    expect(life!.rollPct).toBe(100); // 20 = потолок T2

    const cold = d.modTiers.find((t) => t.modText.includes('Cold Damage'));
    expect(cold).toBeDefined();
    expect(cold!.tier).toBe(1);
    expect(cold!.prefixSuffix).toBe('prefix');
    expect(cold!.rollPct).toBe(50); // 25 в [20..30]

    // «(11-13)% increased Attack Speed» (RePoE) vs «13% increased Attack Speed» (клиент)
    const as = d.modTiers.find((t) => t.modText.includes('Attack Speed'));
    expect(as).toBeDefined();
    expect(as!.tier).toBe(1);
    expect(as!.totalTiers).toBe(1);
    expect(as!.prefixSuffix).toBe('suffix');
    expect(as!.rollPct).toBe(100); // 13 = потолок тира

    expect(d.prefixCount).toBe(1);
    expect(d.suffixCount).toBe(2);
    expect(d.maxPrefixes).toBe(3);
    expect(d.maxSuffixes).toBe(3);
    expect(d.openPrefix).toBe(2);
    expect(d.openSuffix).toBe(1);
    // implicit "+12 to Strength" не должен получить тир (не explicit) —
    // unmatchedExplicits содержит только explicit, не попавшие в индекс
    expect(d.unmatchedExplicits).toEqual([]);
  });

  it('Magic: 1 тир, слот закрыт полностью', async () => {
    const d = await resolveModTiers(MAGIC_GLOVES);
    expect(d.modTiers).toHaveLength(1);
    expect(d.maxPrefixes).toBe(1);
    expect(d.openSuffix).toBe(0);
    expect(d.openPrefix).toBe(1);
  });

  it('essence-only моды не матчатся поверх обычной линейки', async () => {
    const essenceItem = RARE_GLOVES.replace('+20 to Maximum Life', '+65 to Maximum Life');
    const d = await resolveModTiers(essenceItem);
    const life = d.modTiers.find((t) => t.modText.includes('Maximum Life'));
    expect(life).toBeUndefined(); // 65 вне обычных тиров, essence-only не индексирован
    expect(d.unmatchedExplicits).toContain('+65 to Maximum Life');
  });

  it('Unique/Normal — пустое досье без сети (rarity-гейт до lookupBaseItem)', async () => {
    const unique = `Rarity: Unique
Some Amulet
Leather Gloves
--------
Item Level: 60
--------
+45 to Maximum Life
`;
    const d = await resolveModTiers(unique);
    expect(d.modTiers).toEqual([]);
    expect(d.base).toBeNull();
    expect(d.maxPrefixes).toBe(0);
  });

  it('сеть умерла — досье не бросает, unmatched заполнен', { timeout: 20000 }, async () => {
    vi.stubGlobal('fetch', (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch);
    const d = await resolveModTiers(RARE_GLOVES);
    expect(d.base).toBeNull();
    expect(d.modTiers).toEqual([]);
    expect(d.unmatchedExplicits.length).toBe(3);
  });

  it('мусорный текст — пустое досье без исключения', async () => {
    const d = await resolveModTiers('not a ---c item text');
    expect(d.modTiers).toEqual([]);
  });
});
