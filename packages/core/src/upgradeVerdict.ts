/**
 * W2-1: PoB-engine вердикт «предмет vs билд» —.swap-слой поверх oracle.
 *
 * Idea reference: poe2-upgrade-checker (GPL-3), pobverdict.js — НИ СТРОКИ
 * чужого кода не скопировано (№686/№687, MIT kit): формулы/пороги пересказаны
 * своими словами, реализация своя поверх Recompute-статов нашего pob_host.
 *
 * Отличие от itemVerdict.ts (P10): тот — эвристика по модам предмета без
 * движка; этот — точные до/после от настоящего PoB2 через swap_item в слот.
 *
 * Контракт статов = DEFAULT_STATS каталог pob_host.lua (проверено 30.10):
 * FullDPS/CombinedDPS/TotalDPS/MinionCombinedDPS/MinionTotalDPS, TotalEHP,
 * Life/EnergyShield, Spirit/SpiritUnreserved, Str/Dex/Int + Req*,
 * Fire/Cold/Lightning/ChaosResist, MovementSpeedMod.
 */

export type UpgradeVerdictKind =
  | 'upgrade'
  | 'minor_upgrade'
  | 'sidegrade'
  | 'loses_resistance'
  | 'downgrade'
  | 'not_viable'
  | 'uncertain';

export interface PobStatsLike {
  [key: string]: number | string | boolean | undefined;
}

export interface UpgradePriorities {
  /** Капы резистов первыми: потеря резист-хвоста ≠ апгрейд (default true). */
  resFirst: boolean;
  /** Считать хаос-резист (CI-билдам не нужен; default false). */
  chaos: boolean;
  /** Гейт Spirit: уход в over-reserve ломает билд (default true). */
  spirit: boolean;
  /** Гейт атрибутов: предмет нельзя надеть = not_viable (default true). */
  attrs: boolean;
  /** «Держать скорость передвижения»: потеря ≥ msBreakPts кэпит апгрейд (default true). */
  keepMs: boolean;
  /** Буфер «надёжно закрытого капа»: after < cap−buffer при потере = не апгрейд. */
  resistBuffer: number;
  /** Потеря MS (в процент-пунктах мода), кэпящая апгрейд. */
  msBreakPoints: number;
}

export const DEFAULT_PRIORITIES: UpgradePriorities = {
  resFirst: true,
  chaos: false,
  spirit: true,
  attrs: true,
  keepMs: true,
  resistBuffer: 5,
  msBreakPoints: 3,
};

/** res-кап PoE2 = 75. */
export const RESIST_CAP = 75;

export interface StatDelta {
  key: string | null;
  before: number | null;
  after: number | null;
  /** (after-before)/before·100; null = нет данных/обе нули. */
  deltaPct: number | null;
}

export interface UpgradeVerdictReason {
  direction: 'gain' | 'loss' | 'info';
  text: string;
}

export interface UpgradeVerdict {
  verdict: UpgradeVerdictKind;
  /** 0–100; 47–53 = sidegrade-полоса (дилемма-основа ExileLens). */
  score: number;
  slot: string;
  dpsKey: string | null;
  dps: StatDelta;
  ehp: StatDelta;
  resistAxes: StatDelta[];
  ms: StatDelta;
  reasons: UpgradeVerdictReason[];
  headline: string;
  guards: {
    resistCapLost: boolean;
    spiritBreak: boolean;
    attrsBreak: boolean;
    msBreak: boolean;
  };
}

// ─── Помощники ───────────────────────────────────────────────────────────────

