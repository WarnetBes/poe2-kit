/**
 * Тесты core.mapPrep — №234 Этап 2 (SPEC_MAP_PREP.md §4, гейт §7: юнит-кейсы
 * Exposure-математика, SUF-элемент-мод → monsterEleBonus, пустые моды,
 * unknown-мод → честный unknown).
 *
 * Данные — датасеты Этапа 1 (maps.json: 135 карт из PoB2 WorldAreas.lua;
 * waystone_mods.json: 74 группы). Эталонные значения — из датасета:
 *  - of_exposure: tiers values [0,0] / [5,8] / [9,12] «minus (X to Y)% to all
 *    maximum Resistances» (SPEC F5 уточнён данными: ВСЕ резисты, не −3–4%);
 *  - MapRustbowl: area_level 65, boss «Gozen, Rebellious Rustlord»;
 *  - MapInferno: boss_varieties пуст (26 карт-«дыр» источника PoB2).
 */
import { describe, it, expect } from 'vitest';
import { mapThreat, mapPrepChecklist, mapPrepAdvice, requiredChaosRes } from '../src/mapPrep.js';
import { getMapEntries, getWaystoneModGroups } from '../src/dataset.js';
import { DEFENSE_CONSTANTS } from '../src/ehp.js';

const CAP = DEFENSE_CONSTANTS.RESISTANCE_DEFAULT_CAP; // 75

describe('датасеты Этапа 1 (read-only контракт)', () => {
  it('135 карт, 74 группы модов — на месте и не изменены', () => {
    expect(getMapEntries().length).toBe(135);
    expect(getWaystoneModGroups().length).toBe(74);
    const exposure = getWaystoneModGroups().find((m) => m.id === 'of_exposure');
    expect(exposure?.tiers.map((t) => t.values)).toEqual([[0, 0], [5, 8], [9, 12]]);
  });
});

describe('матчинг живых строк игры (canon: «−(9-12)» == «minus (9 to 12)»; построчные статы)', () => {
  it('игра пишет «-(7-8)% to all maximum Resistances» → of_exposure, max_res', () => {
    const t = mapThreat({ map: 'MapRustbowl', mods: ['Players have -(7-8)% to all maximum Resistances'] });
    expect(t.unknownMods).toHaveLength(0);
    const deb = t.playerDebuffs.find((d) => d.effect === 'max_res');
    expect(deb?.fromMod).toBe('of_exposure');
    expect(deb?.value).toBe(8); // max из вставленных чисел
  });

  it('однострочная вставка двухстрочного мода «+24% Monster Elemental Resistances» → resistant', () => {
    const t = mapThreat({ map: 'MapRustbowl', mods: ['+24% Monster Elemental Resistances'] });
    expect(t.unknownMods).toHaveLength(0);
    expect(t.matchedMods.some((m) => m.mod === 'resistant')).toBe(true);
    expect(t.monsterEleBonus).toBeGreaterThan(0);
  });

  it('полный двухстрочный блок тоже матчится (вставка целиком)', () => {
    const t = mapThreat({ map: 'MapRustbowl', mods: ['+20% Monster Elemental Resistances\n+15% Monster Chaos Resistance'] });
    expect(t.matchedMods.some((m) => m.mod === 'resistant')).toBe(true);
    expect(t.monsterEleBonus).toBe(20);
  });
});

describe('mapThreat — поиск карты', () => {
  it('по id и по EN-имени (регистронезависимо, «(Map)» снимается)', () => {
    const byId = mapThreat({ map: 'MapRustbowl', mods: [] });
    const byName = mapThreat({ map: 'rustbowl (map)', mods: [] });
    expect(byId.area_level).toBe(65);
    expect(byName.boss.name).toBe('Gozen, Rebellious Rustlord');
    expect(byName.monsterVarieties).toEqual(byId.monsterVarieties);
    expect(byId.biomes).toEqual(byName.biomes);
  });

  it('не найдено → честная ошибка с подсказкой ближайших имён', () => {
    expect(() => mapThreat({ map: 'Rustbovl', mods: [] })).toThrow(/Rustbowl|не найдена/i);
  });

  it('tier 1–16 → area level через endgame.waystoneAreaLevel; без tier → базовый 65', () => {
    expect(mapThreat({ map: 'MapRustbowl', mods: [], tier: 16 }).area_level).toBe(80);
    expect(mapThreat({ map: 'MapRustbowl', mods: [], tier: 1 }).area_level).toBe(65);
    expect(() => mapThreat({ map: 'MapRustbowl', mods: [], tier: 17 })).toThrow(/тир/i);
    expect(mapThreat({ map: 'MapRustbowl', mods: [] }).area_level).toBe(65);
  });

  it('босс: резисты из канона enemy.ts (ele 30, chaos 0), kind boss', () => {
    const t = mapThreat({ map: 'MapBackwash', mods: [] });
    expect(t.boss.res).toEqual({ ele: 30, chaos: 0 });
    expect(t.boss.kind).toBe('boss');
    expect(t.boss.name).toBe('Yaota, the Loathsome');
  });

  it('26 карт с пустыми boss_varieties → босс без имени + unverified-пометка дыры источника', () => {
    const t = mapThreat({ map: 'MapInferno', mods: [] });
    expect(t.boss.name).toBeUndefined();
    expect(t.unverifiedNotes.some((n) => n.includes('дыра источника PoB2'))).toBe(true);
  });

  it('пустые моды → нет debuffs/matched/unknown', () => {
    const t = mapThreat({ map: 'MapRustbowl', mods: [] });
    expect(t.playerDebuffs).toEqual([]);
    expect(t.matchedMods).toEqual([]);
    expect(t.unknownMods).toEqual([]);
    expect(t.elements).toBeUndefined();
  });
});

