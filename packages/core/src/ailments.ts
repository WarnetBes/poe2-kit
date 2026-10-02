/**
 * Айлменты PoE2: DoT (Bleed/Poison/Ignite) и buildup-механики
 * (Heavy Stun, Freeze, Electrocute, Pin), шанс айлментов.
 *
 * Канон: PathOfBuilding-PoE2 (HEAD ce566ea):
 *  - Data.lua:259-267 — BleedPercentBase=0.15/5с, Poison=0.2/2с,
 *    Ignite=0.2/4с (из BleedingHitDamagePercentPerMinute и т.д., Misc.lua:87-97: 900/1200/1200),
 *    DotDpsCap = (2^31-1)/60 = 35791394;
 *  - CalcOffence.lua:5354-5405 — формула DoT-DPS айлмента;
 *  - CalcOffence.lua:5569-5582 — buildup: DamageScale / enemyPoiseThreshold × (1+inc) × more;
 *    DamageScale (Misc.lua:49-66): HeavyStun 0.58, Freeze 2.1, Electrocute 1.7, Pin 4.2;
 *  - CalcOffence.lua:5614-5624 — шанс айлмента: hitDmg/threshold × ChanceMultiplier + base;
 *    ChanceMultiplier (Misc.lua:72-74): Shock 25, Ignite 20, прочие 25;
 *  - CalcOffence.lua:5550-5552 — Chill: threshold = EnemyAilmentThreshold / ChillEffectMultiplier(100);
 *    кап эффекта 50% (Misc.lua:78), Chill default/min 30 (Data.lua:415);
 *  - CalcOffence.lua:5678-5683 — Shock (hit-based): effect = 50·(dmg/threshold)^0.4,
 *    ramping, min = BaseShockMagnitude 20 (Misc.lua:75, Data.lua:417), max 100.
 *
 * Attribution: adapted from Path of Building PoE2 (MIT © David Gowor),
 * https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2
 */

export const AILMENT_CONSTANTS = {
  // ── DoT-базы (Data.lua:259-267; проценты удара В СЕКУНДУ) ──
  BLEED_PERCENT_BASE: 0.15,
  BLEED_DURATION_BASE: 5,
  POISON_PERCENT_BASE: 0.2,
  POISON_DURATION_BASE: 2,
  IGNITE_PERCENT_BASE: 0.2,
  IGNITE_DURATION_BASE: 4,
  DOT_DPS_CAP: 35791394,
  // ── Шанс айлмента (Misc.lua:72-74) ──
  SHOCK_CHANCE_MULTIPLIER: 25,
  IGNITE_CHANCE_MULTIPLIER: 20,
  MISC_AILMENT_CHANCE_MULTIPLIER: 25,
  // ── Chill / Shock (Misc.lua:75-78; Data.lua:415-418) ──
  BASE_SHOCK_MAGNITUDE: 20,
  SHOCK_MAX_EFFECT: 100,
  CHILL_EFFECT_MULTIPLIER: 100,
  CHILL_MIN_EFFECT: 30,
  CHILL_MAX_EFFECT: 50,
  // ── Buildup-механики (Misc.lua:49-66) ──
  HEAVY_STUN_DAMAGE_SCALE: 0.58,
  HEAVY_STUN_THRESHOLD_MODIFIER: 500,
  FREEZE_DAMAGE_SCALE: 2.1,
  FREEZE_THRESHOLD_MODIFIER: 500,
  ELECTROCUTE_DAMAGE_SCALE: 1.7,
  ELECTROCUTE_THRESHOLD_MODIFIER: 500,
  PIN_DAMAGE_SCALE: 4.2,
  PIN_THRESHOLD_MODIFIER: 500,
  // ── Длительности состояний (Misc.lua:38-66, 94-97) ──
  HEAVY_STUN_DURATION_PLAYER_MS: 3000,
  HEAVY_STUN_DURATION_MONSTER_MS: 2000,
  FREEZE_DURATION_PLAYER: 2,
  FREEZE_DURATION_MONSTER: 4,
  ELECTROCUTE_DURATION_PLAYER_MS: 2000,
  ELECTROCUTE_DURATION_MONSTER_MS: 5000,
  PIN_DURATION_PLAYER: 2,
  PIN_DURATION_MONSTER: 3,
  POISE_DECAY_DELAY_PLAYER_MS: 2000,
  POISE_DECAY_PLAYER_PCT_PER_SECOND: 50,
  POISE_DECAY_DELAY_MONSTER_MS: 8000,
  POISE_DECAY_MONSTER_PCT_PER_SECOND: 5,
} as const;

// ─── DoT-айлменты ───────────────────────────────────────────────────────────

export type DotsAilment = 'bleed' | 'poison' | 'ignite';

export const DOT_BASES: Record<DotsAilment, { percentPerSecond: number; durationSeconds: number }> = {
  bleed: { percentPerSecond: AILMENT_CONSTANTS.BLEED_PERCENT_BASE, durationSeconds: AILMENT_CONSTANTS.BLEED_DURATION_BASE },
  poison: { percentPerSecond: AILMENT_CONSTANTS.POISON_PERCENT_BASE, durationSeconds: AILMENT_CONSTANTS.POISON_DURATION_BASE },
  ignite: { percentPerSecond: AILMENT_CONSTANTS.IGNITE_PERCENT_BASE, durationSeconds: AILMENT_CONSTANTS.IGNITE_DURATION_BASE },
};

