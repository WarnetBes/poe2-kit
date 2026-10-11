import { describe, expect, it } from 'vitest';
import {
  dumpConditionCatalog,
  parseConditionLine,
  parseFilterBlock,
  serializeBlock,
  serializeCondition,
  sortConditions,
  validateCondition,
  type FilterBlock,
  type FilterCondition,
  type ListCondition,
} from '../src/livefilter/conditions.js';
import { getFilterConditionCatalog } from '../src/dataset.js';

describe('каталог условий лут-фильтра (этап A, P3)', () => {
  const cat = getFilterConditionCatalog();

  it('загружен из JSON: 18 числовых, ordering покрывает все условия каталога', () => {
    expect(cat.numeric.length).toBeGreaterThanOrEqual(17);
    const inOrdering = new Set(cat.ordering);
    for (const n of [...cat.numeric, ...cat.boolean, ...cat.list.map((l) => l.name)]) {
      expect(inOrdering.has(n), `«${n}» отсутствует в ordering`).toBe(true);
    }
  });

  it('PoE1-мусор исключён навсегда (ElderItem/ShaperItem/Prophecy/SynthesisedItem/BaseWard…)', () => {
    const all = [
      ...cat.numeric,
      ...cat.boolean,
      ...(cat.boolean_optional ?? []),
      ...cat.list.map((l) => l.name),
    ];
    for (const poe1 of [
      'ElderItem', 'ShaperItem', 'Prophecy', 'SynthesisedItem', 'FracturedItem',
      'BlightedMap', 'BaseWard', 'Replica', 'Scourged', 'ZanaMemory',
      'HasCruciblePassiveTree', 'HasSearingExarchImplicit', 'HasEaterOfWorldsImplicit',
    ]) {
      expect(all).not.toContain(poe1);
    }
  });

  it('3.29-типы присутствуют как optional (Foulborn/Vestigial/Imbued/MirageMap/MemoryStrands)', () => {
    const opt = cat.boolean_optional ?? [];
    for (const fr of ['Foulborn', 'Vestigial', 'Imbued', 'MirageMap', 'MemoryStrands', 'HasVaalUniqueMod', 'IsVaalUnique', 'AlwaysShow']) {
      expect(opt).toContain(fr);
    }
  });

  it('Rarity — замкнутое множество значений', () => {
    const rarity = cat.list.find((l) => l.name === 'Rarity')!;
    expect(rarity.values).toEqual(['Normal', 'Magic', 'Rare', 'Unique']);
    expect(rarity.loose).toBe(false);
  });
});

describe('сериализация/парсинг условий', () => {
  it('числовые: канонический оператор, shorthand-парс «GemLevel 19» → >=', () => {
    expect(serializeCondition({ kind: 'numeric', name: 'ItemLevel', op: '>=', value: 75 })).toBe('ItemLevel >= 75');
    const p = parseConditionLine('GemLevel 19');
    expect(p).toEqual({ kind: 'numeric', name: 'GemLevel', op: '>=', value: 19 });
    expect(serializeCondition(p as FilterCondition)).toBe('GemLevel >= 19');
    // shorthand сериализуется только ЯВНЫМ оператором (canonical output)
    expect(serializeCondition({ kind: 'numeric', name: 'WaystoneTier', value: 4 })).toBe('WaystoneTier >= 4');
  });

  it('числовые: отрицательный оператор отвергается валидатором', () => {
    expect(validateCondition({ kind: 'numeric', name: 'ItemLevel', op: '!=', value: 75 })).toHaveLength(1);
    expect(validateCondition({ kind: 'numeric', name: 'ItemLevel', op: '>=', value: 75 })).toHaveLength(0);
  });

  it('loose-список остаётся loose (грабля neversink.go:106-108: не писать как exact)', () => {
    const loose = parseConditionLine('BaseType "Catalyst"');
    expect(loose).toEqual({ kind: 'list', name: 'BaseType', op: '', exact: false, values: ['Catalyst'] });
    expect(serializeCondition(loose as FilterCondition)).toBe('BaseType "Catalyst"'); // БЕЗ ==
    const wrong = { ...(loose as ListCondition), exact: true } as FilterCondition;
    expect(serializeCondition(wrong)).toBe('BaseType == "Catalyst"');
  });

  it('exact-список RoundTrip: == и отрицание !=', () => {
    const ex = parseConditionLine('BaseType == "Orb of Transmutation" "Divine Orb"');
    expect(serializeCondition(ex as FilterCondition)).toBe('BaseType == "Orb of Transmutation" "Divine Orb"');
    const neg = parseConditionLine('Class != "Gems"');
    expect(serializeCondition(neg as FilterCondition)).toBe('Class != "Gems"');
  });

  it('boolean: True/False RoundTrip', () => {
    const t = parseConditionLine('Identified True');
    expect(t).toEqual({ kind: 'boolean', name: 'Identified', value: true });
    expect(serializeCondition(t as FilterCondition)).toBe('Identified True');
    expect(serializeCondition({ kind: 'boolean', name: 'Corrupted', value: false })).toBe('Corrupted False');
  });

  it('Rarity с левым значением не парсится; PostFilter-мусор не парсится', () => {
    expect(parseConditionLine('Rarity "Foo"')).toBeNull();
    expect(parseConditionLine('Rarity == "Rare"')).not.toBeNull();
    expect(parseConditionLine('ElderItem True')).toBeNull(); // PoE1-мусор вне каталога
    expect(parseConditionLine('SetFontSize 45')).toBeNull(); // действие, не условие
  });

  it('Loose на Rarity запрещён каталогом (values-условие)', () => {
    const issue = validateCondition({ kind: 'list', name: 'Rarity', op: '', exact: false, values: ['Rare'] });
    expect(issue).toHaveLength(1);
    expect(issue[0]!.error).toContain('loose');
  });
});

