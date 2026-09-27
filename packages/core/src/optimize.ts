/**
 * Optimize-этап 1: read-only аудит билда (ТЗ docs/SPEC_OPTIMIZE_TOOLS.md).
 *
 * Инварианты ТЗ:
 *  1. Числа — только через канонические модули (ehp/stun/enemy/estimate);
 *     каждое помечено `computed:` (формула/канон) или `estimated:` (эвристика).
 *  2. Сервер — субстрат, не ИИ: отдаём вердикты/дельты, синтез — работа модели.
 *  3. Оптимизация — ограниченный перебор: здесь фиксированные наборы рычагов,
 *     без комбинаторики.
 *
 * НЕ заимствуем (осознанно): headless-LuaJIT движок, support-множители
 * (нет данных — этап 3), passives-роутер (нет графа — этап 3).
 */

import * as ehpmod from './ehp.js';
import * as stunmod from './stun.js';
import * as enemy from './enemy.js';
import type { BuildEstimate, EstimatedDefenses, DamageTypeKind } from './estimate.js';

export const OPTIMIZE_CONSTANTS = {
  /** Кап элем-резистов (data-факт, DEFENSE_CONSTANTS.RESISTANCE_DEFAULT_CAP). */
  RESIST_CAP: ehpmod.DEFENSE_CONSTANTS.RESISTANCE_DEFAULT_CAP,
  /** Рычаг: плоская жизнь одного «среднего» узла/тира предмета (полезная условная единица). */
  LEVER_FLAT_LIFE: 80,
  /** Рычаг: +сумма резистов одной гир-ячейки (типичный ориентир, estimated-единица). */
  LEVER_ELEM_RESIST: 30,
  /** Рычаг: броня/уклонение одной ячейки (тиражный tier, estimated-единица). */
  LEVER_ARMOUR: 500,
  LEVER_EVASION: 300,
  /** Pinnacle: сколько ударов босса должен держать худший EHP (эвристика, НЕ игровые данные). */
  PINNACLE_EHP_HITS: 3,
  /** Pinnacle: сколько ударов до Heavy Stun игрока считаем приемлемым (эвристика). */
  PINNACLE_STUN_HITS: 4,
} as const;

export type GoalVerdict = 'pass' | 'fail' | 'unknown';
export type NumberKind = 'computed' | 'estimated';

/** Вердикт по одной числовой цели. */
export interface GoalCheck {
  metric: string;
  current: number | null;
  goal: number;
  /** Откуда current: computed = PoB PlayerStat/наша формула канона, estimated = геар-эвристика. */
  kind: NumberKind;
  verdict: GoalVerdict;
  /** current − goal (положительный = запас). */
  gap: number | null;
  note?: string;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : null);

export interface BuildGoals {
  dps?: number;
  ehp?: number;
  fireRes?: number;
  coldRes?: number;
  lightningRes?: number;
  chaosRes?: number;
  spiritUnreserved?: number;
}

/**
 * Билд против числовых целей: каждой цели — вердикт + разрыв.
 * Смешанная дисциплина: TotalDPS/TotalEHP из PoB PlayerStat → computed,
 * иначе геар-оценка (оценка оружия, наш EHP-расчёт) → estimated.
 */
