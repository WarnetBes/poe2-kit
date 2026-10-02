import { describe, it, expect } from 'vitest';
import {
  maxLife,
  maxMana,
  manaRegenPerSec,
  maxEnergyShield,
  RESOURCE_CONSTANTS,
} from '../src/resources.js';

describe('resources: базовые формулы (канон PoB2)', () => {
  it('life = 12·level + 16 на реперных уровнях', () => {
    expect(maxLife(1)).toBe(28); // 12 + 16
    expect(maxLife(27)).toBe(340); // снапшот Pandaren lvl27, baseLife 340
    expect(maxLife(100)).toBe(1216);
  });

  it('mana = 4·level + 30 на реперных уровнях', () => {
    expect(maxMana(1)).toBe(34);
    expect(maxMana(27)).toBe(138);
    expect(maxMana(100)).toBe(430);
  });

  it('уровень клампится в 1..100 (NaN → 1)', () => {
    expect(maxLife(0)).toBe(28); // кламп 1
    expect(maxLife(-10)).toBe(28);
    expect(maxLife(150)).toBe(1216); // кламп 100
    expect(maxLife(Number.NaN)).toBe(28);
    expect(maxMana(0)).toBe(34);
  });
});

describe('resources: модификаторы пула (flat → increased → more, floor)', () => {
  it('flat + increased: (base+flat)×(1+inc%)', () => {
    // (340 + 40) × 1.10 = 418
    expect(maxLife(27, { flat: 40, increasedPercent: 10 })).toBe(418);
  });

  it('more-множители перемножаются после increased', () => {
    // (340 + 40) × 1.10 × 1.20 = 501.6 → floor 501
    expect(maxLife(27, { flat: 40, increasedPercent: 10, moreMultipliers: [0.2] })).toBe(501);
    // несколько more: 340 × 1.0 × 1.1 × 1.1 = 411.4 → 411
    expect(maxLife(27, { moreMultipliers: [0.1, 0.1] })).toBe(411);
  });

  it('ES не имеет базы от уровня: только моды', () => {
    expect(maxEnergyShield()).toBe(0);
    expect(maxEnergyShield({ flat: 100, increasedPercent: 50 })).toBe(150);
  });
});

describe('resources: реген маны', () => {
  it('4%/с от макс. маны (240%/мин)', () => {
    expect(manaRegenPerSec(100)).toBeCloseTo(4, 10);
    expect(manaRegenPerSec(138)).toBeCloseTo(5.52, 10);
  });

  it('increased % и flat реген', () => {
    expect(manaRegenPerSec(100, 50)).toBeCloseTo(6, 10); // 4 × 1.5
    expect(manaRegenPerSec(100, 0, 2)).toBeCloseTo(6, 10); // 4 + 2
    expect(manaRegenPerSec(100, 50, 2)).toBeCloseTo(8, 10); // 6 + 2
  });

  it('константы канона не изменились', () => {
    expect(RESOURCE_CONSTANTS.LIFE_PER_LEVEL).toBe(12);
    expect(RESOURCE_CONSTANTS.LIFE_LEVEL_BASE).toBe(16);
    expect(RESOURCE_CONSTANTS.MANA_PER_LEVEL).toBe(4);
    expect(RESOURCE_CONSTANTS.MANA_LEVEL_BASE).toBe(30);
    expect(RESOURCE_CONSTANTS.MANA_REGEN_PER_SEC).toBe(0.04);
  });
});