function num(s: PobStatsLike, key: string): number | null {
  const v = s[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Ключ DPS-числа: ОДИН И ТОТ ЖЕ на обеих сторонах diff (числа «Full» и
 * «Total» смешивать нельзя). Приоритет: Full → MinionCombined → Combined →
 * Total. Побуждение: CoC-билды дают FullDPS=0 (артефакт №611) — честный
 * фолбэк вниз по цепочке; миньон-билды живут на MinionCombined.
 */
export function pickDpsKey(stats: PobStatsLike): string | null {
  const chain: Array<[string, number | null]> = [
    ['FullDPS', num(stats, 'FullDPS')],
    ['MinionCombinedDPS', num(stats, 'MinionCombinedDPS')],
    ['CombinedDPS', num(stats, 'CombinedDPS')],
    ['TotalDPS', num(stats, 'TotalDPS')],
  ];
  for (const [key, v] of chain) if (v != null && v > 0) return key;
  return null;
}

function delta(key: string, before: PobStatsLike, after: PobStatsLike): StatDelta {
  const b = num(before, key);
  const a = num(after, key);
  let d: number | null = null;
  if (b != null && a != null) {
    d = b > 0 ? ((a - b) / b) * 100 : a > 0 ? 100 : 0;
  }
  return { key, before: b, after: a, deltaPct: d };
}

function fmtPct(v: number | null): string {
  if (v == null) return '?';
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(1)}%`;
}

/** Sidegrade-полоса — переиспользуем канон itemVerdict (band единый по ядру). */
export { SIDEGRADE_BAND as UPGRADE_SIDEGRADE_BAND } from './itemVerdict.js';
import { SIDEGRADE_BAND } from './itemVerdict.js';
/** Порог «малого» апгрейда, %. */
const MINOR_GAIN_PCT = 2;

// ─── Гварды ──────────────────────────────────────────────────────────────────

function lostResistAxes(before: PobStatsLike, after: PobStatsLike, pr: UpgradePriorities): StatDelta[] {
  const axes = ['FireResist', 'ColdResist', 'LightningResist', ...(pr.chaos ? ['ChaosResist'] : [])];
  const lost: StatDelta[] = [];
  for (const key of axes) {
    const b = num(before, key);
    const a = num(after, key);
    if (b == null || a == null) continue;
    // Потеря = ушёл вниз И ниже кап-минус-буфер (PoB-цифры бывают старее факта).
    if (a < b && a < RESIST_CAP - pr.resistBuffer) lost.push(delta(key, before, after));
  }
  return lost;
}

function spiritBreaks(before: PobStatsLike, after: PobStatsLike): boolean {
  const b = num(before, 'SpiritUnreserved');
  const a = num(after, 'SpiritUnreserved');
  if (b == null || a == null) return false;
  return a < 0 && b >= 0; // уводит резервы в минус = билд сломан
}

function attrsBreak(after: PobStatsLike): boolean {
  for (const [req, stat] of [
    ['ReqStr', 'Str'],
    ['ReqDex', 'Dex'],
    ['ReqInt', 'Int'],
  ] as const) {
    const r = num(after, req);
    const s = num(after, stat);
    if (r != null && s != null && r > s) return true;
  }
  return false;
}

function msBreak(before: PobStatsLike, after: PobStatsLike, pr: UpgradePriorities): StatDelta | null {
  if (!pr.keepMs) return null;
  const b = num(before, 'MovementSpeedMod');
  const a = num(after, 'MovementSpeedMod');
  if (b == null || a == null) return null;
  // MovementSpeedMod — доли (0.30 = 30%); break = потеря ≥ msBreakPts пунктов.
  // Float-допуск 0.01: (0.30-0.27)*100 = 2.999…9956 без него НЕ проходит порог 3.
  if ((b - a) * 100 >= pr.msBreakPoints - 0.01) return delta('MovementSpeedMod', before, after);
  return null;
}

// ─── Ядро вердикта ───────────────────────────────────────────────────────────

/**
 * Сравнить до/после swap в один слот. Чистая функция (движок уже отдал числа).
 * Резист-гейт: материальная потеря капа кэпит апгрейд на «loses_resistance».
 */
export function verdictForSlot(
  slot: string,
  before: PobStatsLike,
  after: PobStatsLike,
  priorities: Partial<UpgradePriorities> = {},
): UpgradeVerdict {
  const pr: UpgradePriorities = { ...DEFAULT_PRIORITIES, ...priorities };
  const dpsKey = pickDpsKey(before);
  const dps = dpsKey ? delta(dpsKey, before, after) : { key: null, before: null, after: null, deltaPct: null };
  const ehp = delta('TotalEHP', before, after);
  const ms = delta('MovementSpeedMod', before, after);
  const resLost = pr.resFirst ? lostResistAxes(before, after, pr) : [];
  const spirit = pr.spirit ? spiritBreaks(before, after) : false;
  const attrs = pr.attrs ? attrsBreak(after) : false;
  const msL = msBreak(before, after, pr);

  const reasons: UpgradeVerdictReason[] = [];
  if (dps.deltaPct != null && dps.deltaPct !== 0) {
    reasons.push({
      direction: dps.deltaPct > 0 ? 'gain' : 'loss',
      text: `DPS (${dps.key ?? '?'}): ${fmtPct(dps.deltaPct)}`,
    });
  }
  if (ehp.deltaPct != null && ehp.deltaPct !== 0) {
    reasons.push({
      direction: ehp.deltaPct > 0 ? 'gain' : 'loss',
      text: `EHP: ${fmtPct(ehp.deltaPct)}`,
    });
  }
  if (resLost.length) {
    for (const r of resLost) reasons.push({ direction: 'loss', text: `${r.key}: ${r.before}% → ${r.after}% (ниже капа−буфер)` });
  }
  if (spirit) reasons.push({ direction: 'loss', text: 'Spirit уходит в минус (over-reserve) — билд ломается' });
  if (attrs) reasons.push({ direction: 'loss', text: 'Требования атрибутов не выполнены — надеть нельзя' });
  if (msL) reasons.push({ direction: 'loss', text: `Скорость передвижения: ${(msL.before! * 100).toFixed(0)}% → ${(msL.after! * 100).toFixed(0)}%` });

  const guards = { resistCapLost: resLost.length > 0, spiritBreak: spirit, attrsBreak: attrs, msBreak: msL != null };

  // Классификация:
  if (attrs) return base('not_viable', slot, dpsKey, dps, ehp, ms, guards, reasons, 'Требования атрибутов не выполнены — предмет надеть нельзя.');
  if (spirit) return base('not_viable', slot, dpsKey, dps, ehp, ms, guards, reasons, 'Over-reserve Spirit ломает билд — не вариант.');
  if (guards.resistCapLost && (dps.deltaPct ?? 0) < 60) {
    return base(
      'loses_resistance',
      slot,
      dpsKey,
      dps,
      ehp,
      ms,
      guards,
      reasons,
      'Усиленье за резист-кап: потеря резистов ниже капа — компенсируйте парой или откажитесь.',
    );
  }
  if (guards.msBreak && (dps.deltaPct ?? 0) + (ehp.deltaPct ?? 0) < 30) {
    return base('sidegrade', slot, dpsKey, dps, ehp, ms, guards, reasons, 'Скорость передвижения важнее этого усиления (hold-MS).');
  }

  const dpsD = dps.deltaPct ?? 0;
  const ehpD = ehp.deltaPct ?? 0;
  const net = dpsD + ehpD;
  if (dpsKey == null || (dps.before == null && ehp.before == null)) {
    return base('uncertain', slot, dpsKey, dps, ehp, ms, guards, reasons, 'Движок не отдал ни DPS, ни EHP для этого билда — вердикт неопределён.');
  }
  if (net >= 0 && dpsD >= 0 && ehpD >= 0) {
    const kind: UpgradeVerdictKind = Math.max(dpsD, ehpD) < MINOR_GAIN_PCT ? 'minor_upgrade' : 'upgrade';
    if (kind === 'minor_upgrade')
      return base(kind, slot, dpsKey, dps, ehp, ms, guards, reasons, 'Слабый, но честный плюс в обе стороны.');
    return base(kind, slot, dpsKey, dps, ehp, ms, guards, reasons, 'Растут и урон, и выживаемость — брать.');
  }
  // Дилемма-скор: взвешенный нет-эффект.
  const score = clamp(50 + dpsD / 2 + ehpD / 2, 0, 100);
  if (score >= SIDEGRADE_BAND.low && score <= SIDEGRADE_BAND.high && guards.resistCapLost === false) {
    return base('sidegrade', slot, dpsKey, dps, ehp, ms, guards, reasons, 'Трейд-офф без решающего счёта — sidegrade.');
  }
  if (dpsD > 0 && ehpD < 0 && dpsD >= Math.abs(ehpD)) {
    return base('upgrade', slot, dpsKey, dps, ehp, ms, guards, reasons, `Урон ${fmtPct(dpsD)} против потери EHP ${fmtPct(ehpD)} — по вашим приоритетам апгрейд.`);
  }
  if (ehpD > 0 && dpsD < 0 && ehpD >= Math.abs(dpsD)) {
    return base('minor_upgrade', slot, dpsKey, dps, ehp, ms, guards, reasons, `EHP ${fmtPct(ehpD)} против потери урона ${fmtPct(dpsD)} — защитный апгрейд.`);
  }
  return base('downgrade', slot, dpsKey, dps, ehp, ms, guards, reasons, 'И урон, и выживаемость просели — мимо.');
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function base(
  verdict: UpgradeVerdictKind,
  slot: string,
  dpsKey: string | null,
  dps: StatDelta,
  ehp: StatDelta,
  ms: StatDelta,
  guards: UpgradeVerdict['guards'],
  reasons: UpgradeVerdictReason[],
  headline: string,
): UpgradeVerdict {
  return { verdict, score: scoreOf(verdict, dps, ehp), slot, dpsKey, dps, ehp, resistAxes: [], ms, reasons, headline, guards };
}

function scoreOf(verdict: UpgradeVerdictKind, dps: StatDelta, ehp: StatDelta): number {
  switch (verdict) {
    case 'upgrade':
      return clamp(75 + (dps.deltaPct ?? 0) / 4 + (ehp.deltaPct ?? 0) / 4, 75, 100);
    case 'minor_upgrade':
      return 60;
    case 'sidegrade':
      return 50;
    case 'loses_resistance':
      return 40;
    case 'downgrade':
      return clamp(30 + (dps.deltaPct ?? 0) / 2 + (ehp.deltaPct ?? 0) / 2, 0, 30);
    case 'uncertain':
      return 50; // не «слабый апгрейд» — без мнения
    case 'not_viable':
      return 0;
  }
}

/**
 * Лучший вердикт из нескольких слотов («примерка»: кольца/джевелы в каждый
 * подходящий). Порядок: upgrade > minor > sidegrade > loses_res > downgrade >
 * uncertain > not_viable; при равенстве — больший score.
 */
const RANK: Record<UpgradeVerdictKind, number> = {
  upgrade: 7,
  minor_upgrade: 6,
  sidegrade: 5,
  loses_resistance: 4,
  downgrade: 3,
  uncertain: 2,
  not_viable: 1,
};

export function pickBestSlot(verdicts: UpgradeVerdict[]): UpgradeVerdict | null {
  let best: UpgradeVerdict | null = null;
  for (const v of verdicts) {
    if (!best) {
      best = v;
      continue;
    }
    if (RANK[v.verdict] > RANK[best.verdict] || (RANK[v.verdict] === RANK[best.verdict] && v.score > best.score)) best = v;
  }
  return best;
}
