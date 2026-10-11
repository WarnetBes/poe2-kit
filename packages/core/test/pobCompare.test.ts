/**
 * E2 (мастер-план §6): comparePobBuilds — diff текущий vs эталон.
 * Парные фикстуры: реальный экспорт персонажа (char_lvl30, Monk 27) vs
 * эталон poe.ninja pob/28880 (Invoker 97). Golden-утверждения — только факты,
 * проверенные по фикстурам (probe-скриптом), не фантазии.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { importBuild } from '../src/build.js';
import { comparePobBuilds, formatPobCompare } from '../src/pobCompare.js';
import type { PobCompareResult } from '../src/pobCompare.js';
import type { BuildImport } from '../src/types.js';

const FIX = 'test/fixtures/keybinds/';
const ETALON = readFileSync(FIX + 'pob_28880.xml', 'utf8');
const CHAR = readFileSync(FIX + 'char_lvl30.xml', 'utf8');

describe('E2: comparePobBuilds — парные golden-фикстуры char_lvl30 vs 28880', () => {
  let cur: BuildImport;
  let ref: BuildImport;
  let res: PobCompareResult;

  it('обе фикстуры реально импортируются', async () => {
    cur = await importBuild(CHAR);
    ref = await importBuild(ETALON);
    expect(cur.class).toBe('Monk');
    expect(ref.class).toBe('Monk');
    expect(ref.ascendancy).toBe('Invoker');
    expect(cur.level).toBe(27);
    expect(ref.level).toBe(97);
  });

  it('meta честно отражает стороны', async () => {
    cur ??= await importBuild(CHAR);
    ref ??= await importBuild(ETALON);
    res = comparePobBuilds(cur, ref);
    expect(res.meta.currentLevel).toBe(27);
    expect(res.meta.referenceLevel).toBe(97);
    expect(res.meta.currentAscendancy).toBeNull();
    expect(res.meta.referenceAscendancy).toBe('Invoker');
  });

  it('скиллы: Ice Strike у персонажа есть, в эталоне нет → extraGems (проверенный факт фикстур)', async () => {
    cur ??= await importBuild(CHAR);
    ref ??= await importBuild(ETALON);
    res = comparePobBuilds(cur, ref);
    expect(res.skills.extraGems).toContain('Ice Strike');
    expect(res.skills.missingGems).toContain('Quarterstaff Strike');
  });

  it('пассивки поимённо: узлов не хватает больше, чем лишних; у узлов есть имена или честный ID', async () => {
    cur ??= await importBuild(CHAR);
    ref ??= await importBuild(ETALON);
    res = comparePobBuilds(cur, ref);
    expect(res.passives.missing.length).toBeGreaterThan(30); // эталон 97 ур. vs 27 ур.
    // Общий узел старта класса есть в обоих (4157) → хотя бы одно совпадение.
    expect(res.passives.matchingCount).toBeGreaterThanOrEqual(1);
    // Resolution: узлы эталона — числовые PoB-ID, имена должны резолвиться из датасета.
    const withNames = res.passives.missing.filter((n) => n.name).length;
    expect(withNames).toBeGreaterThan(0);
    for (const n of res.passives.missing) {
      expect(n.id).toBeTruthy();
    }
  });

  it('сводка непустая и RU-вердикт содержит слои', async () => {
    cur ??= await importBuild(CHAR);
    ref ??= await importBuild(ETALON);
    res = comparePobBuilds(cur, ref);
    expect(res.summary).toMatch(/узлов дерева не хватает: \d+/);
    const text = formatPobCompare(res);
    expect(text).toContain('## Сравнение с эталонным билдом');
    expect(text).toContain('Ice Strike');
    expect(text).toContain('Дерево пассивок');
    expect(text).toMatch(/Не хватает \(\d+\)/);
  });
});

describe('E2: comparePobBuilds — юнит-слои', () => {
  const gearA = (name: string, es: number) =>
    `Item Class: Body Armour\nRarity: Rare\n${name}\nAdvanced Vaal Cuirass\n--------\nEnergy Shield: ${es}\n`;

  function mini(over: Partial<BuildImport>): BuildImport {
    return {
      source: 'pob',
      skills: [],
      passiveNodes: [],
      gear: {},
      ...over,
    } as BuildImport;
  }

  it('идентичные билды — «совпадают»', () => {
    const a = mini({ skills: ['Ice Strike'], passiveNodes: ['4157'], gear: { Helm: 'x' } });
    expect(comparePobBuilds(a, a).summary).toMatch(/совпадают/);
  });

  it('gear: смена предмета — дельта ES из parseItemText', () => {
    const res = comparePobBuilds(
      mini({ gear: { 'Body Armour': gearA('Storm Shroud', 300) } }),
      mini({ gear: { 'Body Armour': gearA('Blazing Aegis', 500) } }),
    );
    expect(res.items.changed.length).toBe(1);
    expect(res.items.changed[0]!.delta).toEqual(['+200 ES']);
  });

  it('gear: пустой слот эталона — slotsMissing', () => {
    const res = comparePobBuilds(mini({ gear: {} }), mini({ gear: { 'Body Armour': gearA('X', 100) } }));
    expect(res.items.slotsMissing).toEqual(['Body Armour']);
  });

  it('gear: одинаковые предметы — matching', () => {
    const t = gearA('Storm Shroud', 300);
    const res = comparePobBuilds(mini({ gear: { Helm: t } }), mini({ gear: { Helm: t } }));
    expect(res.items.matching).toEqual(['Helm']);
    expect(res.items.changed).toHaveLength(0);
  });

  it('skills: ВСЕ саппорт-гэпы на один скилл (донор отдаёт только первый)', () => {
    // Имена — реальные ключи gem_name_to_metadata: имена саппортов PoE2 без
    // «Support»-суффикса, детект по Metadata-путям (SupportGemMartialTempo / SupportGemFireInfusion).
    const sup = (n: string) => ({ name: n, level: 5, quality: 0 });
    const g = (gems: Array<{ name: string; level: number; quality: number }>) => ({
      label: 'g',
      enabled: true,
      gems: [{ name: 'Ice Strike', level: 20, quality: 0 }, ...gems],
    });
    const cur = mini({ skillGroups: [g([sup('Rapid Attacks I')])] });
    const ref = mini({
      skillGroups: [g([sup('Rapid Attacks I'), sup('Fire Attunement'), sup('Heft')])],
    });
    const res = comparePobBuilds(cur, ref);
    expect(res.skills.missingGems).toEqual([]); // саппорты не попадают в missingGems
    expect(res.skills.groups).toHaveLength(1);
    expect(res.skills.groups[0]!.skill).toBe('Ice Strike');
    expect(res.skills.groups[0]!.missingSupports.sort()).toEqual(['Fire Attunement', 'Heft']);
    expect(res.skills.groups[0]!.extraSupports).toEqual([]);
  });

  it('skills: уровни сравниваются (донор их не сравнивал)', () => {
    const g = (lvl: number) => ({
      label: 'g',
      enabled: true,
      gems: [{ name: 'Ice Strike', level: lvl, quality: 0 }],
    });
    const res = comparePobBuilds(mini({ skillGroups: [g(10)] }), mini({ skillGroups: [g(20)] }));
    expect(res.skills.groups[0]!.currentLevel).toBe(10);
    expect(res.skills.groups[0]!.referenceLevel).toBe(20);
  });

  it('config: только различия', () => {
    const res = comparePobBuilds(
      mini({ config: { enemyIsBoss: 'true', enemyLevel: '83' } }),
      mini({ config: { enemyIsBoss: 'false', enemyLevel: '83' } }),
    );
    expect(res.config.differing).toEqual([{ key: 'enemyIsBoss', current: 'true', reference: 'false' }]);
  });

  it('легаси: без групп — плоский список skills', () => {
    const res = comparePobBuilds(mini({ skills: ['Herald of Ice'] }), mini({ skills: ['Ice Strike', 'Herald of Ice'] }));
    expect(res.skills.missingGems).toEqual(['Ice Strike']);
    expect(res.skills.extraGems).toEqual([]);
  });
});
