/**
 * Базовые ресурсные пулы PoE2: life / mana / ES / реген маны — БЕЗ движка PoB.
 *
 * Канон — PoB2 (не Hivemind! найдены расхождения, см. ниже):
 *   - Life:  12 per level + 16   (CalcSetup.lua:954: `Multiplier var="Level" base=16`;
 *            семантика ModStore.lua:442 — value×mult + base; 12/ур. — Misc.lua:156)
 *   - Mana:  4 per level + 30    (CalcSetup.lua:955)
 *   - MANA REGEN: 4%/с от макс. маны (240%/мин, Misc.lua:147 → Data.lua:263: /60/100)
 *   - ES:    базового ES от уровня/атрибутов НЕТ — только gear/tree/passives
 *   - PoE2: атрибуты НЕ дают life/mana (в PoE1 давали; в CalcSetup.lua нет соответствующих PerStat-модов)
 *   - Итог = (база + flat) × (1 + Σ increased%) × Π(1 + more), floor (как PoB CalcDefence)
 *
 * ⚠️ Расхождения с Hivemind resource_calculator.py (отвергнуты, проверено по исходникам PoB2):
 *   - Hivemind: life = 28 + 12·level + 2·str  → пер-стр life и сдвиг на 12 (PoE1-legacy)
 *   - Hivemind: mana = 34 + 4·level + 2·int    → пер-инт mana и сдвиг на 4
 *
 * Эмпирическая валидация: снапшот Pandaren lvl27/Str12 → Life 517 ≥ base 340 (delta — gear/tree).
 */

/** Константы пулов PoE2 (источник: Misc.lua, CalcSetup.lua). */
export const RESOURCE_CONSTANTS = {
  /** Life за уровень (Misc.lua:156 life_per_level). */
  LIFE_PER_LEVEL: 12,
  /** Базовый life-оффсет (CalcSetup.lua:954, base=16): baseLife = 12·level + 16. */
  LIFE_LEVEL_BASE: 16,
  /** Mana за уровень (Misc.lua:157 mana_per_level). */
  MANA_PER_LEVEL: 4,
  /** Базовый mana-оффсет (CalcSetup.lua:955, base=30): baseMana = 4·level + 30. */
  MANA_LEVEL_BASE: 30,
  /** Реген маны: доля макс. маны в секунду (240%/мин → 0.04). */
  MANA_REGEN_PER_SEC: 0.04,
  /** Максимальный уровень персонажа PoE2. */
  MAX_LEVEL: 100,
} as const;

/** Модификаторы пула: flat / increased% / more-множители (как в PoB). */
export interface PoolModifiers {
  /** Плоские прибавки (gear/tree/gems), суммируются с базой. */
  flat?: number;
  /** Increased % — суммируются, применяются до more. */
  increasedPercent?: number;
  /** More-множители — перемножаются как (1 + more). */
  moreMultipliers?: number[];
}

/** Собрать модификаторы в итог: (base + flat) × (1 + Σinc%) × Π(1 + more). */
function applyPoolMods(base: number, mods: PoolModifiers = {}): number {
  const flat = base + (mods.flat ?? 0);
  const inc = flat * (1 + (mods.increasedPercent ?? 0) / 100);
  let out = inc;
  for (const m of mods.moreMultipliers ?? []) out *= 1 + m;
  return out;
}

/** Привести уровень к допустимому диапазону PoE2 (1..100). */
function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(RESOURCE_CONSTANTS.MAX_LEVEL, Math.max(1, Math.floor(level)));
}

/**
 * Максимальный life PoE2.
 * База: 12·level + 16 (PoB2). Атрибуты life НЕ дают.
 * Итог округляется вниз (PoB: floor, аналогично CalcDefence для пула).
 */
export function maxLife(level: number, mods: PoolModifiers = {}): number {
  const lvl = clampLevel(level);
  const base =
    RESOURCE_CONSTANTS.LIFE_PER_LEVEL * lvl + RESOURCE_CONSTANTS.LIFE_LEVEL_BASE;
  return Math.floor(applyPoolMods(base, mods));
}

/**
 * Максимальная мана PoE2.
 * База: 4·level + 30 (PoB2). Атрибуты mana НЕ дают.
 * Итог округляется вниз.
 */
export function maxMana(level: number, mods: PoolModifiers = {}): number {
  const lvl = clampLevel(level);
  const base =
    RESOURCE_CONSTANTS.MANA_PER_LEVEL * lvl + RESOURCE_CONSTANTS.MANA_LEVEL_BASE;
  return Math.floor(applyPoolMods(base, mods));
}

/**
 * Реген маны в секунду: 4%/с от макс. маны (PoE2 inherent, Misc.lua:147).
 * increased % — аддитивные бонусы регена; flat — плоский реген/с.
 */
export function manaRegenPerSec(
  maximumMana: number,
  increasedRegenPercent = 0,
  flatRegenPerSec = 0,
): number {
  const base = maximumMana * RESOURCE_CONSTANTS.MANA_REGEN_PER_SEC;
  return base * (1 + increasedRegenPercent / 100) + flatRegenPerSec;
}

/**
 * Максимальный ES PoE2: базового ES от уровня НЕТ — только gear/tree/пассивы.
 * Функция сводится к применению модификаторов к базе (обычно 0 + flat от gear).
 */
export function maxEnergyShield(mods: PoolModifiers = {}): number {
  return Math.floor(applyPoolMods(0, mods));
}