describe('mapThreat — Exposure-математика (SUF-гейт)', () => {
  it('полная строка стат-текста «(9 to 12)» → max_res 12', () => {
    const t = mapThreat({ mods: ['Players have minus (9 to 12)% to all maximum Resistances'] });
    const d = t.playerDebuffs[0];
    expect(d?.fromMod).toBe('of_exposure');
    expect(d?.effect).toBe('max_res');
    expect(d?.value).toBe(12);
    expect(t.matchedMods[0]?.tierIndex).toBe(2);
  });

  it('одиночное значение «(7)» → ступень распознана по числам, value = 7', () => {
    const t = mapThreat({ mods: ['Players have minus (7)% to all maximum Resistances'] });
    const d = t.playerDebuffs[0];
    expect(d?.fromMod).toBe('of_exposure');
    expect(d?.value).toBe(7);
    expect(t.matchedMods[0]?.tierIndex).toBe(1); // [5,8]
  });

  it('только имя «of Exposure» → worst-case последняя ступень (12) + unverified-пометка', () => {
    const t = mapThreat({ mods: ['of Exposure'] });
    expect(t.playerDebuffs[0]?.value).toBe(12);
    expect(t.unverifiedNotes.some((n) => n.includes('ступень мода'))).toBe(true);
  });

  it('чек-лист: Exposure снижает требуемый кап (75 − 12 = 63)', () => {
    const t = mapThreat({ mods: ['of Exposure'] });
    const stats = { life: 3000, fireRes: 62, coldRes: 63, lightningRes: 75, chaosRes: 30 };
    const checks = mapPrepChecklist(stats, t);
    const fire = checks.find((c) => c.check.startsWith('fire_'));
    const cold = checks.find((c) => c.check.startsWith('cold_'));
    const lightning = checks.find((c) => c.check.startsWith('lightning_'));
    expect(fire?.passed).toBe(false); // 62 < 63
    expect(cold?.passed).toBe(true);   // 63 ≥ 63
    expect(lightning?.passed).toBe(true); // 75 ≥ 63
    expect(fire?.advice_ru).toContain('63%');
    const exposure = checks.find((c) => c.check === 'exposure_max_res_compensation');
    expect(exposure).toBeTruthy();
    expect(exposure!.advice_ru).toContain('63%');
  });
});

describe('mapThreat — SUF: элемент-урон и резисты монстров', () => {
  it('«Monsters deal (90 to 110)% extra Physical Damage as Fire» → elements.fire = 100 (кламп 0..100)', () => {
    const t = mapThreat({ map: 'MapRustbowl', mods: ['Monsters deal (90 to 110)% extra Physical Damage as Fire'] });
    expect(t.elements?.fire).toBe(100);
    const m = t.matchedMods[0];
    expect(m?.mod).toBe('burning');
    expect(m?.tierIndex).toBe(2);
  });

  it('«+40% Monster Elemental Resistances / +25% Chaos» (pref «Resistant») → monsterEleBonus 40, monsterChaosRes 25', () => {
    const t = mapThreat({
      mods: ['+40% Monster Elemental Resistances\n+25% Monster Chaos Resistance'],
    });
    expect(t.monsterEleBonus).toBe(40);
    expect(t.monsterChaosRes).toBe(25);
    expect(t.matchedMods[0]?.mod).toBe('resistant');
  });

  it('только имя «Resistant» без чисел → worst-case ступень (40/25)', () => {
    const t = mapThreat({ mods: ['Resistant'] });
    expect(t.monsterEleBonus).toBe(40);
    expect(t.monsterChaosRes).toBe(25);
  });

  it('Profane: extra chaos — вес по первой паре значений (25), «секунды» не считаются', () => {
    const t = mapThreat({
      mods: ['Monsters gain (21 to 25)% of their Physical Damage as Extra Chaos Damage\nMonsters Inflict Withered for 100 seconds on Hit'],
    });
    expect(t.elements?.chaos).toBe(25);
  });
});

