import { describe, expect, it } from 'vitest';
import {
  AILMENT_CONSTANTS, ailmentChance, ailmentDotDps, buildupPerHit, chillEffect,
  chillThreshold, shockMagnitude,
} from '../src/ailments.js';

/**
 * Фикстуры — из исходников PoB2 (_research/path-of-building-poe2):
 *  - базы DoT (в секунду): Data.lua:270-275 = gameConstants/60/100:
 *      Bleed 900%/мин → 0.15/с, dur 5с (Misc.lua:87, :91);
 *      Poison 1200%/мин → 0.2/с, dur 2с (Misc.lua:89, :96);
 *      Ignite 1200%/мин → 0.2/с, dur 4с (Misc.lua:88, :97);
 *    применение + кап DotDpsCap: CalcOffence.lua:5398-5405, Data.lua:269;
 *  - buildup: CalcOffence.lua:5569-5582
 *      `DamageScale / enemyPoiseThreshold × (1+inc/100) × more × 100`;
 *      DamageScale: HeavyStun 0.58, Freeze 2.1, Electrocute 1.7, Pin 4.2
 *      (Misc.lua:49,55,61,66);
 *  - шанс Ignite/Shock: CalcOffence.lua:5614-5629
 *      `(hit/threshold × ChanceMultiplier + base) × (1+inc/100) × more,
 *       кап 100`; множители: Shock 25, Ignite 20 (Misc.lua:72-73);
 *  - Chill: порог = threshold / ChillEffectMultiplier=100
 *      (CalcOffence.lua:5550-5551), эффект = 100·(dmg/thr),
 *      clamp [30..50] (CalcOffence.lua:5672-5675; Data.lua:415; Misc.lua:78);
 *  - Shock эффект (hit-based, ramping): 50·(dmg/thr)^0.4,
 *      clamp [BaseShockMagnitude 20 .. 100] (CalcOffence.lua:5678-5683;
 *      Data.lua:417; Misc.lua:75).
 */

describe('ailments: DoT-базы (Data.lua:270-275; Misc.lua:87-97)', () => {
  it('ignite: 20%·magnitude в секунду, длительность 4с', () => {
    // hit 500, magnitude ×1.5 → 500×0.2×1.5 = 150/с; тотал 150×4 = 600
    const r = ailmentDotDps({ hitDamage: 500, ailment: 'ignite', magnitudeMultiplier: 1.5 });
    expect(r.damagePerSecond).toBeCloseTo(150, 6);
    expect(r.durationSeconds).toBe(4);
    expect(r.totalDamage).toBe(600);
  });

  it('poison: 20%/с, стакается (CalcOffence.lua:5399 activeAilments)', () => {
    const one = ailmentDotDps({ hitDamage: 500, ailment: 'poison' });
    expect(one.damagePerSecond).toBeCloseTo(100, 6);
    const two = ailmentDotDps({ hitDamage: 500, ailment: 'poison', stacks: 2 });
    expect(two.damagePerSecond).toBeCloseTo(200, 6);
  });

  it('bleed: 15%/с (900%/мин), длительность 5с', () => {
    expect(AILMENT_CONSTANTS.BLEED_PERCENT_BASE).toBe(0.15);
    expect(AILMENT_CONSTANTS.BLEED_DURATION_BASE).toBe(5);
    expect(ailmentDotDps({ hitDamage: 1000, ailment: 'bleed' }).damagePerSecond).toBeCloseTo(150, 6);
  });

  it('DotDpsCap = (2^31-1)/60 = 35791394 (Data.lua:269; CalcOffence.lua:5401)', () => {
    const r = ailmentDotDps({ hitDamage: 1e12, ailment: 'ignite', stacks: 100 });
    expect(r.damagePerSecond).toBe(AILMENT_CONSTANTS.DOT_DPS_CAP);
    expect(r.capped).toBe(true);
  });

  it('длительность режется rate-модами: base/(1+inc)/more',
    () => {
      const r = ailmentDotDps({
        hitDamage: 100, ailment: 'poison', increasedRatePercent: 100, moreRateMultiplier: 2,
      });
      expect(r.durationSeconds).toBeCloseTo(0.5, 6);
      expect(r.damagePerSecond).toBeCloseTo(100 * 0.2 * 2 * 2, 4);
    });
});