export interface AilmentDotInput {
  /** Средний немитигированный урон удара-источника (с взвешиванием по криту). */
  hitDamage: number;
  ailment: DotsAilment;
  /** Множитель magnitude (ignites: 20% → множитель 1.2 для «30% stronger» и т.п.). */
  magnitudeMultiplier?: number;
  /** Increased ailment effect, % (аддитивно). */
  increasedAilmentEffectPercent?: number;
  /** Increased DoT rate, % (аддитивно). */
  increasedRatePercent?: number;
  /** More DoT rate (мультипликативно, 1.5 = +50% more). */
  moreRateMultiplier?: number;
  /** Число стаков (poison стакается; кап определяется модами, не константой). */
  stacks?: number;
  /** Резист цели к урону айлмента, %. */
  targetResistPercent?: number;
  /** Increased damage taken целью, %. */
  targetIncreasedTakenPercent?: number;
  /** More damage taken целью (мультипликативно, 0.7 = 30% less). */
  targetMoreTakenMultiplier?: number;
}

export interface AilmentDotResult {
  damagePerSecond: number;
  capped: boolean;
  durationSeconds: number;
  stacks: number;
  /** Урон за всю длительность (DPS × duration). */
  totalDamage: number;
}

/**
 * DoT-DPS айлмента (CalcOffence.lua:5354-5405):
 *   DPS = hitDmg × PercentBase × magnitude × (1+ailmentEffectInc/100)
 *         × (1+rateInc/100) × moreRate × stacks
 *         × (1−resist/100) × (1+incTaken/100) × moreTaken,  кап DotDpsCap.
 * Длительность = base / (1+rateInc/100) / moreRate (CalcOffence.lua:5244-5248).
 */
export function ailmentDotDps(input: AilmentDotInput): AilmentDotResult {
  const base = DOT_BASES[input.ailment];
  const incEffect = 1 + (input.increasedAilmentEffectPercent ?? 0) / 100;
  const incRate = 1 + (input.increasedRatePercent ?? 0) / 100;
  const moreRate = input.moreRateMultiplier ?? 1;
  const stacks = Math.max(1, input.stacks ?? 1);

  let dps =
    input.hitDamage *
    base.percentPerSecond *
    (input.magnitudeMultiplier ?? 1) *
    incEffect *
    incRate *
    moreRate *
    stacks *
    (1 - (input.targetResistPercent ?? 0) / 100) *
    (1 + (input.targetIncreasedTakenPercent ?? 0) / 100) *
    (input.targetMoreTakenMultiplier ?? 1);

  const capped = dps > AILMENT_CONSTANTS.DOT_DPS_CAP;
  if (capped) dps = AILMENT_CONSTANTS.DOT_DPS_CAP;
  const duration = base.durationSeconds / incRate / moreRate;
  return { damagePerSecond: dps, capped, durationSeconds: duration, stacks, totalDamage: dps * duration };
}

// ─── Buildup-механики ───────────────────────────────────────────────────────

export type BuildupType = 'heavyStun' | 'freeze' | 'electrocute' | 'pin';

export const BUILDUP_SCALES: Record<BuildupType, number> = {
  heavyStun: AILMENT_CONSTANTS.HEAVY_STUN_DAMAGE_SCALE,
  freeze: AILMENT_CONSTANTS.FREEZE_DAMAGE_SCALE,
  electrocute: AILMENT_CONSTANTS.ELECTROCUTE_DAMAGE_SCALE,
  pin: AILMENT_CONSTANTS.PIN_DAMAGE_SCALE,
};

export interface BuildupInput {
  /** Урон удара (тот, что масштабируется DamageScale). */
  hitDamage: number;
  type: BuildupType;
  /** Порог poise ЦЕЛИ С УЧЁТОМ босс-модов (см. enemy.poiseMultiplier). */
  enemyPoiseThreshold: number;
  /** Increased buildup, % (аддитивно). */
  increasedPercent?: number;
  /** More buildup (мультипликативно, 1.3 = +30% more). */
  moreMultiplier?: number;
}

export interface BuildupResult {
  /** Проценты метра, добавляемые за удар (0..100+, >100 = состояние накладывается). */
  buildupPercentPerHit: number;
  /** Ударов до срабатывания состояния (ceil). */
  hitsToTrigger: number;
  damageScale: number;
}

/**
 * Накопление buildup-состояния за удар (CalcOffence.lua:5569-5582):
 *   buildup% = DamageScale × hitDamage / enemyPoiseThreshold × (1+inc/100) × more.
 * Порог enemyPoiseThreshold = monsterPoiseThresholdTable[lvl] × PoiseThreshold-моды
 * (у боссов см. poiseMultiplier: Boss ×18.78, Pinnacle/Uber ×56.28).
 */
