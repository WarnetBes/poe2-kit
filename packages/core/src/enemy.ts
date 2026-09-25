/**
 * Статы монстров PoE2 по уровням и пресеты боссов.
 *
 * Канон: PathOfBuilding-PoE2 (HEAD ce566ea, ветка dev):
 *  - src/Data/Misc.lua:6-14 — таблицы DefaultMonsterStats.dat по уровням 1..100;
 *  - src/Modules/Data.lua:239-315 — data.misc («магические числа»), bossStats;
 *  - src/Modules/ConfigOptions.lua:1981-2148 — пресеты enemyIsBoss
 *    (Boss / Pinnacle / Uber: резисты, урон, пенетрация, poise-мод).
 *
 * Отличие от PoE1: у PoE2 свои таблицы (там уровни до 110, иные значения);
 * числа PathOfBuilding-PoE2-v2 (pre-EA форк) использовать нельзя.
 */

// ─── Таблицы монстров (Misc.lua:6-14; индекс = уровень 1..100) ────────────────

export const monsterEvasionTable: readonly number[] = [
  24, 30, 36, 43, 49, 56, 63, 70, 77, 84, 91, 98, 105, 113, 120, 128, 136, 144, 152, 160, 168, 176, 185, 193, 202, 211, 220, 229, 238, 247, 257, 266, 276, 286, 296, 306, 316, 326, 337, 347, 358, 369, 380, 391, 403, 414, 426, 438, 449, 462, 474, 486, 499, 511, 524, 537, 551, 564, 578, 591, 605, 619, 634, 648, 663, 677, 692, 708, 723, 738, 754, 770, 786, 803, 819, 836, 853, 870, 887, 905, 923, 941, 959, 977, 996, 1015, 1034, 1053, 1073, 1093, 1113, 1133, 1154, 1174, 1195, 1217, 1238, 1260, 1282, 1304,
];;

export const monsterAccuracyTable: readonly number[] = [
  32, 35, 39, 43, 48, 52, 57, 62, 67, 72, 78, 84, 90, 96, 103, 110, 117, 124, 132, 140, 149, 158, 167, 176, 186, 196, 207, 218, 230, 242, 254, 267, 281, 295, 309, 325, 340, 356, 373, 391, 409, 428, 447, 468, 489, 511, 533, 557, 581, 606, 632, 659, 688, 717, 747, 778, 810, 844, 878, 914, 951, 990, 1030, 1071, 1114, 1158, 1204, 1251, 1300, 1351, 1403, 1457, 1514, 1572, 1632, 1694, 1758, 1824, 1893, 1964, 2038, 2114, 2192, 2273, 2357, 2444, 2534, 2626, 2722, 2821, 2923, 3029, 3138, 3251, 3368, 3488, 3613, 3741, 3874, 4011,
];;

export const monsterLifeTable: readonly number[] = [
  15, 20, 24, 28, 33, 38, 45, 50, 58, 67, 78, 89, 103, 118, 134, 158, 178, 200, 224, 249, 276, 305, 335, 366, 400, 434, 472, 510, 551, 593, 637, 683, 731, 790, 853, 921, 995, 1074, 1160, 1253, 1353, 1462, 1578, 1705, 1841, 1967, 2101, 2244, 2395, 2556, 2726, 2909, 3102, 3307, 3525, 3756, 4002, 4264, 4540, 4834, 5147, 5478, 5829, 6203, 6555, 7079, 7646, 8257, 8918, 11148, 11984, 12882, 13849, 14887, 18609, 20005, 21505, 23118, 24852, 31065, 31997, 32956, 33945, 34963, 36012, 37093, 38206, 39352, 40532, 41748, 43001, 44291, 45619, 46988, 48398, 49850, 51345, 52885, 54472, 56106,
];;

