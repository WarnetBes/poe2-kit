/**
 * Калькулятор станов Path of Exile 2.
 *
 * TS-порт hivemind-poe2-mcp (src/calculator/stun_calculator.py;
 * автор оригинала — HivemindOverlord/poe2-mcp).
 *
 * Механики PoE2:
 *  - Light Stun: шанс = (урон / макс. HP цели) * 100, x1.5 физ, x1.5 мили;
 *    станит, если шанс >= 15% (минимальный порог);
 *  - Heavy Stun: билдап-метр до 100% (макс. HP цели), стан 3с;
 *    Primed (50-99%) + Light Stun = Crushing Blow.
 */

export const STUN_CONSTANTS = {
  LIGHT_STUN_MINIMUM_THRESHOLD: 15,
  PHYSICAL_DAMAGE_BONUS: 1.5,
  MELEE_ATTACK_BONUS: 1.5,
  PRIMED_STATE_THRESHOLD: 50,
  HEAVY_STUN_THRESHOLD: 100,
  HEAVY_STUN_DURATION: 3,
} as const;

export type StunDamageType = 'physical' | 'fire' | 'cold' | 'lightning' | 'chaos';
export type StunAttackType = 'melee' | 'ranged' | 'spell';

export interface StunModifiers {
  /** Increased stun chance, % (аддитивно). */
  increasedStunChance?: number;
  /** More stun chance (мультипликативно, 1.5 = +50% more). */
  moreStunChance?: number;
  /** Increased stun threshold, % (1.25 = +25% threshold). */
  increasedStunThreshold?: number;
  /** Reduced stun threshold (0.8 = -20% threshold). */
  reducedStunThreshold?: number;
  /** Множитель билдапа Heavy Stun. */
  stunBuildupMultiplier?: number;
  /** Минимальный шанс Light Stun (%), по умолчанию 15. */
  minimumStunChance?: number;
  immuneToStun?: boolean;
}

export interface LightStunResult {
  baseChance: number;
  damageTypeBonus: number;
  attackTypeBonus: number;
  finalChance: number;
  willStun: boolean;
}

/**
 * Шанс Light Stun от удара. Станит только если итоговый шанс
 * не ниже минимального порога (15%).
 */
export function lightStunChance(
  damage: number,
  targetMaxLife: number,
  damageType: StunDamageType,
  attackType: StunAttackType,
  mods: StunModifiers = {},
): LightStunResult {
  if (targetMaxLife <= 0) throw new Error('Target max life must be positive');
  const baseChance = (damage / targetMaxLife) * 100;
  if (mods.immuneToStun) {
    return { baseChance, damageTypeBonus: 1, attackTypeBonus: 1, finalChance: 0, willStun: false };
  }
  const typeBonus = damageType === 'physical' ? STUN_CONSTANTS.PHYSICAL_DAMAGE_BONUS : 1;
  const atkBonus = attackType === 'melee' ? STUN_CONSTANTS.MELEE_ATTACK_BONUS : 1;

  let chance = baseChance * typeBonus * atkBonus;
  chance *= 1 + (mods.increasedStunChance ?? 0) / 100;
  chance *= mods.moreStunChance ?? 1;
  const thresholdMult = (mods.increasedStunThreshold ?? 1) * (mods.reducedStunThreshold ?? 1);
  if (thresholdMult !== 1) chance /= thresholdMult;
  const final = Math.min(chance, 100);
  const min = mods.minimumStunChance ?? STUN_CONSTANTS.LIGHT_STUN_MINIMUM_THRESHOLD;
  const willStun = final >= min;
  return {
    baseChance,
    damageTypeBonus: typeBonus,
    attackTypeBonus: atkBonus,
    finalChance: willStun ? final : 0,
    willStun,
  };
}

/**
 * Добавленный Heavy Stun билдап от удара (те же бонусы, что у Light Stun).
 */
export function heavyStunBuildup(
  damage: number,
  damageType: StunDamageType,
  attackType: StunAttackType,
  mods: StunModifiers = {},
): number {
  if (mods.immuneToStun) return 0;
  const typeBonus = damageType === 'physical' ? STUN_CONSTANTS.PHYSICAL_DAMAGE_BONUS : 1;
  const atkBonus = attackType === 'melee' ? STUN_CONSTANTS.MELEE_ATTACK_BONUS : 1;
  let buildup = damage * typeBonus * atkBonus;
  buildup *= 1 + (mods.increasedStunChance ?? 0) / 100;
  buildup *= mods.moreStunChance ?? 1;
  buildup *= mods.stunBuildupMultiplier ?? 1;
  const thresholdMult = (mods.increasedStunThreshold ?? 1) * (mods.reducedStunThreshold ?? 1);
  if (thresholdMult !== 1) buildup /= thresholdMult;
  return buildup;
}

