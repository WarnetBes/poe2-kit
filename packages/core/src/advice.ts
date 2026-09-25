/**
 * «Следующий апгрейд» по оценке билда (P0-3).
 *
 * `estimate.ts` считает цифры (EHP/DPS/резисты), но не говорит, что чинить
 * ПЕРВЫМ. Здесь — приоритизированный список «чини X → потом Y» на основе:
 *   - слабых мест защиты из `identifyDefenseGaps`;
 *   - специфики CI (ES-пул, chaos-иммунитет из самого PoB);
 *   - бюджета Spirit (впритык / перерасход);
 *   - позиции билда по DPS/EHP относительно топа лeстницы того же класса.
 *
 * Модуль СИНХРОННЫЙ и чистый: лeстничные строки (rows) передаёт вызывающий
 * (MCP-слой качает их заранее). Референс из `rows` строится тут же.
 *
 * Пороговые значения по умолчанию — настраиваемые эвристики (ADVICE_DEFAULTS),
 * НЕ данные игры: заниженные цифры можно поднять явно через opts.
 */

import { compareWithLadderRows, parseNinjaNumber, type LadderRow } from './ladder.js';
import type { BuildEstimate } from './estimate.js';
import type { DefenseGap } from './estimate.js';

// ─── Настраиваемые пороги-эвристики (НЕ игровые данные) ─────────────────────

export const ADVICE_DEFAULTS = {
  /** Кап резистов PoE2 (data-факт, из estimate.DEFENSE_CONSTANTS). */
  RESIST_CAP: 75,
  /** Резист ниже этого значения — блокер (вход в эндгейм-контент смертелен). */
  NEGATIVE_RESIST_BLOCK: 0,
  /** Нижний ES-пул для стабильного CI (настраиваемый ориентир). */
  CI_MIN_ES: 5000,
  /** Нижний HP/ES-пул для не-CI. */
  NON_CI_MIN_POOL: 3000,
  /** Процентиль, ниже которого DPS/EHP считается «просел против меты». */
  LOW_PERCENTILE: 25,
  /** Процентиль «в топе меты». */
  TOP_PERCENTILE: 75,
  /** Нижняя DPS оружия ближнего боя, при которой оружие — бутылочное горлышко. */
  MEELE_LOW_WEAPON_DPS: 2000,
  /** Крит-шанс ниже этого (%, 0..100) для крит-билда — кандидат на прокачку. */
  CRIT_LOW_CHANCE: 40,
  /** Крит-мультипликатор (×) ниже этого — кандидат на прокачку (по умолчанию ×3.5). */
  CRIT_LOW_MULTI: 3.5,
  /** Свободного Spirit меньше этого — «впритык». */
  SPIRIT_TIGHT_BUFFER: 25,
} as const;

export type AdviceArea = 'survivability' | 'damage' | 'weapon' | 'crit' | 'spirit';
export type AdvicePriority = 'blocking' | 'high' | 'medium' | 'low';

/** Один пункт совета с приоритетом. */
export interface BuildAdviceItem {
  priority: AdvicePriority;
  /** 0..10, критичность. */
  severity: number;
  area: AdviceArea;
  title: string;
  detail: string;
  reason: string;
  action: string;
  /** Сравнение с метой/топом, если нашли референс. */
  reference?: string;
}

/** Сверка DPS/EHP билда с пулом лeстницы того же класса. */
export interface BuildReference {
  poolSize: number;
  className: string | null;
  medianDps: number | null;
  topDps: number | null;
  medianEhp: number | null;
  topEhp: number | null;
  dpsPercentile: number | null;
  ehpPercentile: number | null;
}

export interface BuildAdvice {
  /** Класс-диагноз («Стеклянная пушка», «Танк», …). */
  classification: string;
  /** Краткое резюме для одной строки. */
  summary: string;
  totals: { blocking: number; high: number; medium: number; low: number };
  /** Упорядочено: blocking → low, внутри — по severity. */
  priorities: BuildAdviceItem[];
  /** «чини X → потом Y». */
  checklist: string[];
}

