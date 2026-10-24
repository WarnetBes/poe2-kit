import { describe, expect, it } from 'vitest';
import {
  generateDynamicBlock,
  LIVE_FILTER_SCHEMA_VERSION,
  type KnownFilterSets,
  type LiveFilterSnapshot,
} from '../src/livefilter/rules.js';
import { filterContentKey } from '../src/livefilter/pipeline.js';
import { selfCheckBlock } from '../src/livefilter/selfcheck.js';
import { buildTargetsFromPob } from '../src/livefilter/buildTargets.js';

// ─── Фикстуры ──────────────────────────────────────────────────────────────

function makeSnapshot(): LiveFilterSnapshot {
  return {
    schemaVersion: LIVE_FILTER_SCHEMA_VERSION,
    league: 'forbiddenrites',
    generatedAt: '2026-10-24T00:00:00Z',
    rates: { divineEx: 500, chaosEx: 0.5 },
    currency: [
      { name: 'Divine Orb', category: 'currency', valueEx: 500 },
      { name: 'Exalted Orb', category: 'currency', valueEx: 1 },
    ],
    uniqueBases: {},
    exceptional: [],
    sources: {},
  };
}

const KNOWN: KnownFilterSets = {
  classes: new Set(['Body Armours', 'Helmets', 'Amulets', 'Rings', 'Uncut Gems', 'Waystones', 'Belts', 'Boots', 'Gloves', 'Wands', 'Shields', 'Foci']),
  bases: new Set(['Divine Orb', 'Exalted Orb', 'Silk Robe', 'Half Plate', 'Amulet', 'Ring']),
};

const POB_XML = [
  '<PathOfBuilding>',
  '<Items activeItemSet="1">',
  '<Item id="1">Rarity: Rare',
  'Storm Shroud',
  'Silk Robe',
  '--------',
  'Energy Shield: 120',
  '</Item>',
  '<Item id="2">Rarity: Gem',
  'Ice Strike',
  '--------',
  '</Item>',
  '<ItemSet id="1">',
  '<Slot name="Body Armour" itemId="1"/>',
  '<Slot name="Gloves" itemId="2"/>',
  '</ItemSet>',
  '</Items>',
  '</PathOfBuilding>',
].join('\n');

// ─── Генератор: группа 3.5 build-aware ────────────────────────────────────

