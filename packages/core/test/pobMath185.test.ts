import { describe, expect, it } from 'vitest';
import {
  applyEstimateOverrides,
  estimateBuild,
  estimateWeaponDps,
} from '../src/estimate.js';
import { evaluateBuildAgainstGoals, rankLevers } from '../src/optimize.js';
import type { BuildGearItem } from '../src/types.js';

/**
 * Coupling-тесты закрытия остатка бэклога №185 (PoB2-математика в core):
 *  1. FullDPS-агрегат: <FullDPSSkill> + PlayerStat FullDPSPriority
 *     (adapted from PathOfBuilding-PoE2 (MIT), Calcs.lua:140-170);
 *  2. Override-API «что-если» (паттерн CalcOverride, Calcs.lua:74-86):
 *     подмена меняет calculateAllEhp, gaps и вердикт evaluateBuildAgainstGoals;
 *  3. Weapon-set среда: swap-слоты дают отдельные DPS-оценки
 *     (CalcSetup.lua:706-707, 2479-2508);
 *  4. estimate→optimize согласованность (rankLevers на переоценке).
 */

const FIXTURE_XML = [
  '<PathOfBuilding>',
  '<Build level="97" className="Monk" ascendClassName="Invoker" mainSocketGroup="1">',
  '<PlayerStat stat="Life" value="1539"/>',
  '<PlayerStat stat="TotalDPS" value="90000"/>',
  '<PlayerStat stat="FullDPS" value="120000"/>',
  '<FullDPSSkill stat="Ice Strike" value="90000" enabled="true"/>',
  '<FullDPSSkill stat="Herald of Ice" value="5000" enabled="true"/>',
  '</Build>',
  '<Items activeItemSet="1">',
  '<Item id="1">Rarity: Unique\nTest Staff\nQuarterstaff\n--------\nPhysical Damage: 100-150\nAttacks per Second: 1.50\n</Item>',
  '<Item id="2">Rarity: Rare\nSwap Wand\nWand\n--------\nPhysical Damage: 30-50\nAttacks per Second: 1.20\n</Item>',
  '<ItemSet id="1">',
  '<Slot name="Weapon 1" itemId="1"/>',
  '<Slot name="Weapon 1 Swap" itemId="2"/>',
  '</ItemSet>',
  '</Items>',
  '</PathOfBuilding>',
].join('\n');

const RESIST_BODY: BuildGearItem = {
  slot: 'Body Armour',
  name: 'Chest',
  itemText: [
    'Rarity: Rare',
    'Chest',
    'Body Armour',
    '--------',
    '+50 to maximum Life',
    '+20% to Fire Resistance',
  ].join('\n'),
};

describe('№185/1: FullDPS-агрегат (Calcs.lua:140-170, PoB2 MIT)', () => {
  it('estimateBuild достаёт FullDPSSkill-раскладку; PlayerStat FullDPS приоритетнее суммы', async () => {
    const est = await estimateBuild(FIXTURE_XML);
    expect(est.fullDps).not.toBeNull();
    // Раскладка по скиллам — из <FullDPSSkill>.
    expect(est.fullDps!.skills).toHaveLength(2);
    expect(est.fullDps!.skills[0]).toEqual({ stat: 'Ice Strike', value: 90000 });
    // combinedDPS: PlayerStat FullDPS (120000) приоритетнее суммы панельных (95000).
    expect(est.fullDps!.combinedDps).toBe(120000);
    // Sanity эталона 28880-формата: CharacterLevel/класс из <Build>.
    expect(est.characterLevel).toBe(97);
    expect(est.className).toBe('Monk');
  });

  it('без FullDPS-данных —.goal dps fallback на TotalDPS (главный скилл)', async () => {
    const xmlNoFull = FIXTURE_XML
      .replace('<PlayerStat stat="FullDPS" value="120000"/>', '')
      .replace(/<FullDPSSkill[^>]*\/>/g, '');
    const est = await estimateBuild(xmlNoFull);
    expect(est.fullDps).toBeNull();
    const goals = evaluateBuildAgainstGoals(est, { dps: 100000 });
    expect(goals.find((g) => g.metric === 'dps')?.current).toBe(90000);
    expect(goals.find((g) => g.metric === 'dps')?.kind).toBe('computed');
  });

  it('goal dps предпочитает FullDPS-агрегат TotalDPS одиночного скилла', async () => {
    const est = await estimateBuild(FIXTURE_XML);
    const goals = evaluateBuildAgainstGoals(est, { dps: 100000 });
    const dps = goals.find((g) => g.metric === 'dps')!;
    expect(dps.current).toBe(120000);
    expect(dps.verdict).toBe('pass');
    expect(dps.kind).toBe('computed');
  });
});

