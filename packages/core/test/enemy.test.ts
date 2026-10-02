import { describe, expect, it } from 'vitest';
import {
  ENEMY_CONSTANTS, enemyPlaceholders, monsterArmourTable, monsterDamageTable,
  monsterEvasionTable, monsterLifeTable, monsterStats, poiseMultiplier,
} from '../src/enemy.js';

/**
 * Фикстуры — числа из исходников PoB2 (репо-донор _research/path-of-building-poe2):
 *  - таблицы: src/Data/Misc.lua:6-14 (индекс = уровень 1..100);
 *  - DPS-множители/пенетрация: src/Modules/Data.lua:294-300
 *      normalEnemyDPSMult = 1/4.40, stdBoss = 4/4.40, pinnacle = 8/4.40,
 *      uber = 10/4.25, pinnacleBossPen = 15/5, uberBossPen = 40/5;
 *  - плейсхолдеры урона/резистов/хаоса: src/Modules/ConfigOptions.lua:2001-2006
 *      (round(dmg · 1.5 · mult), chaos = round(dmg / 2.5), Uber /4 :2130;
 *      резисты Boss 30 :2029, Pinnacle/Uber 50 :2071/:2112);
 *  - PoiseThreshold MORE: ConfigOptions.lua:2024-2025 (500 + 213),
 *      :2066-2067/:2107-2108 (500 + 838);
 *  - MaxEnemyLevel 85: Data.lua:291; крит-мульти монстра 30: Misc.lua:254.
 */

describe('enemy: таблицы монстров = Misc.lua field-by-field', () => {
  it('7 таблиц по 100 значений (уровни 1..100)', () => {
    expect(monsterEvasionTable.length).toBe(100);
    expect(monsterDamageTable.length).toBe(100);
    expect(monsterArmourTable.length).toBe(100);
    expect(monsterLifeTable.length).toBe(100);
  });

  it('точечные значения Misc.lua:6-14', () => {
    // data.monsterEvasionTable = { 24, 30, 36, ... } (Misc.lua:6)
    expect(monsterEvasionTable[0]).toBe(24);
    expect(monsterEvasionTable[75]).toBe(836); // уровень 76
    expect(monsterEvasionTable[81]).toBe(941); // уровень 82
    // data.monsterLifeTable: 15, 20, ... (Misc.lua:8); [82] = 32956
    expect(monsterLifeTable[0]).toBe(15);
    expect(monsterLifeTable[81]).toBe(32956);
    // data.monsterDamageTable: 9.159999… → 9.16 (Misc.lua:10); [82] = 353.67
    expect(monsterDamageTable[0]).toBeCloseTo(9.16, 2);
    expect(monsterDamageTable[81]).toBeCloseTo(353.67, 2);
    // data.monsterArmourTable: 3, 6, ... (Misc.lua:12)
    expect(monsterArmourTable[0]).toBe(3);
    expect(monsterArmourTable[81]).toBe(5375); // [82]
  });

  it('monsterStats сводит таблицы по уровню, кламп 1..100', () => {
    const s = monsterStats(82);
    expect(s.evasion).toBe(941);
    expect(s.life).toBe(32956);
    expect(s.damage).toBeCloseTo(353.67, 2);
    expect(s.armour).toBe(5375);
    expect(monsterStats(150).life).toBe(monsterStats(100).life); // кламп сверху
  });
});

describe('enemy: плейсхолдеры как в ConfigOptions.lua:1982-2138', () => {
  it('обычный враг L82: round(dmg·1.5·(1/4.4)), chaos /2.5 (ConfigOptions.lua:2001-2006)', () => {
    // round(353.67 × 1.5 / 4.4) = round(120.57) = 121
    const e = enemyPlaceholders(82, 'none');
    expect(e.damage).toBe(121);
    expect(e.chaosDamage).toBe(48); // round(121 / 2.5)
    expect(e.elementalResist).toBe(0);
    expect(e.elementalPenetration).toBe(0);
  });

  it('Standard Boss L82: round(dmg·1.5·4/4.4) = 482, ele res 30 (:2042-2047, :2029)', () => {
    const e = enemyPlaceholders(82, 'boss');
    expect(e.damage).toBe(482);
    expect(e.chaosDamage).toBe(193); // round(482/2.5)
    expect(e.elementalResist).toBe(30);
    expect(e.elementalPenetration).toBe(0);
  });

  it('Pinnacle: pen 15/5 = 3, res 50, min уровень 82 (:2084, :2091, :2071)', () => {
    const e = enemyPlaceholders(70, 'pinnacle');
    expect(e.level).toBe(82); // m_max(enemyLevel, 82) — ConfigOptions.lua:2077-2082
    expect(e.damage).toBe(965); // round(530.505 × 8/4.4) = round(964.55)
    expect(e.elementalResist).toBe(50);
    expect(e.elementalPenetration).toBe(3); // Data.lua:298: 15/5
  });

  it('Uber: pen 40/5 = 8, chaos /4 (:2125-2130, :2132, Data.lua:300)', () => {
    const e = enemyPlaceholders(82, 'uber');
    expect(e.damage).toBe(1248); // round(530.505 × 10/4.25)
    expect(e.chaosDamage).toBe(312); // round(1248/4)
    expect(e.elementalPenetration).toBe(8);
  });

  it('криты и скорость по умолчанию (ConfigOptions.lua:1984-1986, Misc.lua:254)', () => {
    const e = enemyPlaceholders(82, 'none');
    expect(e.critChance).toBe(5);
    expect(e.critMultiplier).toBe(30); // monsterConstants base_critical_hit_damage_bonus
    expect(e.speed).toBe(700);
  });
});

describe('enemy: poise-множители боссов (ConfigOptions.lua:2024-2125)', () => {
  it('Boss: (1+5.00)·(1+2.13) = 18.78', () => {
    expect(poiseMultiplier('boss')).toBeCloseTo(18.78, 4);
  });
  it('Pinnacle/Uber: (1+5.00)·(1+8.38) = 56.28', () => {
    expect(poiseMultiplier('pinnacle')).toBeCloseTo(56.28, 4);
    expect(poiseMultiplier('uber')).toBeCloseTo(56.28, 4);
  });
  it('poiseThreshold босса = таблица × множитель', () => {
    // poise[82] = 236905 (Misc.lua:14); ×18.78
    const e = enemyPlaceholders(82, 'boss');
    expect(e.poiseThreshold).toBe(Math.round(236905 * 18.78));
  });
});

describe('enemy: константы Data.lua', () => {
  it('MaxEnemyLevel 85 (Data.lua:291), DotDpsCap (2^31-1)/60 (Data.lua:269)', () => {
    expect(ENEMY_CONSTANTS.MAX_ENEMY_LEVEL).toBe(85);
    expect(ENEMY_CONSTANTS.DOT_DPS_CAP).toBe(35791394);
  });
  it('DPS-множителиNORMAL..UBER (Data.lua:295-300)', () => {
    expect(ENEMY_CONSTANTS.BOSS_DPS_MULT.none).toBeCloseTo(1 / 4.4, 10);
    expect(ENEMY_CONSTANTS.BOSS_DPS_MULT.boss).toBeCloseTo(4 / 4.4, 10);
    expect(ENEMY_CONSTANTS.BOSS_DPS_MULT.pinnacle).toBeCloseTo(8 / 4.4, 10);
    expect(ENEMY_CONSTANTS.BOSS_DPS_MULT.uber).toBeCloseTo(10 / 4.25, 10);
  });
});
