/**
 * Вердикт-слой «предмет vs билд» (P10): кандидат для слота — upgrade или нет.
 *
 * Паттерны взяты у ExileLens (MIT, см. LICENSE-гигиену мастер-плана §8):
 *   - дилемма-основа: sidegrade band (двухсторонний трейд-офф с нерешающим
 *     скором = sidegrade), «real, named loss holds a strong upgrade back» —
 *     материальная потеря кэпит апгрейд на одну полосу;
 *   - guardrails: unequipable ≠ upgrade; UNMEASURED ≠ upgrade; потеря
 *     резист-капа — никогда не upgrade; UNCERTAIN ≠ weak upgrade;
 *   - defense-axis: рассматриваем все 5 типов урона (EHP-оси), не одну цифру.
 * Реализация своя, поверх готовых модулей: parse.ts (клир-текст) и
 * estimate.ts (defenseForItem/mergeGearDefenses/calculateAllEhp) — сети нет.
 *
 * Границы v1 (честные, в guards.unmeasured):
 *   - offense измерим ТОЛЬКО для слота оружия (pdps+edps · aps самого предмета);
 *     attack-моды с украшений (crit multi, attack speed, added flat) не
 *     пересчитываются деревом/гемами → ось unmeasured;
 *   - «% increased»-моды применяются только к плоским статам самого набора
 *     гира (приближение mergeGearDefenses);
 *   - Spirit/atribute-моды вне осей.
 * Оракул PoB (точный DPS/EHP с деревом) — интеграция фазы 2 (план §4.1).
 */

import type { BuildGearItem } from './types.js';
import { parseItemText, type ParsedItem } from './parse.js';
import {
  DEFENSE_CONSTANTS,
  DEFAULT_THREAT,
  calculateAllEhp,
  defenseForItem,
  mergeGearDefenses,
  type DamageTypeKind,
  type EstimatedDefenses,
  type ThreatProfile,
} from './estimate.js';

// ─── Слоты: EN/RU Item Class → канонический слот ─────────────────────────────

const SLOT_BY_ITEM_CLASS: Record<string, string> = {
  Helmets: 'Helm',
  'Body Armours': 'BodyArmour',
  Gloves: 'Gloves',
  Boots: 'Boots',
  Shields: 'Shield',
  Bucklers: 'Shield',
  Amulets: 'Amulet',
  Talismans: 'Amulet',
  Rings: 'Ring',
  Belts: 'Belt',
  Quivers: 'Quiver',
  'One Hand Swords': 'Weapon',
  'Two Hand Swords': 'Weapon',
  Staves: 'Weapon',
  Quarterstaves: 'Weapon',
  'One Hand Maces': 'Weapon',
  'Two Hand Maces': 'Weapon',
  'One Hand Axes': 'Weapon',
  'Two Hand Axes': 'Weapon',
  Bows: 'Weapon',
  Crossbows: 'Weapon',
  Wands: 'Weapon',
  Daggers: 'Weapon',
  'Rune Daggers': 'Weapon',
  Spears: 'Weapon',
  Flails: 'Weapon',
  Sceptres: 'Weapon',
  Foci: 'Focus',
  Focuses: 'Focus',
  Шлемы: 'Helm',
  'Доспехи': 'BodyArmour',
  Перчатки: 'Gloves',
  Сапоги: 'Boots',
  Щиты: 'Shield',
  Кольца: 'Ring',
  Амулеты: 'Amulet',
  Пояса: 'Belt',
  Колчаны: 'Quiver',
};

/** Канонический слот предмета по Item Class (EN-клиент; неизвестный — ''). */
export function slotForItem(item: ParsedItem): string {
  return SLOT_BY_ITEM_CLASS[item.itemClass] ?? '';
}

const WEAPON_SLOT = 'Weapon';

// ─── Контракты ──────────────────────────────────────────────────────────────

export type ItemVerdictKind =
  | 'upgrade'
  | 'minor_upgrade'
  | 'sidegrade'
  | 'downgrade'
  | 'uncertain'
  | 'not_viable';

/** Ось сравнения ( defense = EHP по типу урона; offense = DPS оружия ). */
export interface VerdictAxis {
  axis: string;
  /** Дельта кандидата к текущему, % (положительная — лучше). */
  deltaPct: number;
  /** true — ось с потерей (именованный loss для капа апгрейда). */
  loss: boolean;
}

