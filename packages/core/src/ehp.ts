/**
 * Калькуляторы обороны и EHP для Path of Exile 2.
 *
 * TS-порт идей и формул hivemind-poe2-mcp (src/calculator/defense_calculator.py,
 * ehp_calculator.py; автор оригинала — HivemindOverlord/poe2-mcp).
 *
 * Ключевые механики PoE2 (отличаются от PoE1):
 *  - армор снижает физический урон ДО резистов, DR = A / (A + 10*D_raw), кап 90%;
 *  - блок капится на 50% (не 75%);
 *  - хаос снимает ES с коэффициентом 2 (не обходит полностью);
 *  - ES реберзит 12.5%/с после задержки 4с (400/(100+faster_start)%).
 */

// ─── Константы PoE2 ────────────────────────────────────────────────────────

export const DEFENSE_CONSTANTS = {
  ARMOR_MAX_DR: 90,
  ARMOR_MULTIPLIER: 10,
  EVASION_MIN_HIT_CHANCE: 5,
  EVASION_MAX_HIT_CHANCE: 100,
  EVASION_ACCURACY_MULTIPLIER: 1.25,
  EVASION_DIVISOR: 0.3,
  ES_BASE_RECHARGE_RATE: 12.5,
  ES_BASE_DELAY: 4,
  ES_DELAY_BASE_VALUE: 400,
  ES_DELAY_DIVISOR_BASE: 100,
  RESISTANCE_DEFAULT_CAP: 75,
  RESISTANCE_HARD_CAP: 90,
  RESISTANCE_MIN: -200,
  BLOCK_MAX_CHANCE: 50,
} as const;

export type DamageType = 'physical' | 'fire' | 'cold' | 'lightning' | 'chaos';
export const DAMAGE_TYPES: DamageType[] = ['physical', 'fire', 'cold', 'lightning', 'chaos'];

// ─── Входные данные ────────────────────────────────────────────────────────

export interface DefensiveStats {
  life: number;
  energyShield?: number;
  armor?: number;
  evasion?: number;
  blockChance?: number;
  fireRes?: number;
  coldRes?: number;
  lightningRes?: number;
  chaosRes?: number;
}

export interface ThreatProfile {
  /** Ожидаемый размер сырого удара (влияет на эффективность армора). */
  expectedHitSize?: number;
  /** Точность атакующего (влияет на уклонение). */
  attackerAccuracy?: number;
}

export const DEFAULT_THREAT: Required<ThreatProfile> = {
  expectedHitSize: 1000,
  attackerAccuracy: 2000,
};

// ─── Формулы обороны ─────────────────────────────────────────────────────

export interface ArmorResult {
  armor: number;
  rawDamage: number;
  drPercent: number;
  effectiveDamage: number;
  isCapped: boolean;
}

/** DR армора PoE2: DR = A / (A + 10*D_raw), кап 90%. */
export function armorDr(armor: number, rawDamage: number): ArmorResult {
  const a = Math.max(0, armor);
  const dr = a > 0 && rawDamage > 0 ? (a / (a + DEFENSE_CONSTANTS.ARMOR_MULTIPLIER * rawDamage)) * 100 : 0;
  const capped = dr > DEFENSE_CONSTANTS.ARMOR_MAX_DR;
  const drPercent = Math.min(dr, DEFENSE_CONSTANTS.ARMOR_MAX_DR);
  return {
    armor: a,
    rawDamage,
    drPercent,
    effectiveDamage: rawDamage * (1 - drPercent / 100),
    isCapped: capped,
  };
}

/** Сколько армора нужно для целевого DR против удара rawDamage: A = (DR*10*D)/(1-DR). */
export function armorNeededForDr(targetDrPercent: number, rawDamage: number): number {
  if (targetDrPercent <= 0 || rawDamage <= 0) return 0;
  const dr = Math.min(targetDrPercent, DEFENSE_CONSTANTS.ARMOR_MAX_DR - 0.01) / 100;
  return (dr * DEFENSE_CONSTANTS.ARMOR_MULTIPLIER * rawDamage) / (1 - dr);
}