export function evaluateBuildAgainstGoals(est: BuildEstimate, goals: BuildGoals): GoalCheck[] {
  const ps = est.pobStats;
  const life = num(ps['Life']);
  const isCI = life !== null && life <= 10;
  const out: GoalCheck[] = [];

  // DPS: PoB TotalDPS — computed; fallback — DPS оружия (estimated).
  const pobDps = num(ps['TotalDPS']);
  if (goals.dps != null) {
    if (pobDps !== null) {
      out.push(goal('dps', pobDps, goals.dps, 'computed', 'PlayerStat TotalDPS из PoB'));
    } else {
      out.push(goal('dps', est.weapon.totalDps > 0 ? est.weapon.totalDps : null, goals.dps, 'estimated',
        'PoB-числа нет; это только DPS оружия, без умений/линков — открой в PoB для точного значения'));
    }
  }

  // EHP: PoB TotalEHP — computed; fallback — худший наш слой (estimated).
  const pobEhp = num(ps['TotalEHP']);
  if (goals.ehp != null) {
    if (pobEhp !== null) {
      out.push(goal('ehp', pobEhp, goals.ehp, 'computed', 'PlayerStat TotalEHP из PoB'));
    } else {
      out.push(goal('ehp', est.worstEhp?.effectiveHp ?? null, goals.ehp, 'estimated',
        'Худший слой нашего послойного расчёта (без PoB)'));
    }
  }

  const resists: Array<[keyof BuildGoals, number]> = [
    ['fireRes', est.defenses.fireRes],
    ['coldRes', est.defenses.coldRes],
    ['lightningRes', est.defenses.lightningRes],
  ];
  for (const [key, value] of resists) {
    const target = goals[key];
    if (target == null) continue;
    out.push(goal(String(key), value, target, 'estimated', 'Сумма резистов из клир-текста гира (без PoB-верификации)'));
  }
  if (goals.chaosRes != null) {
    if (isCI) {
      out.push({ metric: 'chaosRes', current: null, goal: goals.chaosRes, kind: 'computed', verdict: 'pass', gap: null,
        note: 'CI: chaos-иммунитет (Life≤1 в PoB) — хаос-резист не требуется' });
    } else {
      out.push(goal('chaosRes', est.defenses.chaosRes, goals.chaosRes, 'estimated', 'CI не обнаружен'));
    }
  }

  const spirit = num(ps['SpiritUnreserved']);
  if (goals.spiritUnreserved != null) {
    if (spirit !== null) out.push(goal('spiritUnreserved', spirit, goals.spiritUnreserved, 'computed', 'PlayerStat SpiritUnreserved из PoB'));
    else out.push({ metric: 'spiritUnreserved', current: null, goal: goals.spiritUnreserved, kind: 'computed', verdict: 'unknown', gap: null,
      note: 'PlayerStat SpiritUnreserved в экспорте нет — проверить во вкладке Calcs' });
  }

  return out;
}

function goal(metric: string, current: number | null, target: number, kind: NumberKind, note: string): GoalCheck {
  return {
    metric,
    current,
    goal: target,
    kind,
    verdict: current == null ? 'unknown' : current >= target ? 'pass' : 'fail',
    gap: current == null ? null : current - target,
    note,
  };
}

// ─── rank_levers: маржинальный эффект фиксированных рычагов ─────────────────

export interface RankLever {
  lever: string;
  description: string;
  /** Дельта EHP по типам урона (computed: пересчёт канонических формул). */
  deltaEhp: Partial<Record<DamageTypeKind, number>>;
  /** Средний % прироста EHP по 5 типам (computed). */
  avgPercentGain: number;
  /** Дельта DPS-оценки, только для оружейных рычагов (estimated). */
  deltaDpsEstimated: number | null;
  note: string;
}

/** Пересчёт EHP по слоям для изменённых статов (defenses → DefensiveStats). */
function defensesToStats(d: EstimatedDefenses): ehpmod.DefensiveStats {
  return {
    life: d.life,
    energyShield: d.energyShield,
    armor: d.armour,
    evasion: d.evasion,
    blockChance: d.blockChance,
    fireRes: d.fireRes,
    coldRes: d.coldRes,
    lightningRes: d.lightningRes,
    chaosRes: d.chaosRes,
  };
}

const ALL_TYPES: DamageTypeKind[] = ['physical', 'fire', 'cold', 'lightning', 'chaos'];

function avgEhp(stats: ehpmod.DefensiveStats, threat: ehpmod.ThreatProfile): number {
  const all = ehpmod.calculateAllEhp(stats, threat);
  return ALL_TYPES.reduce((s, t) => s + all[t].effectiveHp, 0) / ALL_TYPES.length;
}

/**
 * Ранжирование рычагов по маржинальному эффекту: ΔEHP каждого фиксированного
   рычага пересчитывается каноническими формулами (computed); оружейные рычаги
 * — линейная арифметика поверх DPS оружия (estimated).
 * Ограничение перебора: набор рычагов фиксированный (7 штук), без комбинаций.
 */