export interface ItemVerdictGuards {
  /** Кандидат физически надеваем этим персонажем (false = not_viable). */
  equipable: boolean;
  /** Требования не удалось сверить (нет данных персонажа). */
  equipabilityUnknown: boolean;
  /** Кандидат теряет резист-кап хотя бы по одной стихии (never upgrade). */
  resistCapLost: boolean;
  /** Ось offense не измерима в этом контексте (UNMEASURED ≠ upgrade). */
  offenseUnmeasured: boolean;
}

export interface ItemVerdictReason {
  text: string;
  direction: 'gain' | 'loss' | 'info';
}

export interface ItemVerdict {
  verdict: ItemVerdictKind;
  /** 0–100: 47–53 = sidegrade-полоса (дилемма-основа ExileLens). */
  score: number;
  axes: VerdictAxis[];
  guards: ItemVerdictGuards;
  reasons: ItemVerdictReason[];
  /** Слоты (для отчёта). */
  slot: string;
  candidate: { name: string; baseType: string };
  current: { name: string; baseType: string } | null;
  /** Человекочитаемая однострочная причинность (RU). */
  headline: string;
}

export interface ItemVerdictInput {
  /** Клир-текст (Ctrl+C) предмета-кандидата. EN-клиент. */
  candidateText: string;
  /** Клир-текст текущего предмета слота (опц.; без него — candidate-only). */
  currentSlotText?: string;
  /** Остальной эквип для контекста (слоты/тексты). По желанию. */
  gear?: BuildGearItem[] | Record<string, string>;
  /** Базовые пулы (жизнь/ES с уровней и дерева), если известны. */
  basePools?: { life?: number; energyShield?: number };
  /** Персонаж — для проверки requirements. */
  character?: {
    level?: number;
    strength?: number;
    dexterity?: number;
    intelligence?: number;
  };
  /** Угроза для EHP-расчёта (hit size / accuracy). */
  threat?: ThreatProfile;
}

// ─── Вспомогательные ─────────────────────────────────────────────────────────

const GEAR_ITEM_CLASSES = new Set(Object.keys(SLOT_BY_ITEM_CLASS));

function toGearList(gear: ItemVerdictInput['gear']): BuildGearItem[] {
  if (!gear) return [];
  if (Array.isArray(gear)) return gear.filter((g) => g.itemText && g.itemText.trim().length > 0);
  return Object.entries(gear)
    .filter(([, t]) => t && t.trim().length > 0)
    .map(([slot, itemText]) => ({ slot, name: '', itemText }));
}

function safeParse(text: string): ParsedItem | null {
  try {
    const p = parseItemText(text);
    return p.baseType ? p : null;
  } catch {
    return null;
  }
}

/** DPS самого предмета: (avg phys + avg elemental) × aps. Без crit/гемов/дерева. */
function itemWeaponDps(item: ParsedItem): number {
  const aps = item.offense.attacksPerSecond?.value ?? 0;
  if (aps <= 0) return 0;
  const phys = item.offense.physicalDamage;
  const pdps = phys ? ((phys.min + phys.max) / 2) * aps : 0;
  const edps = item.offense.elementalDamage.reduce((a, e) => a + ((e.min + e.max) / 2) * aps, 0);
  return pdps + edps;
}

function pctDelta(after: number, before: number): number {
  if (before <= 0) return after > 0 ? 100 : 0;
  return ((after - before) / before) * 100;
}