export interface EvasionResult {
  evasion: number;
  accuracy: number;
  hitChancePercent: number;
  evadeChancePercent: number;
  isCapped: boolean;
}

/** Уклонение PoE2: Hit = (Acc*1.25*100)/(Acc + Eva*0.3), капы 5..100. */
export function evasionChance(evasion: number, attackerAccuracy: number): EvasionResult {
  const eva = Math.max(0, evasion);
  const acc = Math.max(0, attackerAccuracy);
  if (acc === 0) {
    return { evasion: eva, accuracy: acc, hitChancePercent: 0, evadeChancePercent: 100, isCapped: false };
  }
  const raw = (acc * DEFENSE_CONSTANTS.EVASION_ACCURACY_MULTIPLIER * 100) / (acc + eva * DEFENSE_CONSTANTS.EVASION_DIVISOR);
  const hit = Math.min(Math.max(raw, DEFENSE_CONSTANTS.EVASION_MIN_HIT_CHANCE), DEFENSE_CONSTANTS.EVASION_MAX_HIT_CHANCE);
  return {
    evasion: eva,
    accuracy: acc,
    hitChancePercent: hit,
    evadeChancePercent: 100 - hit,
    isCapped: raw !== hit,
  };
}

export interface EsRechargeResult {
  maxEs: number;
  rechargeRatePercent: number;
  rechargePerSecond: number;
  delaySeconds: number;
  timeToFullSeconds: number;
}

/** Реберз ES PoE2: 12.5%/с база, задержка 400/(100+fasterStart)%. */
export function esRecharge(
  maxEs: number,
  increasedRechargeRatePercent = 0,
  fasterStartPercent = 0,
): EsRechargeResult {
  const es = Math.max(0, maxEs);
  const ratePercent = DEFENSE_CONSTANTS.ES_BASE_RECHARGE_RATE * (1 + increasedRechargeRatePercent / 100);
  const perSecond = es * (ratePercent / 100);
  const divisor = DEFENSE_CONSTANTS.ES_DELAY_DIVISOR_BASE + fasterStartPercent;
  const delay = divisor > 0 ? DEFENSE_CONSTANTS.ES_DELAY_BASE_VALUE / divisor : DEFENSE_CONSTANTS.ES_BASE_DELAY;
  return {
    maxEs: es,
    rechargeRatePercent: ratePercent,
    rechargePerSecond: perSecond,
    delaySeconds: delay,
    timeToFullSeconds: perSecond > 0 ? es / perSecond + delay : Infinity,
  };
}

export interface ResistanceResult {
  resistancePercent: number;
  damageTakenMultiplier: number;
  drPercent: number;
  isCapped: boolean;
  isOverCap: boolean;
}

/** Резист: taken = (100-RES)/100; кап по умолчанию 75%, жёсткий 90%. */
export function resistanceDr(
  resistancePercent: number,
  cap = DEFENSE_CONSTANTS.RESISTANCE_DEFAULT_CAP,
): ResistanceResult {
  const effCap = Math.min(cap, DEFENSE_CONSTANTS.RESISTANCE_HARD_CAP);
  const isOverCap = resistancePercent > effCap;
  const effective = Math.max(Math.min(resistancePercent, effCap), DEFENSE_CONSTANTS.RESISTANCE_MIN);
  const taken = (100 - effective) / 100;
  return {
    resistancePercent: effective,
    damageTakenMultiplier: taken,
    drPercent: 100 - taken * 100,
    isCapped: isOverCap,
    isOverCap,
  };
}

export interface BlockResult {
  blockChancePercent: number;
  isCapped: boolean;
}

/** Блок PoE2: кап 50% (не 75%, как в PoE1). */
export function blockChance(blockChancePercent: number): BlockResult {
  const raw = Math.max(0, blockChancePercent);
  const capped = raw > DEFENSE_CONSTANTS.BLOCK_MAX_CHANCE;
  return { blockChancePercent: Math.min(raw, DEFENSE_CONSTANTS.BLOCK_MAX_CHANCE), isCapped: capped };
}