describe('mapThreat — честность', () => {
  it('unknown-мод → в unknownMods, без выдуманной угрозы', () => {
    const t = mapThreat({ map: 'MapRustbowl', mods: ['Players are absolutely amazing'] });
    expect(t.unknownMods).toEqual(['Players are absolutely amazing']);
    expect(t.playerDebuffs).toEqual([]);
    expect(t.matchedMods).toEqual([]);
  });

  it('механизм вне модели MapThreat (Armoured) → matchedMods с threat:null, без дебаффа', () => {
    const t = mapThreat({ mods: ['+40% Monster Physical Damage Reduction'] });
    expect(t.matchedMods[0]?.mod).toBe('armoured');
    expect(t.matchedMods[0]?.threat).toBeNull();
    expect(t.playerDebuffs).toEqual([]);
  });

  it('флаг-мод без чисел (Burning Ground) → вес-эвристика 30 + unverified-пометка', () => {
    const t = mapThreat({ mods: ['Area has patches of Burning Ground'] });
    expect(t.elements?.fire).toBe(30);
    expect(t.unverifiedNotes.some((n) => n.includes('ЭВРИСТИКА'))).toBe(true);
  });

  it('мерж разных модов: Exposure + Smothering → оба дебаффа, worst-case значения', () => {
    const t = mapThreat({ mods: ['of Exposure', 'of Smothering'] });
    expect(t.playerDebuffs.map((d) => d.effect).sort()).toEqual(['max_res', 'recovery']);
    expect(t.playerDebuffs[1]?.value).toBe(60); // worst-case ступень of_smothering
  });
});

describe('mapPrepChecklist — пороги chaos (maxroll, unverified)', () => {
  it('requiredChaosRes: area 65 → 0, 70 → 40, 75 → 75; помечен unverified', () => {
    expect(requiredChaosRes(65)).toEqual({ value: 0, unverified: true });
    expect(requiredChaosRes(70).value).toBe(40);
    expect(requiredChaosRes(75).value).toBe(75);
    expect(requiredChaosRes(80).value).toBe(75);
  });

  it('T11 (area 75): chaos 30% → fail c пометкой maxroll', () => {
    const t = mapThreat({ map: 'MapRustbowl', tier: 11, mods: [] });
    const checks = mapPrepChecklist({ life: 4000, fireRes: 75, coldRes: 75, lightningRes: 75, chaosRes: 30 }, t);
    const chaos = checks.find((c) => c.check.startsWith('chaos_'));
    expect(chaos?.passed).toBe(false);
    expect(chaos?.unverified).toBe(true);
    expect(chaos?.advice_ru).toContain('maxroll');
  });

  it('отрицательный chaos — fail даже на низком тире', () => {
    const t = mapThreat({ map: 'MapRustbowl', mods: [] });
    const checks = mapPrepChecklist({ life: 4000, chaosRes: -20 }, t);
    const chaos = checks.find((c) => c.check.startsWith('chaos_'));
    expect(chaos?.passed).toBe(false);
  });
});

describe('mapPrepChecklist — мерж с ehp.identifyDefenseGaps', () => {
  it('слабая оборона → defense_gap_-чеки с рекомендациями', () => {
    const t = mapThreat({ map: 'MapRustbowl', mods: [] });
    const checks = mapPrepChecklist({ life: 1200 }, t);
    expect(checks.some((c) => c.check.startsWith('defense_gap_'))).toBe(true);
    expect(checks.every((c) => c.severity >= 0 && c.severity <= 10)).toBe(true);
    // сортировка по severity
    const sev = checks.map((c) => c.severity);
    expect([...sev].sort((a, b) => b - a)).toEqual(sev);
  });
});

describe('mapPrepAdvice — markdown-экспорт', () => {
  it('секции SPEC §4.3: моды / оборона / unverified; Exposure-совет содержит скорректированный кап', () => {
    const t = mapThreat({ map: 'MapRustbowl', tier: 10, mods: ['of Exposure', 'of Drought'] });
    const md = mapPrepAdvice({ life: 3200, fireRes: 60, chaosRes: -10 }, t);
    expect(md).toContain('Подготовка к карте (area level 74)');
    expect(md).toContain('⚠ Моды, требующие подготовки');
    expect(md).toContain('Пробелы обороны');
    expect(md).toContain('63%'); // 75 − 12 (worst-case Exposure)
    expect(md).toContain('maxroll'); // chaos-порог помечен
  });

  it('unknown-моды честно перечислены в сводке', () => {
    const t = mapThreat({ map: 'MapRustbowl', mods: ['Everyone dies instantly'] });
    const md = mapPrepAdvice({ life: 3000 }, t);
    expect(md).toContain('Everyone dies instantly');
  });
});
