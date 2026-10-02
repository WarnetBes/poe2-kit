import { describe, expect, it } from 'vitest';
import {
  calculateAllEhp, calculateEhp, armorDr, armorNeededForDr, attackerHitChance,
  chanceWithExtraRolls, evasionChance, luckyChance, resistanceDr, esRecharge,
} from '../src/ehp.js';

/**
 * Фикстуры — из исходников PoB2 (_research/path-of-building-poe2):
 *  - армор: CalcDefence.lua:57-64 `armour / (armour + raw·ArmourRatio)·100`,
 *    ArmourRatio = 10 (Data.lua:261), кап DR 90 (Data.lua:246);
 *  - hit монстра: CalcDefence.lua:41-46 `(1 − 0.95·Ev/(Ev+4·Acc))·100`,
 *    кламп [5..100]; hit атакующего: :33-38 `1.25·Acc/(Acc+0.3·Ev)·100`;
 *  - ward до life: CalcDefence.lua:524-525; хаос ×2 к ES: :592;
 *  - suppression −50%: Data.lua:255 (SuppressionEffect), только при 100
 *    (CalcDefence.lua:2628-2641);
 *  - капы: Dodge 75 (Data.lua:252), Block abs 90 / base 50 (Data.lua:253,
 *    Misc.lua:151), резисты: кап 75 (Misc.lua:149), hard 90 (Data.lua:249),
 *    floor −200 (Data.lua:248);
 *  - lucky: 1−(1−c)² (CalcDefence.lua:1090-1092).
 *
 * Санити PoB-28880: PlayerStat из pob_invoker_ice_decoded.xml (эталон Ice Strike
 * Invoker L97): Life 1539, ES 4288, Evasion 8706, Armour 3866, res 75/75/75/30.
 */

describe('ehp: армор — CalcDefence.lua:57-64', () => {
  it('DR = A/(A+10·raw), кап 90% (Data.lua:246,261)', () => {
    // 4000/(4000+10·1000) = 28.571%
    expect(armorDr(4000, 1000).drPercent).toBeCloseTo(28.5714, 3);
    // кап: 100000/(100000+10·100) = 99.0% → 90
    const capped = armorDr(100000, 100);
    expect(capped.drPercent).toBe(90);
    expect(capped.isCapped).toBe(true);
  });

  it('инверсия: армор для целевого DR — A = DR·10·raw/(1−DR); на капе ≈ 90·raw', () => {
    // 50% DR против удара 1000: 0.5·10000/0.5 = 10000
    expect(armorNeededForDr(50, 1000)).toBe(10000);
    // 90% DR: A/(A+10d) = 0.9 → A = 90d = 90000 (реализация капует на 89.99 → ≈89900)
    expect(armorNeededForDr(90, 1000)).toBeGreaterThan(89000);
    expect(armorNeededForDr(90, 1000)).toBeLessThanOrEqual(90000);
  });
});

describe('ehp: шансы — CalcDefence.lua:33-47; 1090-1092', () => {
  it('hit защищающегося: round((1 − 0.95·Ev/(Ev+4·Acc))·100), кламп [5..100] (PoB округляет)', () => {
    // Ev=1000, Acc=2000: raw 89.444 → 89 (CalcDefence.lua:45-46 round)
    const r = evasionChance(1000, 2000);
    expect(r.hitChancePercent).toBe(89);
    expect(r.evadeChancePercent).toBe(11);
    // Ev=8706 (PoB-28880), Acc=2000: raw 50.49 → 50
    expect(evasionChance(8706, 2000).hitChancePercent).toBe(50);
  });

  it('кап уворота 95% (Misc.lua:111 DefaultMaxEvadeChancePercent)', () => {
    expect(evasionChance(1e9, 100).evadeChancePercent).toBe(95);
  });

  it('hit атакующего: round(1.25·Acc/(Acc+0.3·Ev)) — ДРУГАЯ формула (:37-38)', () => {
    // Acc=2000, Ev=300: 2500/2090 = 119.62 → кламп 100
    expect(attackerHitChance(2000, 300).hitChancePercent).toBe(100);
    // Acc=300, Ev=1000: 375/600 = 62.5 → round 63
    expect(attackerHitChance(300, 1000).hitChancePercent).toBe(63);
  });

  it('lucky: 1−(1−c)²; extra rolls: 1−(1−c)^(n+1)', () => {
    expect(luckyChance(50)).toBeCloseTo(75, 6);
    expect(chanceWithExtraRolls(50, 1)).toBeCloseTo(75, 6);
    expect(chanceWithExtraRolls(50, 0)).toBeCloseTo(50, 6);
  });
});