// ─── EHP-калькулятор ──────────────────────────────────────────────────────

export interface EhpResult {
  damageType: DamageType;
  rawHp: number;
  evadeMitigation: number;
  blockMitigation: number;
  armorDr: number;
  resistanceDr: number;
  totalMitigation: number;
  effectiveHp: number;
}

export interface DefenseGap {
  gapType: string;
  severity: number;
  description: string;
  recommendation: string;
  currentValue: number;
  recommendedValue: number;
}

function rawHp(stats: DefensiveStats, damageType: DamageType): number {
  const life = stats.life ?? 0;
  const es = stats.energyShield ?? 0;
  // PoE2: хаос снимает ES с коэффициентом 2.
  return damageType === 'chaos' ? life + es / 2 : life + es;
}

function resValue(stats: DefensiveStats, damageType: DamageType): number {
  switch (damageType) {
    case 'fire': return stats.fireRes ?? 0;
    case 'cold': return stats.coldRes ?? 0;
    case 'lightning': return stats.lightningRes ?? 0;
    case 'chaos': return stats.chaosRes ?? 0;
    default: return 0;
  }
}

/**
 * EHP для конкретного типа урона. Слои (по порядку PoE2):
 * уклонение → блок → армор (физ., до резистов) → резисты → пул HP.
 * EHP = RawHP / (1 - total mitigation).
 */
export function calculateEhp(
  stats: DefensiveStats,
  damageType: DamageType,
  threat: ThreatProfile = {},
): EhpResult {
  const t = { ...DEFAULT_THREAT, ...threat };
  const hp = rawHp(stats, damageType);

  const evade = (stats.evasion ?? 0) > 0 ? evasionChance(stats.evasion!, t.attackerAccuracy).evadeChancePercent / 100 : 0;
  const block = blockChance(stats.blockChance ?? 0).blockChancePercent / 100;
  const aDr = damageType === 'physical' && (stats.armor ?? 0) > 0 && t.expectedHitSize > 0
    ? armorDr(stats.armor!, t.expectedHitSize).drPercent / 100
    : 0;
  const res = resistanceDr(resValue(stats, damageType)).drPercent / 100;

  // Уклонение и блок — «шансы избежать удар»: исключают ВСЁ, включая армор.
  let multiplier = (1 - evade) * (1 - block);
  if (damageType === 'physical') multiplier *= 1 - aDr;
  multiplier *= 1 - res;

  const totalMitigation = 1 - multiplier;
  return {
    damageType,
    rawHp: hp,
    evadeMitigation: evade,
    blockMitigation: block,
    armorDr: aDr,
    resistanceDr: res,
    totalMitigation,
    effectiveHp: multiplier > 0 ? hp / multiplier : Infinity,
  };
}

/** EHP по всем типам урона. */
export function calculateAllEhp(
  stats: DefensiveStats,
  threat: ThreatProfile = {},
): Record<DamageType, EhpResult> {
  const out = {} as Record<DamageType, EhpResult>;
  for (const dt of DAMAGE_TYPES) out[dt] = calculateEhp(stats, dt, threat);
  return out;
}

/** Анализ армора против разных размеров удара (мелкие удары — армор сильнее). */
export function analyzeArmorVsHitSizes(
  stats: DefensiveStats,
  hitSizes: number[] = [500, 1000, 2000, 5000, 10000],
): Array<{ hitSize: number; drPercent: number; effectiveDamage: number; isCapped: boolean; physicalEhp: number }> {
  return hitSizes.map((hitSize) => {
    const ar = armorDr(stats.armor ?? 0, hitSize);
    const ehp = calculateEhp(stats, 'physical', { expectedHitSize: hitSize });
    return {
      hitSize,
      drPercent: ar.drPercent,
      effectiveDamage: ar.effectiveDamage,
      isCapped: ar.isCapped,
      physicalEhp: ehp.effectiveHp,
    };
  });
}

