import { describe, expect, it } from 'vitest';
import {
  verdictForSlot,
  pickDpsKey,
  pickBestSlot,
  DEFAULT_PRIORITIES,
  type PobStatsLike,
} from '../src/upgradeVerdict.js';
import { candidateSlotsFor } from '../src/swapItem.js';

/** Базовые «до» — реалистичный CI-Invoker (э-дPPO цифры синтетические). */
const BEFORE: PobStatsLike = {
  FullDPS: 600000,
  TotalDPS: 500000,
  CombinedDPS: 520000,
  MinionCombinedDPS: 0,
  TotalEHP: 40000,
  Life: 1,
  EnergyShield: 4273,
  Spirit: 253,
  SpiritUnreserved: 232,
  Str: 155, Dex: 111, Int: 118,
  ReqStr: 120, ReqDex: 100, ReqInt: 100,
  FireResist: 75, ColdResist: 75, LightningResist: 75, ChaosResist: 14,
  MovementSpeedMod: 0.3,
};

const after = (patch: Partial<PobStatsLike>): PobStatsLike => ({ ...BEFORE, ...patch });

describe('pickDpsKey', () => {
  it('FullDPS > 0 — главный ключ', () => {
    expect(pickDpsKey(BEFORE)).toBe('FullDPS');
  });
  it('CoC-артефакт FullDPS=0 (№611) — фолбэк вниз по цепочке одной и той же стороной', () => {
    expect(pickDpsKey(after({ FullDPS: 0, CombinedDPS: 300000, TotalDPS: 250000 }))).toBe('CombinedDPS');
  });
  it('миньон-билд живёт на MinionCombined', () => {
    expect(
      pickDpsKey({ FullDPS: 0, TotalDPS: 0, CombinedDPS: 0, MinionCombinedDPS: 900000 }),
    ).toBe('MinionCombinedDPS');
  });
  it('все нули = null (uncertain-контекст)', () => {
    expect(pickDpsKey({ FullDPS: 0, TotalDPS: 0, CombinedDPS: 0, MinionCombinedDPS: 0 })).toBeNull();
  });
});

describe('verdictForSlot — гварды', () => {
  it('чистое усиление DPS+EHP = upgrade с причинностью', () => {
    const v = verdictForSlot('Gloves', BEFORE, after({ FullDPS: 700000, TotalEHP: 45000 }));
    expect(v.verdict).toBe('upgrade');
    expect(v.dpsKey).toBe('FullDPS');
    expect(v.reasons.some((r) => r.direction === 'gain' && /DPS/.test(r.text))).toBe(true);
    expect(v.guards.resistCapLost).toBe(false);
  });
  it('[id=' + '] потеря резист-капа кэпит апгрейд (resFirst)', () => {
    const v = verdictForSlot('Ring 1', BEFORE, after({ FullDPS: 900000, ColdResist: 50 }));
    expect(v.verdict).toBe('loses_resistance');
    expect(v.guards.resistCapLost).toBe(true);
  });
  it('потеря резист-хвоста в пределах буфера над капом не карается', () => {
    const v = verdictForSlot('Ring 1', BEFORE, after({ FullDPS: 700000, ColdResist: 71 }));
    expect(v.verdict).toBe('upgrade'); // 71 ≥ 75−5: буфер прощает
  });
  it('Chaos при CI не считается (chaos=false — умолчание)', () => {
    const v = verdictForSlot('Amulet', BEFORE, after({ FullDPS: 700000, ChaosResist: -60 }));
    expect(v.verdict).toBe('upgrade');
  });
  it('Chaos считается при chaos:true', () => {
    const v = verdictForSlot('Amulet', BEFORE, after({ FullDPS: 700000, ChaosResist: -60 }), { chaos: true });
    expect(v.guards.resistCapLost).toBe(true);
  });
  it('Spirit уходит в минус = not_viable (не «апгрейд, но…»)', () => {
    const v = verdictForSlot('Weapon 1', BEFORE, after({ FullDPS: 1200000, SpiritUnreserved: -7 }));
    expect(v.verdict).toBe('not_viable');
    expect(v.guards.spiritBreak).toBe(true);
  });
  it('требования атрибутов выше статов = not_viable', () => {
    const v = verdictForSlot('Body Armour', BEFORE, after({ FullDPS: 650000, ReqStr: 200 }));
    expect(v.verdict).toBe('not_viable');
    expect(v.guards.attrsBreak).toBe(true);
  });
  it('hold-MS: потеря ≥3 пунктов скорости кэпит апгрейд в sidegrade', () => {
    const v = verdictForSlot('Boots', BEFORE, after({ FullDPS: 620000, TotalEHP: 41000, MovementSpeedMod: 0.27 }));
    expect(v.verdict).toBe('sidegrade');
    expect(v.guards.msBreak).toBe(true);
  });
  it('hold-MS отключается приоритетом keepMs:false', () => {
    const v = verdictForSlot('Boots', BEFORE, after({ FullDPS: 620000, TotalEHP: 41000, MovementSpeedMod: 0.27 }), {
      keepMs: false,
    });
    expect(v.verdict).toBe('upgrade');
  });
});