export function rankLevers(
  est: BuildEstimate,
  threat: ehpmod.ThreatProfile = { expectedHitSize: 1000, attackerAccuracy: 2000 },
): RankLever[] {
  const base = defensesToStats(est.defenses);
  const baseAvg = avgEhp(base, threat);
  const levers: RankLever[] = [];

  // ΔEHP-рычаги: изменяем один стат, пересчитываем все слои.
  const variants: Array<[string, string, Partial<ehpmod.DefensiveStats>, string]> = [
    [`+${OPTIMIZE_CONSTANTS.LEVER_FLAT_LIFE} flat life`, 'узел/предмет с плоской жизнью', { life: (base.life ?? 0) + OPTIMIZE_CONSTANTS.LEVER_FLAT_LIFE }, 'linear pool'],
    [`+${OPTIMIZE_CONSTANTS.LEVER_ELEM_RESIST}% к каждому элем-резисту`, 'одна гир-ячейка с резистами', {
      fireRes: (base.fireRes ?? 0) + OPTIMIZE_CONSTANTS.LEVER_ELEM_RESIST,
      coldRes: (base.coldRes ?? 0) + OPTIMIZE_CONSTANTS.LEVER_ELEM_RESIST,
      lightningRes: (base.lightningRes ?? 0) + OPTIMIZE_CONSTANTS.LEVER_ELEM_RESIST,
    }, 'resist layers'],
    [`+${OPTIMIZE_CONSTANTS.LEVER_ARMOUR} брони`, 'ячейка с бронёй (влияет только на физ. ДО резистов)', { armor: (base.armor ?? 0) + OPTIMIZE_CONSTANTS.LEVER_ARMOUR }, 'phys only'],
    [`+${OPTIMIZE_CONSTANTS.LEVER_EVASION} уклонения`, 'ячейка с уклонением (через шанс промаха)', { evasion: (base.evasion ?? 0) + OPTIMIZE_CONSTANTS.LEVER_EVASION }, 'hit chance'],
  ];
  for (const [lever, description, patch] of variants) {
    const up = { ...base, ...patch } as ehpmod.DefensiveStats;
    const all = ehpmod.calculateAllEhp(up, threat);
    const delta: Partial<Record<DamageTypeKind, number>> = {};
    const baseAll = ehpmod.calculateAllEhp(base, threat);
    for (const t of ALL_TYPES) delta[t] = all[t].effectiveHp - baseAll[t].effectiveHp;
    const upAvg = avgEhp(up, threat);
    levers.push({
      lever,
      description,
      deltaEhp: delta,
      avgPercentGain: baseAvg > 0 ? ((upAvg - baseAvg) / baseAvg) * 100 : 0,
      deltaDpsEstimated: null,
      note: 'computed: пересчёт канонических слоёв ehp.ts при +одном рычаге',
    });
  }

  // Оружейные рычаги (estimated): линейная арифметика поверх DPS оружия.
  const w = est.weapon;
  if (w && w.totalDps > 0) {
    levers.push({
      lever: '+10% урона оружия (моды базы/qlt)',
      description: 'апгрейд модов/качества оружия',
      deltaEhp: {},
      avgPercentGain: 0,
      deltaDpsEstimated: w.totalDps * 0.1,
      note: 'estimated: линейная оценка поверх DPS оружия; вклад умений в TotalDPS не моделируем',
    });
    levers.push({
      lever: 'замена оружия на x1.25 DPS',
      description: 'следующий tier оружия',
      deltaEhp: {},
      avgPercentGain: 0,
      deltaDpsEstimated: w.totalDps * 0.25,
      note: 'estimated: условный tier-jump — проверить фактический предмет в PoB',
    });
  }

  // support-множители и пассивы-роутер: осознанно НЕ ранжируем (нет данных — этап 3 ТЗ).
  return levers.sort((a, b) => b.avgPercentGain - a.avgPercentGain);
}

// ─── pinnacle_check: чек-лист готовности к эндгейму ─────────────────────────

export interface PinnacleCheck {
  item: string;
  verdict: GoalVerdict;
  detail: string;
  kind: NumberKind;
}

/**
 * Чек-лист готовности к эндгейму против табличных статов врага
 * (enemy.ts, канон PoB2 Misc.lua). Все изменения threat — read-only.
 */