/** Сколько армора нужно для целевых DR (против удара 1000 по умолчанию). */
export function findArmorBreakpoints(
  hitSize = DEFAULT_THREAT.expectedHitSize,
  targets: number[] = [25, 50, 75, 85, 90],
): Array<{ targetDr: number; armorNeeded: number }> {
  return targets.map((targetDr) => ({
    targetDr,
    armorNeeded: targetDr >= DEFENSE_CONSTANTS.ARMOR_MAX_DR ? Infinity : armorNeededForDr(targetDr, hitSize),
  }));
}

/** Слабые места обороны с рекомендациями (сортировка по severity). */
export function identifyDefenseGaps(stats: DefensiveStats, threat: ThreatProfile = {}): DefenseGap[] {
  const t = { ...DEFAULT_THREAT, ...threat };
  const gaps: DefenseGap[] = [];

  const resists: Array<[string, number]> = [
    ['fire', stats.fireRes ?? 0],
    ['cold', stats.coldRes ?? 0],
    ['lightning', stats.lightningRes ?? 0],
    ['chaos', stats.chaosRes ?? 0],
  ];
  for (const [name, value] of resists) {
    const cap = DEFENSE_CONSTANTS.RESISTANCE_DEFAULT_CAP;
    if (value < cap) {
      const deficit = cap - value;
      let severity = Math.min(10, deficit / 10);
      if (name === 'chaos') severity *= 0.5;
      gaps.push({
        gapType: `uncapped_${name}_resistance`,
        severity,
        description: `${name} resistance на ${deficit.toFixed(0)}% ниже капа`,
        recommendation: `Поднять ${name} resistance на ${deficit.toFixed(0)}% до капа ${cap}%`,
        currentValue: value,
        recommendedValue: cap,
      });
    }
  }

  const totalHp = (stats.life ?? 0) + (stats.energyShield ?? 0);
  const minHp = 3000;
  if (totalHp < minHp) {
    gaps.push({
      gapType: 'low_hp_pool',
      severity: Math.min(10, (minHp - totalHp) / 500),
      description: `Пул HP (${totalHp.toFixed(0)}) ниже рекомендованного минимума (${minHp})`,
      recommendation: `Добавить ${(minHp - totalHp).toFixed(0)} life/ES суммарно`,
      currentValue: totalHp,
      recommendedValue: minHp,
    });
  }

  const layers = [
    (stats.armor ?? 0) >= 5000,
    (stats.evasion ?? 0) >= 3000,
    (stats.blockChance ?? 0) >= 20,
    (stats.energyShield ?? 0) >= 500,
  ].filter(Boolean).length;
  if (layers === 0) {
    gaps.push({
      gapType: 'no_layered_defenses',
      severity: 8,
      description: 'Нет слоёв обороны, кроме резистов и HP',
      recommendation: 'Взять хотя бы один слой: армор, уклонение, блок или ES',
      currentValue: 0,
      recommendedValue: 1,
    });
  } else if (layers === 1) {
    gaps.push({
      gapType: 'single_defense_layer',
      severity: 4,
      description: 'Только один слой обороны',
      recommendation: 'Добавить второй слой обороны для выживаемости',
      currentValue: 1,
      recommendedValue: 2,
    });
  }

  if ((stats.blockChance ?? 0) > DEFENSE_CONSTANTS.BLOCK_MAX_CHANCE) {
    const waste = stats.blockChance! - DEFENSE_CONSTANTS.BLOCK_MAX_CHANCE;
    gaps.push({
      gapType: 'overcapped_block',
      severity: Math.min(5, waste / 10),
      description: `Блок (${stats.blockChance!.toFixed(0)}%) выше капа (${DEFENSE_CONSTANTS.BLOCK_MAX_CHANCE}%), впустую ${waste.toFixed(0)}%`,
      recommendation: `Перераспределить ${waste.toFixed(0)}% блока в другие обороны`,
      currentValue: stats.blockChance!,
      recommendedValue: DEFENSE_CONSTANTS.BLOCK_MAX_CHANCE,
    });
  }

  if ((stats.armor ?? 0) > 0) {
    const largeHit = armorDr(stats.armor!, 5000);
    if (largeHit.drPercent < 30) {
      gaps.push({
        gapType: 'armor_ineffective_vs_large_hits',
        severity: 5,
        description: `Армор даёт лишь ${largeHit.drPercent.toFixed(1)}% DR против больших ударов (5000)`,
        recommendation: 'Дополнить армор другими оборонами от ваншотов',
        currentValue: largeHit.drPercent,
        recommendedValue: 50,
      });
    }
  }

  if ((stats.chaosRes ?? 0) < 0) {
    gaps.push({
      gapType: 'negative_chaos_resistance',
      severity: Math.min(6, Math.abs(stats.chaosRes!) / 20),
      description: `Отрицательный chaos res (${stats.chaosRes!.toFixed(0)}%) усиливает хаос-урон`,
      recommendation: `Поднять chaos res на ${Math.abs(stats.chaosRes!).toFixed(0)}% минимум до 0`,
      currentValue: stats.chaosRes!,
      recommendedValue: 0,
    });
  }

  if ((stats.evasion ?? 0) > 0) {
    const ev = evasionChance(stats.evasion!, t.attackerAccuracy).evadeChancePercent;
    if (ev < 30) {
      gaps.push({
        gapType: 'low_evasion_effectiveness',
        severity: 3,
        description: `Уклонение даёт лишь ${ev.toFixed(1)}% уклона против ожидаемой точности`,
        recommendation: 'Поднять evasion rating или выбрать другую оборону',
        currentValue: ev,
        recommendedValue: 50,
      });
    }
  }

  return gaps.sort((a, b) => b.severity - a.severity);
}