describe('блок: ordering + golden', () => {
  it('условия в случайном порядке сериализуются детерминированно (паттерн BlockItemOrdering)', () => {
    const shuffled: FilterCondition[] = [
      { kind: 'numeric', name: 'ItemLevel', op: '>=', value: 80 },
      { kind: 'list', name: 'BaseType', op: '==', exact: true, values: ['Astrolabe'] },
      { kind: 'numeric', name: 'AreaLevel', op: '>=', value: 66 },
      { kind: 'boolean', name: 'Corrupted', value: true },
      { kind: 'list', name: 'Class', op: '==', exact: true, values: ['Amulets'] },
    ];
    const gold = serializeBlock({ type: 'Show', conditions: shuffled, actions: [{ command: 'SetFontSize', args: '40' }] });
    const reversed = serializeBlock({ type: 'Show', conditions: [...shuffled].reverse(), actions: [{ command: 'SetFontSize', args: '40' }] });
    // одинаковый набор → одинаковый текст
    expect(gold.slice(1)).toEqual(reversed.slice(1));
    // порядок по Filtration: Corrupted(2) < AreaLevel(10) < ItemLevel(12) < Rarity?(13 нет) < Class < BaseType
    const condLines = gold.filter((l) => l.trim() && !l.trim().startsWith('#') && l.trim() !== 'Show' && !l.trim().startsWith('SetFontSize'));
    expect(condLines.map((l) => l.trim().split(/\s/)[0])).toEqual(['Corrupted', 'AreaLevel', 'ItemLevel', 'Class', 'BaseType']);
  });

  it('golden-блок целиком', () => {
    const block: FilterBlock = {
      type: 'Hide',
      comment: 'cheap rares',
      conditions: [
        { kind: 'list', name: 'Rarity', op: '==', exact: true, values: ['Rare'] },
        { kind: 'numeric', name: 'ItemLevel', op: '<', value: 60 },
      ],
      actions: [],
    };
    expect(serializeBlock(block)).toEqual([
      '# cheap rares',
      'Hide',
      '    ItemLevel < 60',
      '    Rarity == "Rare"',
    ]);
  });

  it('parseFilterBlock: Show-блок RoundTrip через сериализацию', () => {
    const text = [
      'Show',
      '    BaseType == "Divine Orb"',
      '    ItemLevel >= 1',
      '    SetTextColor 255 215 0 255',
      '',
    ].join('\n');
    const b = parseFilterBlock(text)!;
    expect(b.type).toBe('Show');
    expect(b.conditions).toHaveLength(2);
    expect(b.actions).toEqual([{ command: 'SetTextColor', args: '255 215 0 255' }]);
    expect(serializeBlock(b)[0]).toBe('Show');
    expect(serializeBlock(b).some((l) => l.includes('ItemLevel >= 1'))).toBe(true);
  });

  it('parseFilterBlock: не-блок → null', () => {
    expect(parseFilterBlock('# comment\nShow')).toBeNull();
  });
});

describe('dumpConditionCatalog', () => {
  it('вычисляемые поля не попадают в дамп', () => {
    const dump = dumpConditionCatalog() as Record<string, unknown>;
    expect(dump.numeric).toBeInstanceOf(Array);
    expect(Object.keys(dump).some((k) => k.startsWith('_'))).toBe(false);
    expect((dump as { _meta?: unknown })._meta).toBeUndefined(); // $-поля тоже скрыты
  });
});