export const monsterDamageTable: readonly number[] = [
  9.16, 10.26, 11.39, 12.57, 13.78, 15.03, 16.32, 17.65, 19.02, 20.44, 21.90, 23.41, 24.97, 26.57, 28.23, 29.93, 31.69, 33.50, 35.37, 37.29, 39.27, 41.31, 43.41, 45.57, 47.80, 50.09, 52.45, 54.88, 57.37, 59.94, 62.59, 65.31, 68.10, 70.98, 73.94, 76.98, 80.11, 83.32, 86.63, 90.02, 93.51, 97.10, 100.79, 104.57, 108.46, 112.46, 116.57, 120.78, 125.12, 129.56, 134.13, 138.82, 143.64, 148.58, 153.66, 158.87, 164.21, 169.70, 175.34, 181.12, 187.05, 193.14, 199.38, 205.79, 212.36, 219.11, 226.03, 233.12, 240.40, 247.86, 255.52, 263.37, 271.42, 279.68, 288.14, 296.82, 305.72, 314.84, 324.19, 333.78, 343.60, 353.67, 364, 374.58, 385.42, 396.53, 407.92, 419.58, 431.54, 443.79, 456.34, 469.20, 482.38, 495.87, 509.70, 523.86, 538.37, 553.23, 568.46, 584.05,
];;

export const monsterArmourTable: readonly number[] = [
  3, 6, 8, 10, 13, 16, 19, 22, 26, 30, 34, 39, 43, 49, 54, 60, 67, 73, 81, 89, 97, 106, 116, 126, 137, 149, 161, 174, 189, 204, 220, 237, 255, 274, 295, 317, 340, 364, 391, 418, 448, 479, 512, 547, 585, 624, 666, 711, 758, 808, 861, 917, 976, 1039, 1105, 1176, 1250, 1329, 1412, 1500, 1594, 1692, 1796, 1906, 2023, 2146, 2276, 2413, 2558, 2712, 2874, 3044, 3225, 3416, 3617, 3829, 4053, 4290, 4540, 4803, 5081, 5375, 5684, 6011, 6355, 6718, 7101, 7505, 7930, 8379, 8852, 9351, 9877, 10431, 11015, 11630, 12279, 12962, 13682, 14441,
];;

/** Порог айлментов = фактический LIFE монстра с экстраполяцией после ур. 75 (Misc.lua:13; CalcOffence.lua:5610). */
export const monsterAilmentThresholdTable: readonly number[] = [
  15, 20, 24, 28, 34, 39, 46, 52, 60, 70, 81, 95, 110, 126, 144, 171, 193, 218, 245, 275, 306, 340, 376, 413, 455, 497, 543, 590, 641, 695, 752, 812, 874, 950, 1033, 1123, 1220, 1326, 1442, 1568, 1705, 1854, 2015, 2192, 2384, 2564, 2757, 2966, 3188, 3426, 3681, 3955, 4247, 4560, 4895, 5254, 5638, 6049, 6489, 6959, 7462, 8001, 8576, 9193, 9649, 10228, 10841, 11492, 12181, 18272, 19369, 20531, 21763, 23068, 34602, 36679, 38879, 41212, 43685, 65527, 68415, 71303, 74191, 77079, 79967, 82855, 85743, 88631, 91519, 94407, 97295, 100183, 103071, 105959, 108847, 111735, 114623, 117511, 120399, 123287,
];;

/** Порог poise (Heavy Stun / Freeze / Electrocute / Pin buildup), Misc.lua:14. */
export const monsterPoiseThresholdTable: readonly number[] = [
  30, 40, 48, 57, 67, 79, 93, 106, 122, 142, 165, 192, 220, 254, 290, 344, 390, 437, 488, 542, 599, 659, 724, 791, 862, 937, 1015, 1097, 1183, 1273, 1367, 1464, 1567, 1660, 1758, 1864, 1976, 2093, 2219, 2352, 2494, 2644, 2804, 2971, 3150, 3369, 3598, 3846, 4109, 4387, 4685, 5002, 5338, 5697, 6078, 6485, 6915, 7377, 7866, 8386, 8940, 9528, 10153, 10819, 26703, 28651, 30662, 32890, 35192, 53405, 57263, 61392, 65810, 70537, 106973, 114630, 122820, 131580, 140949, 213635, 225270, 236905, 248540, 260175, 271810, 283445, 295080, 306715, 318350, 329985, 341620, 353255, 364890, 376525, 388160, 399795, 411430, 423065, 434700, 446335,
];;

// ─── Константы врага (Data.lua:240-315, ConfigOptions.lua:1981-2148) ──────────