export interface HeavyStunMeter {
  entityId: string;
  currentBuildup: number;
  maxBuildup: number;
  percent: number;
  hitsReceived: number;
  primed: boolean;
  heavyStunned: boolean;
}

/**
 * Метр Heavy Stun для сущности: билдап от ударов, 100% → стан 3с,
 * Primed (>= 50%) + Light Stun = Crushing Blow.
 */
export class HeavyStunTracker {
  private meters = new Map<string, HeavyStunMeter>();

  getMeter(entityId = 'default'): HeavyStunMeter | null {
    return this.meters.get(entityId) ?? null;
  }

  /** Применить удар к метру сущности. */
  applyHit(
    damage: number,
    targetMaxLife: number,
    damageType: StunDamageType,
    attackType: StunAttackType,
    entityId = 'default',
    mods: StunModifiers = {},
  ): {
    meter: HeavyStunMeter;
    buildupAdded: number;
    triggeredHeavyStun: boolean;
    triggeredCrushingBlow: boolean;
    hitsToHeavyStun: number;
  } {
    if (targetMaxLife <= 0) throw new Error('Target max life must be positive');
    let meter = this.meters.get(entityId);
    const wasHeavy = meter?.heavyStunned ?? false;
    const wasPrimed = meter?.primed ?? false;
    if (!meter) {
      meter = {
        entityId, currentBuildup: 0, maxBuildup: targetMaxLife, percent: 0,
        hitsReceived: 0, primed: false, heavyStunned: false,
      };
      this.meters.set(entityId, meter);
    }
    if (meter.maxBuildup !== targetMaxLife) {
      meter.maxBuildup = targetMaxLife;
      meter.percent = meter.maxBuildup > 0 ? (meter.currentBuildup / meter.maxBuildup) * 100 : 0;
    }

    // Паритет с Hivemind stun_calculator.py: при immune_к_стану метр
    // НЕ мутирует (early return: без buildup, без hits_received++). Удары
    // по иммунной цели — не «накопление 0», а полное отсутствие эффекта.
    if (mods.immuneToStun) {
      return { meter, buildupAdded: 0, triggeredHeavyStun: false, triggeredCrushingBlow: false, hitsToHeavyStun: Infinity };
    }

    const buildup = heavyStunBuildup(damage, damageType, attackType, mods);
    meter.currentBuildup += buildup;
    meter.hitsReceived += 1;
    meter.percent = (meter.currentBuildup / meter.maxBuildup) * 100;
    meter.primed = meter.percent >= STUN_CONSTANTS.PRIMED_STATE_THRESHOLD && meter.percent < STUN_CONSTANTS.HEAVY_STUN_THRESHOLD;
    meter.heavyStunned = meter.percent >= STUN_CONSTANTS.HEAVY_STUN_THRESHOLD;

    const triggeredHeavyStun = !wasHeavy && meter.heavyStunned;
    // Crushing Blow: цель была primed и этот удар станит (Light Stun).
    const light = lightStunChance(damage, targetMaxLife, damageType, attackType, mods);
    const triggeredCrushingBlow = wasPrimed && light.willStun;

    const remaining = meter.maxBuildup - meter.currentBuildup;
    const hitsToHeavyStun = meter.heavyStunned ? 0 : buildup > 0 && remaining > 0 ? remaining / buildup : Infinity;

    return { meter, buildupAdded: buildup, triggeredHeavyStun, triggeredCrushingBlow, hitsToHeavyStun };
  }

  reset(entityId = 'default'): void {
    this.meters.delete(entityId);
  }

  trackedEntities(): string[] {
    return [...this.meters.keys()];
  }
}

/**
 * Сколько ударов нужно для Light Stun / Heavy Stun.
 * Возвращает { hitsToLightStun, hitsToHeavyStun } (Infinity, если недостижимо).
 */
export function hitsToStun(
  damagePerHit: number,
  targetMaxLife: number,
  damageType: StunDamageType,
  attackType: StunAttackType,
  mods: StunModifiers = {},
): { hitsToLightStun: number; hitsToHeavyStun: number; lightChance: number; buildupPerHit: number } {
  const light = lightStunChance(damagePerHit, targetMaxLife, damageType, attackType, mods);
  const buildup = heavyStunBuildup(damagePerHit, damageType, attackType, mods);
  const hitsToLight = light.willStun ? 1 : Infinity;
  const hitsToHeavy = buildup > 0 ? Math.ceil(targetMaxLife / buildup) : Infinity;
  return { hitsToLightStun: hitsToLight, hitsToHeavyStun: hitsToHeavy, lightChance: light.finalChance, buildupPerHit: buildup };
}