describe('№185/2 + №185/4: Override-API × coupling (CalcOverride, Calcs.lua:74-86)', () => {
  it('подмена резиста меняет EHP-слой, gaps и verdict (estimate→ehp→optimize)', async () => {
    const est = await estimateBuild([RESIST_BODY]);
    // ДО: fire 20% — fail против цели 75, gap в слабых местах.
    expect(est.defenses.fireRes).toBe(20);
    expect(est.gaps.some((g) => g.type === 'uncapped_fire_resistance')).toBe(true);
    const before = evaluateBuildAgainstGoals(est, { fireRes: 75 });
    expect(before.find((g) => g.metric === 'fireRes')?.verdict).toBe('fail');
    const ehpFireBefore = est.ehp.fire.effectiveHp;

    // Override «что-если»: докапать резист + плоской жизни.
    const estO = applyEstimateOverrides(est, { fireRes: 75, life: 2000 });
    expect(estO.defenses.fireRes).toBe(75);
    expect(estO.defenses.life).toBe(2000);
    expect(estO.overrides).toHaveLength(2);
    expect(estO.overrides.map((o) => o.field).sort()).toEqual(['fireRes', 'life']);
    // Coupling: EHP fire-слоя пересчитан calculateAllEhp и вырос.
    expect(estO.ehp.fire.effectiveHp).toBeGreaterThan(ehpFireBefore);
    // Coupling: слабое место ушло, verdict перевернулся.
    expect(estO.gaps.some((g) => g.type === 'uncapped_fire_resistance')).toBe(false);
    const after = evaluateBuildAgainstGoals(estO, { fireRes: 75 });
    const fireGoal = after.find((g) => g.metric === 'fireRes')!;
    expect(fireGoal.verdict).toBe('pass');
    // Честность: помечено как сценарий, не факт.
    expect(estO.notes.some((n) => n.includes('Override (что-если)'))).toBe(true);
    // Исходная оценка не мутирована (immutability).
    expect(est.defenses.fireRes).toBe(20);
  });

  it('override DPS: подменяет current цели dps с пометкой estimated', async () => {
    const est = await estimateBuild(FIXTURE_XML);
    const estO = applyEstimateOverrides(est, { totalDps: 200000 });
    expect(estO.overrideDps).toBe(200000);
    const goals = evaluateBuildAgainstGoals(estO, { dps: 150000 });
    const dps = goals.find((g) => g.metric === 'dps')!;
    expect(dps.current).toBe(200000);
    expect(dps.kind).toBe('estimated'); // сценарий, не computed
    expect(dps.note).toContain('что-если');
  });

  it('block-override клампится к канон-капу 50% (PoE2)', async () => {
    const est = await estimateBuild([RESIST_BODY]);
    const estO = applyEstimateOverrides(est, { blockChance: 80 });
    expect(estO.defenses.blockChance).toBe(50);
    expect(estO.overrides.find((o) => o.field === 'blockChance')?.to).toBe(50);
  });

  it('coupling: rankLevers работает поверх переоценки — рычаг брони даёт положительную дельту физ-EHP', async () => {
    const est = await estimateBuild([RESIST_BODY]);
    const estO = applyEstimateOverrides(est, { armour: 5000 });
    const levers = rankLevers(estO);
    expect(levers.length).toBeGreaterThan(0);
    const armourLever = levers.find((l) => l.lever.includes('брони'));
    expect(armourLever).toBeDefined();
    expect((armourLever!.deltaEhp.physical ?? 0)).toBeGreaterThan(0);
  });
});

describe('№185/3: weapon-set среда (CalcSetup.lua:706-707, 2479-2508)', () => {
  it('оба набора оружия дают отдельные DPS-оценки (bySet 1/2)', async () => {
    const est = await estimateBuild(FIXTURE_XML);
    expect(est.weapon.bySet).toHaveLength(2);
    const set1 = est.weapon.bySet.find((s) => s.set === 1)!;
    const set2 = est.weapon.bySet.find((s) => s.set === 2)!;
    // Стафф: (100+150)/2 × 1.5 = 187.5 → 188 total.
    expect(set1.weapon).toBe('Test Staff');
    expect(set1.totalDps).toBe(188);
    // Swap-ванда: (30+50)/2 × 1.2 = 48 физ.
    expect(set2.weapon).toBe('Swap Wand');
    // Элементального урона нет: total == phys.
    expect(set2.totalDps).toBe(set2.physDps);
    expect(set2.totalDps).toBe(48);
    // Верхнеуровневая оценка — лучшее из обоих (обратная совместимость).
    expect(est.weapon.weapon).toBe('Test Staff');
    expect(est.weapon.totalDps).toBe(188);
  });

  it('прямая оценка по gear-массиву различает swap-слоты', () => {
    const gear: BuildGearItem[] = [
      { slot: 'Weapon 1', name: '', itemText: 'Rarity: Rare\nA\nQuarterstaff\n--------\nPhysical Damage: 100-150\nAttacks per Second: 1.50\n' },
      { slot: 'Weapon 1 Swap', name: '', itemText: 'Rarity: Rare\nB\nWand\n--------\nPhysical Damage: 30-50\nAttacks per Second: 1.20\n' },
    ];
    const dps = estimateWeaponDps(gear);
    expect(dps.bySet.map((s) => s.set)).toEqual([1, 2]);
    expect(dps.bySet[0]!.totalDps).toBe(188);
    expect(dps.bySet[1]!.totalDps).toBe(48);
  });
});