export function buildupPerHit(input: BuildupInput): BuildupResult {
  if (input.enemyPoiseThreshold <= 0) {
    return { buildupPercentPerHit: Infinity, hitsToTrigger: 1, damageScale: BUILDUP_SCALES[input.type] };
  }
  const scale = BUILDUP_SCALES[input.type];
  const pct =
    ((scale * input.hitDamage) / input.enemyPoiseThreshold) *
    (1 + (input.increasedPercent ?? 0) / 100) *
    (input.moreMultiplier ?? 1) *
    100;
  return {
    buildupPercentPerHit: pct,
    hitsToTrigger: pct > 0 ? Math.ceil(100 / pct) : Infinity,
    damageScale: scale,
  };
}

// ─── Шанс и пороги айлментов ─────────────────────────────────────────────────

export type AilmentChanceType = 'shock' | 'ignite' | 'chill' | 'bleed' | 'poison';

/** Множитель шанса айлмента (Misc.lua:72-74). */
export function ailmentChanceMultiplier(type: AilmentChanceType): number {
  switch (type) {
    case 'shock': return AILMENT_CONSTANTS.SHOCK_CHANCE_MULTIPLIER;
    case 'ignite': return AILMENT_CONSTANTS.IGNITE_CHANCE_MULTIPLIER;
    default: return AILMENT_CONSTANTS.MISC_AILMENT_CHANCE_MULTIPLIER;
  }
}

export interface AilmentChanceResult {
  chancePercent: number;
  /** Порог урона: ниже него айлмент невозможен. */
  minimumHitDamage: number;
  aboveThreshold: boolean;
}

/**
 * Шанс наложить айлмент от удара (CalcOffence.lua:5614-5624):
 *   chance% = (hitDmg / enemyAilmentThreshold × ChanceMultiplier + baseChance)
 *             × (1+inc/100) × more, кап 100.
 * baseChance — плоский шанс мода (напр. «10% chance to Ignite»).
 * hitDmg ниже threshold×20%-ного эквивалента маппится в 0.
 */
export function ailmentChance(args: {
  hitDamage: number;
  enemyAilmentThreshold: number;
  type: AilmentChanceType;
  baseChancePercent?: number;
  increasedChancePercent?: number;
  moreChanceMultiplier?: number;
}): AilmentChanceResult {
  const mult = ailmentChanceMultiplier(args.type);
  const threshold = Math.max(1, args.enemyAilmentThreshold);
  const scaled = (args.hitDamage / threshold) * mult + (args.baseChancePercent ?? 0);
  const chance =
    Math.min(100,
      scaled * (1 + (args.increasedChancePercent ?? 0) / 100) * (args.moreChanceMultiplier ?? 1));
  // Минимальный удар для гарантии 100%: mult×hit/threshold = 100.
  const minHit = (100 / mult) * threshold;
  // Примечание: donor НЕ режет шанс в 0 ниже порога (CalcOffence.lua:5622-5625,
  // только кап сверху 100); aboveThreshold — наша эвристика «удар значим»
  // (scaled-часть ≥ 1), не канон PoB2.
  return { chancePercent: chance, minimumHitDamage: minHit, aboveThreshold: args.hitDamage >= threshold / mult };
}

/**
 * Порог срабатывания Chill: EnemyAilmentThreshold / ChillEffectMultiplier,
 * т.е. /100 (CalcOffence.lua:5550-5551: `enemyThreshold / ChillEffectMultiplier`).
 */
export function chillThreshold(enemyAilmentThreshold: number): number {
  return enemyAilmentThreshold / AILMENT_CONSTANTS.CHILL_EFFECT_MULTIPLIER;
}

/**
 * Эффект Chill от удара (CalcOffence.lua:5672-5675):
 *   effect = ChillEffectMultiplier × (dmg / enemyAilmentThreshold),
 *   кламп [min 30 .. max 50] (Data.lua:415, Misc.lua:78).
 */
export function chillEffect(hitDamage: number, enemyAilmentThreshold: number): number {
  const t = Math.max(1, enemyAilmentThreshold);
  const raw = AILMENT_CONSTANTS.CHILL_EFFECT_MULTIPLIER * (hitDamage / t);
  return Math.min(Math.max(raw, AILMENT_CONSTANTS.CHILL_MIN_EFFECT), AILMENT_CONSTANTS.CHILL_MAX_EFFECT);
}

/**
 * Shock magnitude от удара (CalcOffence.lua:5678-5683, нелинейный «ramping»):
 *   effect = 50 · (dmg в порогах) ^ 0.4, кламп [BaseShockMagnitude 20 .. 100]
 *   (min/max: Data.lua:417, Misc.lua:75).
 */
export function shockMagnitude(hitDamage: number, enemyAilmentThreshold: number): number {
  const t = Math.max(1, enemyAilmentThreshold);
  const raw = 50 * Math.pow(Math.max(0, hitDamage / t), 0.4);
  return Math.min(Math.max(raw, AILMENT_CONSTANTS.BASE_SHOCK_MAGNITUDE), AILMENT_CONSTANTS.SHOCK_MAX_EFFECT);
}