describe('verdictForSlot — классификация', () => {
  it('ровный обмен без решающего счёта = sidegrade (полоса 47-53)', () => {
    const v = verdictForSlot('Gloves', BEFORE, after({ FullDPS: 603000, TotalEHP: 39800 }));
    expect(v.verdict).toBe('sidegrade');
    expect(v.score).toBeGreaterThanOrEqual(47);
    expect(v.score).toBeLessThanOrEqual(53);
  });
  it('двусторонняя просадка = downgrade', () => {
    const v = verdictForSlot('Gloves', BEFORE, after({ FullDPS: 500000, TotalEHP: 35000 }));
    expect(v.verdict).toBe('downgrade');
  });
  it('DPS растёт, EHP падает меньше = апгрейд по нету', () => {
    const v = verdictForSlot('Weapon 1', BEFORE, after({ FullDPS: 900000, TotalEHP: 38000 }));
    expect(v.verdict).toBe('upgrade');
  });
  it('EHP растёт, DPS падает меньше = защитный minor_upgrade', () => {
    const v = verdictForSlot('Body Armour', BEFORE, after({ FullDPS: 590000, TotalEHP: 50000 }));
    expect(v.verdict).toBe('minor_upgrade');
  });
  it('нулевой DPS-ключ (все нули) = uncertain, не «слабый апгрейд»', () => {
    const zero = { FullDPS: 0, TotalDPS: 0, CombinedDPS: 0, MinionCombinedDPS: 0, TotalEHP: 1000 };
    const v = verdictForSlot('Ring 1', zero, { ...zero, TotalEHP: 1200 });
    expect(v.verdict).toBe('uncertain');
  });
  it('слабый плюс в обе стороны < 2% = minor_upgrade', () => {
    const v = verdictForSlot('Ring 2', BEFORE, after({ FullDPS: 605000, TotalEHP: 40200 }));
    expect(v.verdict).toBe('minor_upgrade');
  });
});

describe('pickBestSlot (примерка кольца в 1/2)', () => {
  it('лучший по рангу, при равенстве — по скору', () => {
    const down = verdictForSlot('Ring 1', BEFORE, after({ FullDPS: 400000 }));
    const up = verdictForSlot('Ring 2', BEFORE, after({ FullDPS: 800000, TotalEHP: 42000 }));
    const best = pickBestSlot([down, up]);
    expect(best?.slot).toBe('Ring 2');
    expect(best?.verdict).toBe('upgrade');
  });
  it('пусто → null', () => {
    expect(pickBestSlot([])).toBeNull();
  });
});

describe('candidateSlotsFor', () => {
  it('кольцо → оба слота', () => {
    const ringText = [
      'Item Class: Rings',
      'Rarity: RARE',
      'Hollow Spira',
      'Unset Ring',
      '--------',
      'Requires Level 64',
    ].join('\n');
    expect(candidateSlotsFor(ringText)).toEqual(['Ring 1', 'Ring 2']);
  });
  it('явные слоты фильтруются каноном PoB', () => {
    expect(candidateSlotsFor('любой', ['Ring 2', 'NonsenseSlot'])).toEqual(['Ring 2']);
  });
  it('мусорный класс → пусто (честное отсутствие кандидатов)', () => {
    expect(candidateSlotsFor('not an item')).toEqual([]);
  });
});

describe('DEFAULT_PRIORITIES', () => {
  it('resFirst/spirit/attrs/keepMs включены, chaos выключен', () => {
    expect(DEFAULT_PRIORITIES.resFirst).toBe(true);
    expect(DEFAULT_PRIORITIES.spirit).toBe(true);
    expect(DEFAULT_PRIORITIES.attrs).toBe(true);
    expect(DEFAULT_PRIORITIES.keepMs).toBe(true);
    expect(DEFAULT_PRIORITIES.chaos).toBe(false);
    expect(DEFAULT_PRIORITIES.resistBuffer).toBe(5);
    expect(DEFAULT_PRIORITIES.msBreakPoints).toBe(3);
  });
});
