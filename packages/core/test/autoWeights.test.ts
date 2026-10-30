import { describe, expect, it } from 'vitest';
import {
  suggestGearFocus,
  gearFocusToOverrides,
  resistContributions,
} from '../src/autoWeights.js';
import { planResistPairs } from '../src/resistPairs.js';

const RING1 = [
  'Item Class: Rings',
  'Rarity: RARE',
  'Hollow Spira',
  'Unset Ring',
  '--------',
  '+40 to maximum Life',
  '+30 to maximum Energy Shield',
  '+12% to Fire Resistance',
  '+26% to Cold Resistance',
].join('\n');

const RING2 = [
  'Item Class: Rings',
  'Rarity: RARE',
  'Loop Spira',
  'Amethyst Ring',
  '--------',
  '+55 to maximum Life',
  '+31% to Lightning Resistance',
  '+15% to Cold Resistance',
].join('\n');

const BOOTS = [
  'Item Class: Boots',
  'Rarity: RARE',
  'Sprintstep',
  'Sinner Trample',
  '--------',
  'Evasion Rating: 250',
  '--------',
  '+30% increased Movement Speed',
  '+70 to maximum Life',
  '12% increased Evasion Rating',
].join('\n');

/** Уник: НЕ должен участвовать в весах. */
const UNIQUE_AMU = [
  'Item Class: Amulets',
  'Rarity: UNIQUE',
  'Uzha',
  'Static Heart',
  '--------',
  '+80 to maximum Life',
  '+60% to Cold Resistance',
].join('\n');

describe('suggestGearFocus (формулы idea-ref, свой код)', () => {
  it('жизнь в 3 слотах = важнейший стат, вес с мультипликатором слотов', () => {
    const f = suggestGearFocus([RING1, RING2, BOOTS]);
    const life = f.find((x) => x.kind === 'life');
    expect(life?.slots).toBe(3);
    // avg = (40+55+70)/3 = 55 → suggestedMin 55; target = 30×(1+0.5·2)=60, кап life 60 → 60
    expect(life?.suggestedMin).toBe(55);
    expect(life?.target).toBe(60);
    expect(f[0]?.kind).toBe('life'); // сортировка: больше слотов → выше
  });

  it('холод в 2 слотах → target = 45', () => {
    const f = suggestGearFocus([RING1, RING2, BOOTS]);
    const cold = f.find((x) => x.kind === 'cres');
    expect(cold?.slots).toBe(2);
    // avg = (26+15)/2 = 20.5 → suggestedMin 20
    expect(cold?.suggestedMin).toBe(20);
    expect(cold?.target).toBe(45); // 30×(1+0.5·1)
  });

  it('MS: один слот → target = 30 (кап 90 — только потолок)', () => {
    const f = suggestGearFocus([BOOTS]);
    const ms = f.find((x) => x.kind === 'ms');
    expect(ms?.target).toBe(30);
    expect(ms?.suggestedMin).toBe(30);
  });

  it('локальные % increased Evasion НЕ взвешиваются (double-count поверх base)', () => {
    const f = suggestGearFocus([BOOTS]);
    expect(f.find((x) => x.kind === 'evasion')).toBeUndefined();
  });

  it('уники исключаются из весов (их моды о билде не говорят)', () => {
    const f = suggestGearFocus([UNIQUE_AMU]);
    expect(f).toEqual([]);
  });

  it('мусорный текст не падает, а пропускается', () => {
    expect(suggestGearFocus(['не предмет вообще'])).toEqual([]);
    expect(suggestGearFocus(['\uFEFF'])).toEqual([]);
  });
});

describe('gearFocusToOverrides', () => {
  it('tolerance 20% → min = floor(avg×0.8)', () => {
    const f = suggestGearFocus([RING1, RING2, BOOTS]);
    const o = gearFocusToOverrides(f, 20);
    const life = o.find((x) => x.name === 'Life');
    expect(life?.min).toBe(44); // floor(55×0.8)
  });
  it('tolerance 0 → min = ролл как есть', () => {
    const o = gearFocusToOverrides(suggestGearFocus([RING2]), 0);
    const lres = o.find((x) => x.name === 'Lightning Res');
    expect(lres?.min).toBe(31);
  });
});

describe('resistContributions', () => {
  it('суммирует резисты каждого предмета', () => {
    const c = resistContributions([RING1, RING2]);
    expect(c.cres.sort((a, b) => a - b)).toEqual([15, 26]);
    expect(c.fres).toEqual([12]);
    expect(c.lres).toEqual([31]);
  });
});

describe('planResistPairs', () => {
  it('капы закрыты — пара не нужна', () => {
    const plans = planResistPairs({ resists: { fire: 75, cold: 90, lightning: 75 } });
    expect(plans).toHaveLength(1);
    expect(plans[0]!.slots).toEqual([]);
    expect(/капе/.test(plans[0]!.summary)).toBe(true);
  });

  it('кейс куба-1 (№545): Cold −41 + Light −3 → пара с нужными минимумами (+buffer)', () => {
    const plans = planResistPairs({ resists: { fire: 75, cold: 34, lightning: 72 } });
    const pair = plans.find((p) => p.slots.length === 2);
    expect(pair).toBeDefined();
    expect(pair!.slots[0]!.needs.cold).toBe(46); // 41+5
    expect(pair!.slots[1]!.needs.lightning).toBe(8); // 3+5
    expect(pair!.closes.cold).toBe(46);
  });

  it('один большой дефицит (>60) даёт и сплит-пару', () => {
    const plans = planResistPairs({ resists: { fire: 75, cold: 5, lightning: 75 } });
    expect(plans[0]!.slots).toHaveLength(1); // одиночный вариант
    const split = plans.find((p) => p.slots.length === 2);
    expect(split).toBeDefined();
    expect(split!.slots[0]!.needs.cold).toBeGreaterThanOrEqual(35); // ceil((70+5)/2)
    expect(split!.slots[1]!.needs.cold).toBe(split!.slots[0]!.needs.cold);
  });

  it('chaos не считается по умолчанию (CI-дисциплина), c includeChaos — считается', () => {
    const noChaos = planResistPairs({ resists: { fire: 75, cold: 75, lightning: 75, chaos: 0 } });
    expect(noChaos[0]!.slots).toEqual([]);
    const withChaos = planResistPairs({ resists: { fire: 75, cold: 75, lightning: 75, chaos: 0 }, includeChaos: true });
    expect(withChaos.some((p) => p.slots.some((s) => s.needs.chaos))).toBe(true);
  });

  it('overcap не создаёт дефицита', () => {
    const plans = planResistPairs({ resists: { fire: 109, cold: 75, lightning: 75 } });
    expect(plans[0]!.slots).toEqual([]);
  });
});