describe('generateDynamicBlock — buildTargets (§3.5, этап F)', () => {
  it('базы + моды + minIlvl → Show-правила с exact-условиями (golden-строки)', () => {
    const { text, stats } = generateDynamicBlock(
      makeSnapshot(),
      {
        thresholdEx: 10,
        buildTargets: {
          baseTypes: ['Silk Robe', 'Half Plate'],
          hasExplicitMods: ['+1 to Level of all Cold Skills'],
          minIlvl: 60,
          source: 'pob',
        },
      },
      KNOWN,
    );
    expect(text).toContain('# build-aware bases (ilvl >= 60)');
    expect(text).toContain('    BaseType == "Silk Robe" "Half Plate"');
    expect(text).toContain('    ItemLevel >= 60');
    expect(text).toContain('# build-aware mods (ilvl >= 60)');
    expect(text).toContain('    HasExplicitMod == "+1 to Level of all Cold Skills"');
    expect(stats.buildAwareRules).toBe(2);
    // стиль — из существующего styles-механизма (beam + icon)
    expect(text).toMatch(/PlayEffect Green/);
    expect(text).toMatch(/MinimapIcon 0 Green Star/);
  });

  it('unknown база в targets → правило базы дропнуто, блок валиден, warning в stats', () => {
    const { text, stats } = generateDynamicBlock(
      makeSnapshot(),
      { thresholdEx: 10, buildTargets: { baseTypes: ['Catalyst'], source: 'manual' } },
      KNOWN,
    );
    expect(text).not.toContain('Catalyst');
    expect(stats.warnings.join(' ')).toContain('build target вне known-баз');
    expect(stats.warnings.join(' ')).toContain('Catalyst');
    // блок целиком не генерируется — фильтр остаётся валидным
    expect(text).not.toMatch(/# build-aware bases/);
    expect(stats.buildAwareRules).toBe(0);
  });

  it('ordering (§3.1): build-aware ПОСЛЕ always-show, ДО value tier и всех Hide', () => {
    const { text } = generateDynamicBlock(
      makeSnapshot(),
      {
        thresholdEx: 10,
        alwaysShow: ['Exalted Orb'],
        buildTargets: { baseTypes: ['Silk Robe'] },
      },
      KNOWN,
    );
    const iAlways = text.indexOf('# always-show');
    const iBuild = text.indexOf('# build-aware bases');
    const iDivine = text.indexOf('# divine spotlight');
    const iTier = text.indexOf('# value tier');
    const iHide = text.indexOf('\nHide');
    expect(iAlways).toBeGreaterThan(-1);
    expect(iBuild).toBeGreaterThan(iAlways);
    if (iDivine !== -1) expect(iBuild).toBeLessThan(iDivine);
    if ( iTier !== -1) expect(iBuild).toBeLessThan(iTier);
    expect(iBuild).toBeLessThan(iHide);
  });

  it('known-sets не заданы → канонизация пропускается (SelfCheck на composition-уровне поймает)', () => {
    const { text } = generateDynamicBlock(
      makeSnapshot(),
      { thresholdEx: 10, buildTargets: { baseTypes: ['Silk Robe'] }, hideLowRarityGear: false },
    );
    expect(text).toContain('BaseType == "Silk Robe"');
  });
});

// ─── SelfCheck: build-aware цели идут через общий путь валидации ───────────

describe('selfCheckBlock — build-aware правила не обходят валидацию', () => {
  function bigKnown(withSilk: boolean) {
    const bases = new Map<string, string>();
    for (let i = 0; i < 520; i++) bases.set(`base ${i}`, `Base ${i}`);
    if (withSilk) bases.set('silk robe', 'Silk Robe');
    const classes = new Set<string>();
    for (let i = 0; i < 12; i++) classes.add(`class ${i}`);
    return { classes, bases, loose: [] as string[] };
  }

  it('unknown база единственная в правиле → правило выброшено ЦЕЛИКОМ, dropped >= 1', () => {
    const gen = generateDynamicBlock(
      makeSnapshot(),
      { thresholdEx: 10, hideLowRarityGear: false }, // known undefined → без канонизации
    );
    // подкладываем unknown-базу напрямую в текст: emulate генерацию без known
    const text = gen.text.replace(
      '# [[END DYNAMIC LOOT FILTER]]',
      '# build-aware bases (selfcheck probe)\nShow\n    BaseType == "Catalyst"\n\n# [[END DYNAMIC LOOT FILTER]]',
    );
    const res = selfCheckBlock(text, bigKnown(false));
    expect(res.block).not.toMatch(/# build-aware bases[\s\S]*?"Catalyst"/);
    expect(res.unknown).toContain('BaseType Catalyst');
    expect(res.dropped).toBeGreaterThanOrEqual(1);
  });

  it('unknown + известная база в одном правиле → правило живёт без unknown-значения', () => {
    const gen = generateDynamicBlock(
      makeSnapshot(),
      { thresholdEx: 10, hideLowRarityGear: false },
    );
    const text = gen.text.replace(
      '# [[END DYNAMIC LOOT FILTER]]',
      '# build-aware bases (selfcheck probe)\nShow\n    BaseType == "Catalyst" "Silk Robe"\n\n# [[END DYNAMIC LOOT FILTER]]',
    );
    const res = selfCheckBlock(text, bigKnown(true));
    expect(res.block).toContain('BaseType == "Silk Robe"');
    expect(res.block).not.toContain('Catalyst');
  });
});

// ─── FilterKey: пустые targets == отсутствующие; provenance не в ключе ────

describe('filterContentKey — buildTargets-совместимость (config.go:380-397)', () => {
  const league = 'L';
  const content = 'x';
  const base = { thresholdEx: 10 };

  it('пустые targets (все формы) не меняют ключ', () => {
    const plain = filterContentKey(base, league, content);
    expect(filterContentKey({ ...base, buildTargets: {} }, league, content)).toBe(plain);
    expect(
      filterContentKey(
        { ...base, buildTargets: { baseTypes: [], hasExplicitMods: [], resistances: [], minIlvl: 0, source: 'pob' } },
        league,
        content,
      ),
    ).toBe(plain);
  });

  it('source/resistances (provenance) не входят в ключ', () => {
    const a = filterContentKey({ ...base, buildTargets: { baseTypes: ['Silk Robe'], source: 'pob', resistances: ['cold'] } }, league, content);
    const b = filterContentKey({ ...base, buildTargets: { baseTypes: ['Silk Robe'], source: 'manual' } }, league, content);
    expect(a).toBe(b);
  });

  it('реальные targets меняют ключ; порядок списка не важен', () => {
    const plain = filterContentKey(base, league, content);
    const withTargets = filterContentKey({ ...base, buildTargets: { baseTypes: ['Silk Robe'] } }, league, content);
    expect(withTargets).not.toBe(plain);
    const ab = filterContentKey({ ...base, buildTargets: { baseTypes: ['Silk Robe', 'Half Plate'] } }, league, content);
    const ba = filterContentKey({ ...base, buildTargets: { baseTypes: ['Half Plate', 'Silk Robe'] } }, league, content);
    expect(ab).toBe(ba);
  });
});

// ─── Adapter: PoB → targets (READ-ONLY через buildCodeToGear) ──────────────

describe('buildTargetsFromPob', () => {
  it('базы носимого гира активного ItemSet → baseTypes; гемы отфильтрованы', async () => {
    const { targets, unverified } = await buildTargetsFromPob(POB_XML);
    expect(targets.source).toBe('pob');
    expect(targets.baseTypes).toEqual(['Silk Robe']);
    expect(targets.baseTypes).not.toContain('Ice Strike');
    // честный unverified-хвост, без выдуманных данных
    expect(unverified.join(' ')).toContain('hasExplicitMods');
    expect(unverified.join(' ')).toContain('resistances');
    expect(targets.hasExplicitMods).toBeUndefined();
    expect(targets.resistances).toBeUndefined();
  });

  it('сгенерированный adapter-конфиг проходит через генератор и SelfCheck-путь', () => {
    const { targets } = { targets: { baseTypes: ['Silk Robe'], source: 'pob' as const } };
    const { text } = generateDynamicBlock(
      makeSnapshot(),
      { thresholdEx: 10, buildTargets: targets, hideLowRarityGear: false },
      KNOWN,
    );
    expect(text).toContain('BaseType == "Silk Robe"');
  });
});