export const ENEMY_CONSTANTS = {
  /** Максимум учитываемого уровня монстра (Data.lua:280). */
  MAX_ENEMY_LEVEL: 85,
  /** Размер таблиц: уровни 1..100 (Misc.lua). */
  TABLE_MAX_LEVEL: 100,
  /** Серверный тик, 1/0.033 (Data.lua:240-241) — кап скорости атак/кастов. */
  SERVER_TICK_RATE: 1 / 0.033,
  /** Кап DoT-DPS: (2^31-1)/60 (Data.lua:261). */
  DOT_DPS_CAP: 35791394,
  /** Базовый множитель урона врага в плейсхолдерах PoB (ConfigOptions.lua:2001+). */
  MONSTER_DAMAGE_FACTOR: 1.5,
  /** Divider хаос-урона врага: /2.5 (Boss/Pinnacle), /4 (Uber). */
  CHAOS_DAMAGE_DIVISOR: 2.5,
  CHAOS_DAMAGE_DIVISOR_UBER: 4,
  /** Крит по умолчанию: 5% шанс, +30% мульти (Misc.lua:254 base_critical_hit_damage_bonus; ConfigOptions.lua:1986-1988). */
  ENEMY_CRIT_CHANCE: 5,
  ENEMY_CRIT_MULTIPLIER: 30,
  /** Скорость врага по умолчанию (Placeholder, ConfigOptions.lua:1990). */
  ENEMY_SPEED: 700,
  /** Poise-моды пресетов боссов — MORE-проценты (ConfigOptions.lua:2024-2025, 2066-2067, 2107-2108): */
  POISE_MORE_UNIQUE: 500, // MonsterUnique2 — любой босс
  POISE_MORE_MAP_BOSS: 213, // только Standard Boss
  POISE_MORE_XESHT: 838, // Pinnacle/Uber
  /** EHP-мультипликаторы DPS-плейсхолдеров (Data.lua:307-311):
   *  ожидаемый DPS врага = monsterDamageTable[lvl] × 1.5 × mult. */
  BOSS_DPS_MULT: {
    none: 1 / 4.4,
    boss: 4 / 4.4,
    pinnacle: 8 / 4.4,
    uber: 10 / 4.25,
  } as Record<BossMode, number>,
  /** Пенетрация элем-резистов врага (Data.lua:310-311). */
  BOSS_PEN: {
    boss: 0,
    pinnacle: 15 / 5,
    uber: 40 / 5,
  } as Record<Exclude<BossMode, 'none'>, number>,
  /** Элем-резисты по умолчанию (ConfigOptions.lua:2035, 2073, 2111). */
  BOSS_ELEMENTAL_RES: { boss: 30, pinnacle: 50, uber: 50 } as Record<Exclude<BossMode, 'none'>, number>,
  /** Элем-множители к броне/уклонению (data.bossStats в PoB считаются из Data/BossSkills
   *  при загрузке; значения зависят от датасета боссов — передаются опционально, 1 = без множителя). */
} as const;

export type BossMode = 'none' | 'boss' | 'pinnacle' | 'uber';

export interface MonsterStats {
  level: number;
  evasion: number;
  accuracy: number;
  life: number;
  damage: number;
  armour: number;
  ailmentThreshold: number;
  poiseThreshold: number;
}

function tableAt(table: readonly number[], level: number): number {
  const lvl = Math.min(Math.max(1, Math.round(level)), ENEMY_CONSTANTS.TABLE_MAX_LEVEL);
  return table[lvl - 1]!;
}

/** Статы «обычного» монстра по уровню (таблицы Misc.lua, кламп 1..100). */
export function monsterStats(level: number): MonsterStats {
  return {
    level,
    evasion: tableAt(monsterEvasionTable, level),
    accuracy: tableAt(monsterAccuracyTable, level),
    life: tableAt(monsterLifeTable, level),
    damage: tableAt(monsterDamageTable, level),
    armour: tableAt(monsterArmourTable, level),
    ailmentThreshold: tableAt(monsterAilmentThresholdTable, level),
    poiseThreshold: tableAt(monsterPoiseThresholdTable, level),
  };
}