describe('ehp: резисты, пулы, suppression (Data.lua:245-256; Misc.lua:149-151)', () => {
  it('резист: taken = (100−res)/100, кап 75, hard 90, floor −200', () => {
    expect(resistanceDr(75).damageTakenMultiplier).toBe(0.25);
    expect(resistanceDr(90).isCapped).toBe(true); // над обычным капом
    expect(resistanceDr(90).resistancePercent).toBe(75); // эффективно 75 (кап по умолчанию)
    expect(resistanceDr(80, 90).resistancePercent).toBe(80); // hard-кап 90
    expect(resistanceDr(-500).resistancePercent).toBe(-200); // floor
  });

  it('ES реберз: 12.5%/с (750%/мин, Misc.lua:147→Data.lua:264), задержка 4с', () => {
    const r = esRecharge(1000);
    expect(r.rechargePerSecond).toBe(125);
    expect(r.delaySeconds).toBe(4);
    expect(esRecharge(1000, 0, 100).delaySeconds).toBe(2); // +100% faster start → 400/200
  });
});

describe('ehp: слоёный калькулятор (порядок PoE2)', () => {
  it('хаос съедает ES с ×2 (CalcDefence.lua:592), ward до life (:524-525)', () => {
    const chaos = calculateEhp({ life: 1000, energyShield: 500 }, 'chaos');
    expect(chaos.rawHp).toBe(1250); // 1000 + 500/2
    const withWard = calculateEhp({ life: 1000, ward: 100 }, 'fire');
    expect(withWard.rawHp).toBe(1100);
  });

  it('phys: evade × block × armor × пул; EHP = пул / damageMult', () => {
    // life=1000, armor 0 → без слоёв EHP == life (res физ = 0)
    const bare = calculateEhp({ life: 1000 }, 'physical');
    expect(bare.effectiveHp).toBe(1000);
    // добавляем блок 50% → EHP ×2
    const blocked = calculateEhp({ life: 1000, blockChance: 50 }, 'physical');
    expect(blocked.effectiveHp).toBe(2000);
    // армор: DR 28.571% против удара 1000 → damageMult 0.7143
    const armored = calculateEhp({ life: 1000, armor: 4000 }, 'physical', { expectedHitSize: 1000 });
    expect(armored.effectiveHp).toBeCloseTo(1400, 0);
  });

  it('элем: резист 75 → EHP ×4; suppression −50% толковый только при 100', () => {
    const res = calculateEhp({ life: 1000, fireRes: 75 }, 'fire');
    expect(res.effectiveHp).toBe(4000);
    const s99 = calculateEhp({ life: 1000, spellSuppressionChance: 99 }, 'fire');
    expect(s99.suppressionMitigation).toBe(0);
    const s100 = calculateEhp({ life: 1000, spellSuppressionChance: 100 }, 'fire');
    expect(s100.suppressionMitigation).toBe(0.5);
  });

  it('санити PoB-28880 (Ice Strike Invoker L97): пулы и слои осмысленны', () => {
    // PlayerStat: Life 1539, ES 4288, Evasion 8706, Armour 3866, 75/75/75/30
    const all = calculateAllEhp({
      life: 1539, energyShield: 4288, armour: 3866, evasion: 8706,
      fireRes: 75, coldRes: 75, lightningRes: 75, chaosRes: 30,
    });
    // элем-пул: (1539+4288)/0.25 ≈ 23308; chaos — худший: (1539+4288/2)·(1/0.7)⁻¹...
    expect(all.fire.effectiveHp).toBeGreaterThan(20000);
    expect(all.chaos.effectiveHp).toBeLessThan(all.fire.effectiveHp);
    // phys EHP выше raw-пула за счёт армора и уклонения
    expect(all.physical.effectiveHp).toBeGreaterThan(1539 + 4288);
    // все finite
    for (const dt of ['physical', 'fire', 'cold', 'lightning', 'chaos'] as const) {
      expect(Number.isFinite(all[dt].effectiveHp)).toBe(true);
    }
  });
});