export interface UpgradeComparison {
  current: Record<DamageType, number>;
  upgraded: Record<DamageType, number>;
  gain: Record<DamageType, { absolute: number; percent: number }>;
  averagePercentGain: number;
  worstDamageType: DamageType;
  bestDamageType: DamageType;
}

/** Сравнение EHP до/после апгрейда по всем типам урона. */
export function compareEhpUpgrade(
  current: DefensiveStats,
  upgraded: DefensiveStats,
  threat: ThreatProfile = {},
): UpgradeComparison {
  const before = calculateAllEhp(current, threat);
  const after = calculateAllEhp(upgraded, threat);
  const gain = {} as UpgradeComparison['gain'];
  const cur = {} as UpgradeComparison['current'];
  const upg = {} as UpgradeComparison['upgraded'];
  let sum = 0;
  for (const dt of DAMAGE_TYPES) {
    const absoluteGain = after[dt].effectiveHp - before[dt].effectiveHp;
    const percentGain = before[dt].effectiveHp > 0 ? (absoluteGain / before[dt].effectiveHp) * 100 : absoluteGain > 0 ? Infinity : 0;
    gain[dt] = { absolute: absoluteGain, percent: percentGain };
    cur[dt] = before[dt].effectiveHp;
    upg[dt] = after[dt].effectiveHp;
    if (Number.isFinite(percentGain)) sum += percentGain;
  }
  const worst = DAMAGE_TYPES.reduce((a, b) => (upg[a] <= upg[b] ? a : b));
  const best = DAMAGE_TYPES.reduce((a, b) => (upg[a] >= upg[b] ? a : b));
  return {
    current: cur,
    upgraded: upg,
    gain,
    averagePercentGain: sum / DAMAGE_TYPES.length,
    worstDamageType: worst,
    bestDamageType: best,
  };
}

/** Быстрый физический EHP. */
export function quickPhysicalEhp(life: number, armor: number, block = 0, hitSize = 1000): number {
  return calculateEhp({ life, armor, blockChance: block }, 'physical', { expectedHitSize: hitSize }).effectiveHp;
}

/** Быстрый элем-эл EHP. */
export function quickElementalEhp(life: number, resistance: number, block = 0): number {
  return calculateEhp({ life, fireRes: resistance, blockChance: block }, 'fire').effectiveHp;
}