export interface EnemyPlaceholders {
  level: number;
  boss: BossMode;
  /** Плейсхолдерный урон одного удара (physical/lightning/cold/fire). */
  damage: number;
  chaosDamage: number;
  armour: number;
  evasion: number;
  elementalResist: number;
  chaosResist: number;
  /** Пенетрация элем-резистов игрока (Pinnacle 3%, Uber 8%). */
  elementalPenetration: number;
  physicalOverwhelm: number;
  speed: number;
  critChance: number;
  critMultiplier: number;
  /** Итоговый множитель порога poise босса. */
  poiseMultiplier: number;
  life: number;
  poiseThreshold: number;
}

/**
 * Итоговый множитель PoiseThreshold босса (MORE-моды перемножаются,
 * ConfigOptions.lua:2024-2025, 2066-2067, 2107-2108):
 *  - Boss:      ×(1+5.00) × (1+2.13) = ×18.78
 *  - Pinnacle:  ×(1+5.00) × (1+8.38) = ×56.28
 *  - Uber:      как Pinnacle (×56.28) + DamageTaken MORE -70
 */
export function poiseMultiplier(boss: BossMode): number {
  const unique = 1 + ENEMY_CONSTANTS.POISE_MORE_UNIQUE / 100;
  if (boss === 'none') return 1;
  if (boss === 'boss') return unique * (1 + ENEMY_CONSTANTS.POISE_MORE_MAP_BOSS / 100);
  return unique * (1 + ENEMY_CONSTANTS.POISE_MORE_XESHT / 100);
}

/**
 * Плейсхолдеры врага — как их подставляет PoB в Config
 * (ConfigOptions.lua:1981-2148): урон, резисты, пенетрация, броня/уклонение.
 *
 * `armourMult`/`evasionMult` — средние бонусы боссов из data.bossStats
 * (PoB считает их из Data/BossSkills при загрузке; 1 = базовые таблицы).
 * Для Pinnacle/Uber уровень босса = max(level, 82).
 */
export function enemyPlaceholders(
  level: number,
  boss: BossMode = 'none',
  opts: { armourMult?: number; evasionMult?: number } = {},
): EnemyPlaceholders {
  const lvl = boss === 'none' || boss === 'boss'
    ? Math.min(Math.max(1, Math.round(level)), ENEMY_CONSTANTS.MAX_ENEMY_LEVEL)
    : Math.max(Math.round(level), 82);
  const tableLvl = Math.min(lvl, ENEMY_CONSTANTS.TABLE_MAX_LEVEL);
  const base = monsterStats(tableLvl);
  const dpsMult = ENEMY_CONSTANTS.BOSS_DPS_MULT[boss];
  const damage = Math.round(
    tableAt(monsterDamageTable, tableLvl) * ENEMY_CONSTANTS.MONSTER_DAMAGE_FACTOR * dpsMult,
  );
  const chaosDiv = boss === 'uber'
    ? ENEMY_CONSTANTS.CHAOS_DAMAGE_DIVISOR_UBER
    : ENEMY_CONSTANTS.CHAOS_DAMAGE_DIVISOR;
  const armourMult = opts.armourMult ?? 1;
  const evasionMult = opts.evasionMult ?? 1;
  return {
    level: lvl,
    boss,
    damage,
    chaosDamage: Math.round(damage / chaosDiv),
    armour: Math.round(base.armour * armourMult),
    evasion: Math.round(base.evasion * evasionMult),
    elementalResist: boss === 'none' ? 0 : ENEMY_CONSTANTS.BOSS_ELEMENTAL_RES[boss],
    chaosResist: 0,
    elementalPenetration: boss === 'none' ? 0 : ENEMY_CONSTANTS.BOSS_PEN[boss],
    physicalOverwhelm: 0,
    speed: ENEMY_CONSTANTS.ENEMY_SPEED,
    critChance: ENEMY_CONSTANTS.ENEMY_CRIT_CHANCE,
    critMultiplier: ENEMY_CONSTANTS.ENEMY_CRIT_MULTIPLIER,
    poiseMultiplier: poiseMultiplier(boss),
    life: monsterLifeTable[Math.min(tableLvl, ENEMY_CONSTANTS.TABLE_MAX_LEVEL) - 1]!,
    poiseThreshold: Math.round(base.poiseThreshold * poiseMultiplier(boss)),
  };
}