/** 449538 → '450k', 3_200_000 → '3.2M'. */
export function fmtSuffix(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}M`;
  if (a >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}

const PRIORITY_RANK: Record<AdvicePriority, number> = { blocking: 4, high: 3, medium: 2, low: 1 };

function rank(severity: number): AdvicePriority {
  if (severity >= 8) return 'blocking';
  if (severity >= 6) return 'high';
  if (severity >= 4) return 'medium';
  return 'low';
}

/** N° цифры из числа в PlayerStat (PoE2). */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : null);
}

/**
 * Построить референс по списку строк лeстницы (пул того же класса).
 * Медианы/топ по DPS и EHP + процентили пользователя.
 */
export function buildReferenceFromRows(rows: LadderRow[], user: { level?: number; dps?: number | null; ehp?: number | null; className?: string | null }): BuildReference {
  const poolSize = rows.length;
  const dpsArr = rows.map((r) => parseNinjaNumber(r['dps.total'] ?? r.dps)).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const ehpArr = rows.map((r) => parseNinjaNumber(r['ehp__str'] ?? r.ehp)).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const median = (a: number[]) => {
    if (!a.length) return null;
    const m = a.length >> 1;
    return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
  };
  const cmp = compareWithLadderRows(rows, {
    level: user.level,
    dps: user.dps ?? undefined,
    ehp: user.ehp ?? undefined,
    classLabel: user.className ?? undefined,
  });
  return {
    poolSize,
    className: user.className ?? null,
    medianDps: median(dpsArr),
    topDps: dpsArr.length ? dpsArr[dpsArr.length - 1]! : null,
    medianEhp: median(ehpArr),
    topEhp: ehpArr.length ? ehpArr[ehpArr.length - 1]! : null,
    dpsPercentile: cmp.dps?.percentile ?? null,
    ehpPercentile: cmp.ehp?.percentile ?? null,
  };
}

export interface AdviseContext {
  /** Пулы лeстницы того же класса (качается вызывающим; необязательно). */
  rows?: LadderRow[];
  /** Переопределить пороги (по умолчанию ADVICE_DEFAULTS). */
  thresholds?: Partial<typeof ADVICE_DEFAULTS>;
  /** Число резервирующих Spirit эффектов (ауры/херальды/гвардии) из <Buffs>. */
  reservationCount?: number;
}

/**
 * Приоритизированные рекомендации «что чинить первым» по оценке билда.
 * Сначала блокеры выживаемости (отрицательные резисты, нулевой CI-ES-пул),
 * затем — живучесть/урон против меты класса, затем — оружие/крит/Spirit.
 */
export function adviseBuild(est: BuildEstimate, ctx: AdviseContext = {}): BuildAdvice {
  const t = { ...ADVICE_DEFAULTS, ...(ctx.thresholds ?? {}) };
  const d = est.defenses;
  const ps = est.pobStats;

  const life = num(ps.Life);
  const isCI = life !== null && life <= 10;
  const es = num(ps.EnergyShield) ?? d.energyShield;
  const totalDps = num(ps.TotalDPS);
  const totalEhp = num(ps.TotalEHP);
  const critChance = num(ps.CritChance);
  const critMulti = num(ps.CritMultiplier);
  const spirit = num(ps.Spirit);
  const spiritUnreserved = num(ps.SpiritUnreserved);

  const ref = ctx.rows?.length
    ? buildReferenceFromRows(ctx.rows, { level: est.characterLevel ?? undefined, dps: totalDps, ehp: totalEhp, className: est.ascendancy ?? est.className })
    : null;

  const items: BuildAdviceItem[] = [];

  // ─── Выживаемость: слабые места из estimate ────────────────────────────
  for (const g of est.gaps as DefenseGap[]) {
    // CI: chaos-иммунитет (PoB: ChaosMaximumHitTaken=inf) — chaos-rez не критичен.
    if (isCI && g.type === 'uncapped_chaos_resistance') continue;
    // CI: Life намеренно = 1, обычный «низкий пул HP/ES» дублируется CI-пунктом ниже.
    if (isCI && g.type === 'low_hp_pool') continue;
    items.push({
      priority: rank(g.severity),
      severity: g.severity,
      area: 'survivability',
      title: gapTitle(g),
      detail: g.description,
      reason: gapReason(g),
      action: g.recommendation,
    });
  }

  // Отрицательные резисты — отдельный блокер поверх gap'ов.
  const elemRes = [
    ['fire', d.fireRes] as const,
    ['cold', d.coldRes] as const,
    ['lightning', d.lightningRes] as const,
  ];
  const neg = elemRes.filter(([, v]) => v < t.NEGATIVE_RESIST_BLOCK);
  for (const [name, v] of neg) {
    items.push({
      priority: 'blocking',
      severity: Math.min(10, 8 + (t.NEGATIVE_RESIST_BLOCK - v) / 10),
      area: 'survivability',
      title: `Отрицательный резист: ${name}`,
      detail: `${name} resistance ${v.toFixed(0)}%`,
      reason: 'Отрицательный резист УСИЛИВАЕТ урон этого типа — в эндгейме это ваншоты.',
      action: `Вытащить ${name} resistance из минуса (мод на гире/дереве) хотя бы до 0%.`,
    });
  }

  // ─── CI: ES-пул ─────────────────────────────────────────────────────────
  if (isCI) {
    if (es > 0 && es < t.CI_MIN_ES) {
      const sev = Math.min(10, 9 - ((t.CI_MIN_ES - es) / 1000));
      items.push({
        priority: rank(sev),
        severity: sev,
        area: 'survivability',
        title: 'ES-пул ниже порога CI',
        detail: `Energy Shield ${es >= 1e3 ? Math.round(es / 1000) + 'k' : es}, порог для стабильного CI ≈ ${Math.round(t.CI_MIN_ES / 1000)}k`,
        reason: 'CI держит всю жизнь в ES: при Life=1 тонкий ES-пул = постоянный риск ваншота.',
        action: `Набрать ES на гире/дереве до ~${Math.round(t.CI_MIN_ES / 1000)}k (щит/броня с ES, статы в фессиве)`,
      });
    }
    if (es <= 0) {
      items.push({
        priority: 'blocking',
        severity: 10,
        area: 'survivability',
        title: 'CI без ES-пула',
        detail: 'У билда Chaos Inoculation (Life=1), но ES не набран',
        reason: 'Без ES не с чего составить запас — персонаж стоит на 1 жизни.',
        action: 'Собрать ES-основу (энергосщиты/брони с ES) прежде чем менять ничего другого.',
      });
    }
  }

  // ─── Spirit ─────────────────────────────────────────────────────────────
  if (spiritUnreserved !== null) {
    if (spiritUnreserved < 0) {
      items.push({
        priority: 'blocking',
        severity: Math.min(9, Math.max(7, 8 + Math.abs(spiritUnreserved) / 10)),
        area: 'spirit',
        title: 'Spirit в перерасходе (перерезерв)',
        detail: `${spirit != null ? `Spirit ${spirit}, ` : ''}свободно ${spiritUnreserved.toFixed(0)}`,
        reason: 'Отрицательный свободный Spirit: часть аур/херальдов не активна — «декларированный» бонус не работает.',
        action: 'Снять одну резервирующую ауру ИЛИ поднять Spirit (Энергосщит/слот/узлы/бабки).',
      });
    } else if (spiritUnreserved < t.SPIRIT_TIGHT_BUFFER) {
      items.push({
        priority: 'medium',
        severity: 6,
        area: 'spirit',
        title: 'Spirit впритык (нет запаса)',
        detail: `свободно ${spiritUnreserved.toFixed(0)} из ${spirit ?? '?'}`,
        reason: 'Запас Spirit мал: любой следующий аурный/суппорт-апгрейд упрётся в предел.',
        action: 'Заложить запас Spirit под следующий апгрейд (резерв на гире/узлах).',
      });
    }
  } else if (spirit !== null) {
    items.push({
      priority: 'low',
      severity: 2,
      area: 'spirit',
      title: 'Бюджет Spirit не оценён',
      detail: `Spirit пул ${spirit}`,
      reason: 'В экспорте нет SpiritUnreserved — реальный запас под резерв не виден.',
      action: 'Оценить свободный Spirit в Path of Building (вкладка Calcs → Spirit).',
    });
  }

  // ─── Оружие (меле/атака) ────────────────────────────────────────────────
  if (est.weapon.weapon && est.weapon.totalDps > 0 && est.weapon.totalDps < t.MEELE_LOW_WEAPON_DPS) {
    items.push({
      priority: rank(Number(est.weapon.totalDps) < t.MEELE_LOW_WEAPON_DPS * 0.5 ? 7 : 5),
      severity: Number(est.weapon.totalDps) < t.MEELE_LOW_WEAPON_DPS * 0.5 ? 7 : 5,
      area: 'weapon',
      title: 'Оружие — бутылочное горлышко DPS',
      detail: `${est.weapon.weapon}: ${est.weapon.totalDps} DPS (pDPS ${est.weapon.physDps} + eDPS ${est.weapon.elementalDps})`,
      reason: `Атакующие билды тащат урон оружием; ниже ${t.MEELE_LOW_WEAPON_DPS} DPS — маленький вклад в итог.`,
      action: 'Апгрейд оружия (базовый ДПС/сокеты/моды) — самый быстрый рост урона.',
    });
  }

  // ─── DPS / EHP против меты класса ───────────────────────────────────────
  let dpsLag = false;
  let ehpLag = false;
  if (ref) {
    const clsLabel = ref.className ?? 'класса';
    if (totalDps !== null && ref.dpsPercentile !== null) {
      if (ref.dpsPercentile < t.LOW_PERCENTILE) {
        dpsLag = true;
        items.push({
          priority: 'high',
          severity: 7,
          area: 'damage',
          title: 'DPS просел против меты класса',
          detail: `${fmtSuffix(totalDps)} DPS — ~${ref.dpsPercentile.toFixed(0)}-й перцентиль ${clsLabel} (медиана ${fmtSuffix(ref.medianDps)}, топ ${fmtSuffix(ref.topDps)})`,
          reason: `В нижней четверти пула ${clsLabel} по урону — прокачка DPS даст больше всего.`,
          action: 'Поднять DPS: лучшее оружие, линки/уровни гемов, крит, гнезди камней.',
          reference: `${ref.poolSize} строк лeстницы, сортировка по DPS`,
        });
      } else if (ref.dpsPercentile >= t.TOP_PERCENTILE) {
        items.push({
          priority: 'low',
          severity: 2,
          area: 'damage',
          title: 'DPS в топе меты',
          detail: `${fmtSuffix(totalDps)} DPS — ~${ref.dpsPercentile.toFixed(0)}-й перцентиль ${clsLabel}`,
          reason: 'Урон на уровне лучших билдов класса.',
          action: 'Полировка: качество гемов, балансировка линков под стоимость.',
        });
      }
    }
    if (totalEhp !== null && ref.ehpPercentile !== null) {
      if (ref.ehpPercentile < t.LOW_PERCENTILE) {
        ehpLag = true;
        items.push({
          priority: 'high',
          severity: 7,
          area: 'survivability',
          title: 'Живучесть (EHP) ниже меты',
          detail: `${fmtSuffix(totalEhp)} EHP — ~${ref.ehpPercentile.toFixed(0)}-й перцентиль ${clsLabel} (медиана ${fmtSuffix(ref.medianEhp)}, топ ${fmtSuffix(ref.topEhp)})`,
          reason: `В нижней четверти пула ${clsLabel} по выживаемости — эндгейм-боссы будут ваншотать.`,
          action: 'Поднять EHP: ES/жизнь, резисты, слои защиты (уклонение/блок/броня).',
          reference: `${ref.poolSize} строк лeстницы`,
        });
      }
    }
  }

  // ─── Крит (перекликается с DPS-отставанием) ─────────────────────────────
  if (dpsLag && (critChance !== null || critMulti !== null)) {
    if (critChance !== null && critChance < t.CRIT_LOW_CHANCE) {
      items.push({
        priority: 'medium',
        severity: 5,
        area: 'crit',
        title: 'Крит-шанс низкий для крит-билда',
        detail: `CritChance ${critChance.toFixed(1)}%`,
        reason: 'При отставшем DPS низкий крит-шанс — первый кандидат на прокачку.',
        action: `Поднять crit chance до ≥${t.CRIT_LOW_CHANCE}% (необычное оружие, базы, узлы).`,
      });
    }
    if (critMulti !== null && critMulti < t.CRIT_LOW_MULTI) {
      items.push({
        priority: 'medium',
        severity: 5,
        area: 'crit',
        title: 'Крит-мультипликатор отстаёт',
        detail: `CritMultiplier ×${critMulti.toFixed(2)}`,
        reason: 'При отставшем DPS слабый критический урон тянет итог вниз.',
        action: `Поднять crit multi до ≥×${t.CRIT_LOW_MULTI.toFixed(1)} (крит-моды на гире/дереве, неуникальные базы).`,
      });
    }
  } else if (!dpsLag && ref && critMulti !== null && ref.dpsPercentile !== null && critMulti < t.CRIT_LOW_MULTI) {
    items.push({
      priority: 'low',
      severity: 3,
      area: 'crit',
      title: 'Крит-мультипликатор можно подтянуть',
      detail: `CritMultiplier ×${critMulti.toFixed(2)}`,
      reason: 'Урон не просел, но крит-мульт ниже ориентира — резерв для дальнейшего роста.',
      action: `Прокачать crit multi к ×${t.CRIT_LOW_MULTI.toFixed(1)} при следующем апгрейде гира.`,
    });
  }

  // ─── Классификация по мете ──────────────────────────────────────────────
  let classification: string;
  if (!ref || (ref.dpsPercentile === null && ref.ehpPercentile === null)) {
    classification = 'предварительная оценка по PlayerStat/гиру (референс меты не получен)';
  } else {
    const dp = ref.dpsPercentile ?? 50;
    const ep = ref.ehpPercentile ?? 50;
    const hi = (p: number) => p >= t.TOP_PERCENTILE;
    const lo = (p: number) => p < t.LOW_PERCENTILE;
    if (hi(dp) && hi(ep)) classification = 'топ-билд: урон и живучесть в верху класса';
    else if (hi(dp) && lo(ep)) classification = 'стеклянная пушка: много урона, мало живучести';
    else if (lo(dp) && hi(ep)) classification = 'танк: выживает, но слабый урон';
    else if (lo(dp) && lo(ep)) classification = 'проседает и по урону, и по живучести';
    else classification = 'сбалансированная середина меты';
  }

  // ─── Сортировка: blocking → low, внутри severity desc ───────────────────
  const unique = new Map<string, BuildAdviceItem>();
  for (const it of items) unique.set(it.title + '|' + it.detail, it);
  const priorities = [...unique.values()].sort(
    (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.severity - a.severity,
  );
  const totals = { blocking: 0, high: 0, medium: 0, low: 0 };
  for (const p of priorities) totals[p.priority] += 1;
  const checklist = priorities.map((p, i) => `${i + 1}. ${p.title}`);

  const summary = [
    totals.blocking ? `${totals.blocking} блокер(а)` : null,
    totals.high ? `${totals.high} высший приоритет` : null,
    totals.medium ? `${totals.medium} средний` : null,
  ].filter(Boolean).join(' · ') || 'серьёзных проблем не найдено';

  return { classification, summary, totals, priorities, checklist };
}

function gapTitle(g: DefenseGap): string {
  switch (g.type) {
    case 'uncapped_fire_resistance': return 'Огонь-резист ниже капа';
    case 'uncapped_cold_resistance': return 'Холод-резист ниже капа';
    case 'uncapped_lightning_resistance': return 'Молния-резист ниже капа';
    case 'uncapped_chaos_resistance': return 'Хаос-резист ниже капа';
    case 'low_hp_pool': return 'Низкий пул HP/ES';
    case 'no_layered_defenses': return 'Нет слоёв защиты';
    case 'single_defense_layer': return 'Один слой защиты';
    case 'armor_ineffective_vs_large_hits': return 'Броня неэффективна против больших ударов';
    case 'negative_chaos_resistance': return 'Отрицательный хаос-резист';
    default: return g.type;
  }
}

function gapReason(g: DefenseGap): string {
  if (g.type.startsWith('uncapped_')) return 'Резист ниже капа: входящий урон этого типа выше возможного минимума.';
  if (g.type === 'negative_chaos_resistance') return 'Отрицательный хаос-резист усиливает хаос-урон.';
  if (g.type === 'low_hp_pool') return 'Малый пул — ваншот в эндгейм-контенте.';
  if (g.type.includes('layer')) return 'Слои защиты перемножаются: чем их больше, тем выше итоговый EHP.';
  return 'Оценка из геара/PlayerStat.';
}