function fmtPct(v: number): string {
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(1)}%`;
}

// ─── Ядро ────────────────────────────────────────────────────────────────────

const DEFENSE_AXES: Array<{ type: DamageTypeKind; weight: number; label: string }> = [
  { type: 'physical', weight: 1.0, label: 'EHP (физ)' },
  { type: 'fire', weight: 0.6, label: 'EHP (огонь)' },
  { type: 'cold', weight: 0.6, label: 'EHP (холод)' },
  { type: 'lightning', weight: 0.6, label: 'EHP (молния)' },
  { type: 'chaos', weight: 0.6, label: 'EHP (хаос)' },
];

/** sidegrade-полоса скора (дилемма-основа ExileLens: 47–53). */
export const SIDEGRADE_BAND = { low: 47, high: 53 };

function addBasePools(d: EstimatedDefenses, base: { life?: number; energyShield?: number }): EstimatedDefenses {
  return {
    ...d,
    life: d.life + (base.life ?? 0),
    energyShield: d.energyShield + (base.energyShield ?? 0),
  };
}

/**
 * Вердикт кандидата для слота: дельты EHP-осей (5 типов урона) и DPS оружия,
 * guardrails (equipability, resist-cap, unmeasured), sidegrade-полоса скора.
 * Чистая функция: без сети, без состояние.
 */
export function itemVerdict(input: ItemVerdictInput): ItemVerdict {
  const threat = input.threat ?? DEFAULT_THREAT;
  const candidate = safeParse(input.candidateText);
  const slot = candidate ? slotForItem(candidate) : '';

  const fail = (verdict: ItemVerdictKind, text: string): ItemVerdict => ({
    verdict,
    score: 0,
    axes: [],
    guards: {
      equipable: true,
      equipabilityUnknown: true,
      resistCapLost: false,
      offenseUnmeasured: true,
    },
    reasons: [{ text, direction: 'info' }],
    slot,
    candidate: { name: candidate?.name ?? '', baseType: candidate?.baseType ?? '' },
    current: null,
    headline: text,
  });

  if (!candidate) return fail('not_viable', 'Кандидат не парсится как предмет (нужен клир-текст Ctrl+C, EN-клиент).');
  if (candidate.rarity === 'Gem' || candidate.rarity === 'Currency') {
    return fail('not_viable', `Это ${candidate.rarity === 'Gem' ? 'гем' : 'валюта'} — не предмет снаряжения, вердикт не применим.`);
  }
  if (!GEAR_ITEM_CLASSES.has(candidate.itemClass)) {
    return fail('not_viable', `Неизвестный слот для Item Class «${candidate.itemClass}» — вердикт не применим.`);
  }

  const current = input.currentSlotText ? safeParse(input.currentSlotText) : null;
  if (input.currentSlotText && !current) {
    return fail('not_viable', 'Текущий предмет слота не парсится (currentSlotText должен быть клир-текстом Ctrl+C).');
  }
  // Кандидат другого слока, чем current — это не сравнение «для этого слота».
  if (current && candidate.itemClass !== current.itemClass) {
    return fail(
      'not_viable',
      `Кандидат (${candidate.itemClass}) не для слота текущего предмета (${current.itemClass}).`,
    );
  }

  // Guards: требования.
  let equipabilityUnknown = false;
  if (input.character) {
    const r = candidate.requirements;
    const ch = input.character;
    if (
      (r.level != null && ch.level != null && r.level > ch.level) ||
      (r.strength != null && ch.strength != null && r.strength > ch.strength) ||
      (r.dexterity != null && ch.dexterity != null && r.dexterity > ch.dexterity) ||
      (r.intelligence != null && ch.intelligence != null && r.intelligence > ch.intelligence)
    ) {
      const req = [
        r.level != null ? `L${r.level}` : null,
        r.strength != null ? `STR ${r.strength}` : null,
        r.dexterity != null ? `DEX ${r.dexterity}` : null,
        r.intelligence != null ? `INT ${r.intelligence}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      const v = fail('not_viable', `Персонаж не может надеть: требования ${req}.`);
      v.guards.equipable = false;
      v.guards.equipabilityUnknown = false;
      v.current = current ? { name: current.name ?? '', baseType: current.baseType } : null;
      return v;
    }
  } else {
    equipabilityUnknown = true; // TRUST-01A: без данных персонажа сверить нельзя
  }

  // Набор гира: current-слот заменяем кандидатом в переданном гире.
  const gearBase = toGearList(input.gear);
  const candGearItem: BuildGearItem = {
    slot: slot || 'Candidate',
    name: candidate.name ?? candidate.baseType,
    itemText: input.candidateText,
  };
  // Ищем в гире слот, который кандидат заменяет: по совпадению itemClass,
  // затем по current-тексту, затем по имени слота.
  let replaceIndex = -1;
  for (let i = 0; i < gearBase.length; i++) {
    const g = gearBase[i];
    if (input.currentSlotText && g.itemText === input.currentSlotText) {
      replaceIndex = i;
      break;
    }
  }
  if (replaceIndex < 0) {
    for (let i = 0; i < gearBase.length; i++) {
      const p = safeParse(gearBase[i]!.itemText);
      if (p && p.itemClass === candidate.itemClass) {
        replaceIndex = i;
        break;
      }
    }
  }
  if (replaceIndex < 0 && slot) {
    const idx = gearBase.findIndex((g) => g.slot === slot);
    if (idx >= 0) replaceIndex = idx;
  }

  const gearWithCandidate = gearBase.slice();
  if (replaceIndex >= 0) gearWithCandidate[replaceIndex] = candGearItem;
  else gearWithCandidate.push(candGearItem);

  const gearWithCurrent = gearBase.slice();
  if (current) {
    const curGearItem: BuildGearItem = {
      slot: slot || 'Current',
      name: current.name ?? current.baseType,
      itemText: input.currentSlotText!,
    };
    if (replaceIndex >= 0) gearWithCurrent[replaceIndex] = curGearItem;
    else if (gearWithCandidate.length === 1) gearWithCurrent.push(curGearItem);
    else gearWithCurrent.push(curGearItem);
  }

  const defsCandidate = addBasePools(mergeGearDefenses(gearWithCandidate), input.basePools ?? {});
  const defsCurrent = current
    ? addBasePools(mergeGearDefenses(gearWithCurrent), input.basePools ?? {})
    : null;

  // Guard: потеря резист-капа («res-cap loss — never upgrade»).
  // Если с текущим предметом стихия в капе, а с кандидатом — нет.
  let resistCapLost = false;
  const resFields: Array<[keyof EstimatedDefenses, string]> = [
    ['fireRes', 'огонь'],
    ['coldRes', 'холод'],
    ['lightningRes', 'молния'],
    ['chaosRes', 'хаос'],
  ];
  const lostCaps: string[] = [];
  if (defsCurrent) {
    for (const [field, label] of resFields) {
      const before = defsCurrent[field] as number;
      const after = defsCandidate[field] as number;
      if (before >= DEFENSE_CONSTANTS.RESISTANCE_CAP && after < DEFENSE_CONSTANTS.RESISTANCE_CAP) {
        resistCapLost = true;
        lostCaps.push(label);
      }
    }
  }

  // Оси defense: EHP до/после по 5 типам урона.
  const axes: VerdictAxis[] = [];
  const reasons: ItemVerdictReason[] = [];
  if (defsCurrent) {
    const ehpBefore = calculateAllEhp(defsCurrent, threat);
    const ehpAfter = calculateAllEhp(defsCandidate, threat);
    for (const { type, weight, label } of DEFENSE_AXES) {
      const b = ehpBefore[type].effectiveHp;
      const a = ehpAfter[type].effectiveHp;
      const delta = pctDelta(a, b);
      if (Math.abs(delta) < 0.05) continue;
      const gain = delta > 0;
      axes.push({ axis: label, deltaPct: delta, loss: !gain });
      reasons.push({
        text: `${label}: ${fmtPct(delta)}`,
        direction: gain ? 'gain' : 'loss',
      });
      void weight;
    }
  } else {
    reasons.push({
      text: 'Текущий предмет слота не передан: EHP-дельты не посчитаны (candidate-only режим).',
      direction: 'info',
    });
  }

  // Ось offense: только слот оружия (DPS самого предмета).
  let offenseUnmeasured = true;
  let dpsDelta: number | null = null;
  if (slot === WEAPON_SLOT) {
    if (defsCurrent && current) {
      const dpsAfter = itemWeaponDps(candidate);
      const dpsBefore = itemWeaponDps(current);
      if (dpsBefore > 0 || dpsAfter > 0) {
        dpsDelta = pctDelta(dpsAfter, dpsBefore);
        offenseUnmeasured = false;
        reasons.push({
          text: `DPS оружия (сам предмет): ${dpsBefore.toFixed(0)} → ${dpsAfter.toFixed(0)} (${fmtPct(dpsDelta)})`,
          direction: dpsDelta >= 0 ? 'gain' : 'loss',
        });
      }
    } else if (itemWeaponDps(candidate) > 0) {
      reasons.push({ text: 'DPS кандидата: собственный урон без сравнения (current не передан).', direction: 'info' });
    }
  }
  if (offenseUnmeasured && slot !== WEAPON_SLOT) {
    reasons.push({
      text: 'Offense-эффект (crit multi, attack speed, added damage с украшений) не измерим без PoB-оракула — ось UNMEASURED.',
      direction: 'info',
    });
  } else if (offenseUnmeasured && slot === WEAPON_SLOT) {
    reasons.push({ text: 'DPS оружия не измерим (нет данных урона у предметов).', direction: 'info' });
  }

  const guards: ItemVerdictGuards = {
    equipable: true,
    equipabilityUnknown,
    resistCapLost,
    offenseUnmeasured,
  };
  if (resistCapLost) {
    reasons.push({
      text: `Кандидат выводит из капа резистов: ${lostCaps.join(', ')} (курс 75%) — это НЕ апгрейд (res-cap guard).`,
      direction: 'loss',
    });
  }

  // Скор: 50 ± взвешенные дельты осей (каждая ось кэп ±20).
  let score = 50;
  const hasMeasurements = axes.length > 0 || dpsDelta != null;
  if (!hasMeasurements) {
    // Окон нет: либо предмет не меняет ни одну измеримую плоскую защиту
    // (потенциальная замена 1-в-1 → sidegrade), либо данных просто нет.
    const flat = current ? flatDefenseDelta(input.currentSlotText!, input.candidateText) : null;
    const flatUnchanged =
      flat != null &&
      Object.values(flat).every((v) => Math.abs(v) < 0.05);
    const v: ItemVerdict = {
      verdict: current && flatUnchanged ? 'sidegrade' : 'uncertain',
      score,
      axes,
      guards,
      reasons,
      slot,
      candidate: { name: candidate.name ?? '', baseType: candidate.baseType },
      current: current ? { name: current.name ?? '', baseType: current.baseType } : null,
      headline: current && flatUnchanged
        ? 'SIDEGRADE — измеримые плоские статы идентичны (замена 1-в-1).'
        : 'UNCERTAIN: измеримых осей нет (нет данных для сравнения).',
    };
    return v;
  }
  const axisWeights: Record<string, number> = {};
  for (const { type, weight, label } of DEFENSE_AXES) {
    axisWeights[label] = weight;
    void type;
  }
  for (const ax of axes) {
    const w = axisWeights[ax.axis] ?? 0.5;
    score += Math.max(-20, Math.min(20, (ax.deltaPct * w) / 2));
  }
  if (dpsDelta != null) {
    score += Math.max(-20, Math.min(20, dpsDelta / 2));
  }
  score = Math.max(0, Math.min(100, score));

  // Дилемма-основа: material loss кэпит апгрейд на одну полосу.
  const hasNamedLoss = axes.some((a) => a.loss && a.deltaPct <= -3) || (dpsDelta != null && dpsDelta <= -3);

  let verdict: ItemVerdictKind;
  if (score > SIDEGRADE_BAND.high) verdict = 'upgrade';
  else if (score >= SIDEGRADE_BAND.low) verdict = 'sidegrade';
  else verdict = 'downgrade';

  // Guardrails кэпят вердикт вниз, никогда вверх (UNCERTAIN ≠ weak upgrade).
  if (verdict === 'upgrade' && hasNamedLoss) verdict = 'minor_upgrade';
  if (verdict === 'upgrade' && (equipabilityUnknown || offenseUnmeasured)) verdict = 'minor_upgrade';
  if ((verdict === 'upgrade' || verdict === 'minor_upgrade') && resistCapLost) verdict = 'sidegrade';

  const gains = reasons.filter((r) => r.direction === 'gain').map((r) => r.text);
  const losses = reasons.filter((r) => r.direction === 'loss').map((r) => r.text);
  const headlineGain = gains[0] ?? 'без измеримых улучшений';
  const headlineLoss = losses[0] ?? 'без именованных потерь';
  const headline =
    verdict === 'sidegrade'
      ? `SIDEGRADE — ${headlineGain} / ${headlineLoss}, скор ${score.toFixed(0)} не решает`
      : verdict === 'upgrade' || verdict === 'minor_upgrade'
        ? `${verdict === 'upgrade' ? 'UPGRADE' : 'MINOR UPGRADE'} — ${headlineGain}, скор ${score.toFixed(0)}${hasNamedLoss && verdict === 'minor_upgrade' ? ' (потеря сдерживает)' : ''}`
        : `DOWNGRADE — ${headlineLoss}, скор ${score.toFixed(0)}`;

  const result: ItemVerdict = {
    verdict,
    score,
    axes,
    guards,
    reasons,
    slot,
    candidate: { name: candidate.name ?? '', baseType: candidate.baseType },
    current: current ? { name: current.name ?? '', baseType: current.baseType } : null,
    headline,
  };
  return result;
}

/** Дельты флэт-защит предмета (для «потерять ES/резист» в отчёте). */
export function flatDefenseDelta(currentText: string, candidateText: string): {
  life: number;
  energyShield: number;
  armour: number;
  evasion: number;
  fireRes: number;
  coldRes: number;
  lightningRes: number;
  chaosRes: number;
} {
  const mk = (t: string) => defenseForItem({ slot: '', name: '', itemText: t });
  const a = mk(candidateText);
  const b = mk(currentText);
  const d = (x: number, y: number) => Math.round((x - y) * 10) / 10;
  return {
    life: d(a.life, b.life),
    energyShield: d(a.energyShield, b.energyShield),
    armour: d(a.armour, b.armour),
    evasion: d(a.evasion, b.evasion),
    fireRes: d(a.fireRes, b.fireRes),
    coldRes: d(a.coldRes, b.coldRes),
    lightningRes: d(a.lightningRes, b.lightningRes),
    chaosRes: d(a.chaosRes, b.chaosRes),
  };
}