export function pinnacleChecklist(
  est: BuildEstimate,
  opts: { enemyLevel?: number; boss?: enemy.BossMode; ehpHits?: number; stunHits?: number } = {},
): { enemy: enemy.EnemyPlaceholders; checks: PinnacleCheck[] } {
  const level = Math.max(opts.enemyLevel ?? 84, (opts.boss === 'pinnacle' || opts.boss === 'uber') ? 82 : 1);
  const boss: enemy.BossMode = opts.boss ?? 'pinnacle';
  const ph = enemy.enemyPlaceholders(level, boss);

  const ps = est.pobStats;
  const life = num(ps['Life']);
  const isCI = life !== null && life <= 10;
  const pool = (isCI ? (num(ps['EnergyShield']) ?? est.defenses.energyShield) : (num(ps['Life']) ?? est.defenses.life))
    + (!isCI ? est.defenses.energyShield : 0);

  const checks: PinnacleCheck[] = [];

  // 1) Элем-резисты к капу (computed: наши суммы из гира, кап = data-факт).
  for (const [name, v] of [['fire', est.defenses.fireRes], ['cold', est.defenses.coldRes], ['lightning', est.defenses.lightningRes]] as const) {
    checks.push({
      item: `${name} resistance ≥ ${OPTIMIZE_CONSTANTS.RESIST_CAP}%`,
      verdict: v >= OPTIMIZE_CONSTANTS.RESIST_CAP ? 'pass' : 'fail',
      detail: `${v} / ${OPTIMIZE_CONSTANTS.RESIST_CAP} (босс-резисты ${ph.elementalResist}%, пенетрация ${ph.elementalPenetration}%)`,
      kind: 'estimated',
    });
  }

  // 2) Хаос: CI-иммунитет или резист ≥ 0.
  if (isCI) {
    checks.push({ item: 'chaos resistance', verdict: 'pass', detail: `CI: chaos-иммунитет (Life=${life})`, kind: 'computed' });
  } else {
    checks.push({
      item: 'chaos resistance ≥ 0%',
      verdict: est.defenses.chaosRes >= 0 ? 'pass' : 'fail',
      detail: `${est.defenses.chaosRes} (босс-хаос-урон ${ph.chaosDamage})`,
      kind: 'estimated',
    });
  }

  // 3) EHP-порог: худший слой против ударов босса (computed: удар — таблица, требуемый множитель — эвристика).
  const ehpHits = opts.ehpHits ?? OPTIMIZE_CONSTANTS.PINNACLE_EHP_HITS;
  const worst = est.worstEhp?.effectiveHp ?? null;
  const required = (ph.damage ?? 0) * ehpHits;
  if (worst != null && required > 0) {
    checks.push({
      item: `худший EHP ≥ ${ehpHits}× удара босса${boss !== 'none' ? ` (${boss})` : ''}`,
      verdict: worst >= required ? 'pass' : 'fail',
      detail: `computed EHP ${Math.round(worst)} vs required ${Math.round(required)} (удар ${ph.damage}); порог ${ehpHits}× — estimated-эвристика`,
      kind: 'computed',
    });
  } else {
    checks.push({ item: 'EHP-порог', verdict: 'unknown', detail: 'не удалось посчитать худший EHP', kind: 'computed' });
  }

  // 4) Устойчивость к стану: ударов босса до Heavy Stun игрока (computed: формула stun.ts).
  const stunHits = opts.stunHits ?? OPTIMIZE_CONSTANTS.PINNACLE_STUN_HITS;
  if (pool != null && pool > 0 && ph.damage > 0) {
    const ht = stunmod.hitsToStun(ph.damage, pool, 'physical', 'melee');
    const hits = Number.isFinite(ht.hitsToHeavyStun) ? ht.hitsToHeavyStun : Infinity;
    checks.push({
      item: `≥ ${stunHits} ударов босса до Heavy Stun игрока`,
      verdict: hits >= stunHits ? 'pass' : 'fail',
      detail: `computed: ${Number.isFinite(hits) ? hits : '∞'} ударов (билдап ${(ht.buildupPerHit).toFixed(0)}/удар против пула ${Math.round(pool)}); порог ${stunHits} — estimated-эвристика`,
      kind: 'computed',
    });
  } else {
    checks.push({ item: 'устойчивость к стану', verdict: 'unknown', detail: 'пул защиты не определён', kind: 'computed' });
  }

  return { enemy: ph, checks };
}