describe('ailments: buildup (CalcOffence.lua:5569-5582)', () => {
  it('electrocute: 1.7·dmg/thr; 34%/удар при dmg/thr = 1/5', () => {
    // (1.7 × 1000 / 5000) × 100 = 34%
    const r = buildupPerHit({ hitDamage: 1000, type: 'electrocute', enemyPoiseThreshold: 5000 });
    expect(r.buildupPercentPerHit).toBeCloseTo(34, 6);
    expect(r.hitsToTrigger).toBe(3); // ceil(100/34)
  });

  it('DamageScales каноничные (Misc.lua:49,55,61,66)', () => {
    expect(AILMENT_CONSTANTS.HEAVY_STUN_DAMAGE_SCALE).toBe(0.58);
    expect(AILMENT_CONSTANTS.FREEZE_DAMAGE_SCALE).toBe(2.1);
    expect(AILMENT_CONSTANTS.ELECTROCUTE_DAMAGE_SCALE).toBe(1.7);
    expect(AILMENT_CONSTANTS.PIN_DAMAGE_SCALE).toBe(4.2);
  });

  it('босс-порог учитывает poiseMultiplier: Xesht-боссу нужно больше ударов', () => {
    const normal = buildupPerHit({ hitDamage: 2000, type: 'heavyStun', enemyPoiseThreshold: 5000 });
    const boss = buildupPerHit({ hitDamage: 2000, type: 'heavyStun', enemyPoiseThreshold: 5000 * 18.78 });
    expect(boss.hitsToTrigger).toBeGreaterThan(normal.hitsToTrigger);
  });
});

describe('ailments: шанс Ignite/Shock (CalcOffence.lua:5614-5629)', () => {
  it('chance = (hit/thr·mult + base)·(1+inc)·more, кап 100', () => {
    // Ignite mult 20: hit = thr → 20%; hit = 5·thr → 100%
    const small = ailmentChance({ hitDamage: 1000, enemyAilmentThreshold: 1000, type: 'ignite' });
    expect(small.chancePercent).toBeCloseTo(20, 6);
    const sure = ailmentChance({ hitDamage: 5000, enemyAilmentThreshold: 1000, type: 'ignite' });
    expect(sure.chancePercent).toBe(100);
    expect(small.minimumHitDamage).toBe(5000); // 100/mult × thr
  });

  it('Shock mult 25, Ignite 20, прочие 25 (Misc.lua:72-74)', () => {
    expect(AILMENT_CONSTANTS.SHOCK_CHANCE_MULTIPLIER).toBe(25);
    expect(AILMENT_CONSTANTS.IGNITE_CHANCE_MULTIPLIER).toBe(20);
    expect(AILMENT_CONSTANTS.MISC_AILMENT_CHANCE_MULTIPLIER).toBe(25);
  });
});

describe('ailments: Chill/Shock эффекты', () => {
  it('chillThreshold = thr/100 (CalcOffence.lua:5550-5551)', () => {
    expect(chillThreshold(38879)).toBeCloseTo(388.79, 6);
  });

  it('chillEffect = 100·dmg/thr, clamp [30..50] (:5672-5675; Data.lua:415)', () => {
    // dmg/thr = 0.4 → 40%
    expect(chillEffect(400, 1000)).toBeCloseTo(40, 6);
    // малый удар → минимум 30
    expect(chillEffect(100, 1000)).toBe(30);
    // dmg/thr ≥ 0.5 → кап 50 (Misc.lua:78)
    expect(chillEffect(500, 1000)).toBe(50);
  });

  it('shockMagnitude = 50·(dmg/thr)^0.4, clamp [20..100] (:5678-5683; Data.lua:417)', () => {
    // dmg = thr → 50%
    expect(shockMagnitude(1000, 1000)).toBeCloseTo(50, 6);
    // dmg = 2·thr → 50·2^0.4 = 65.94
    expect(shockMagnitude(2000, 1000)).toBeCloseTo(50 * 2 ** 0.4, 4);
    // малый урон → минимум BaseShockMagnitude 20
    expect(shockMagnitude(1, 10000)).toBe(20);
    // огромный → кап 100
    expect(shockMagnitude(1e9, 1)).toBe(100);
  });
});
