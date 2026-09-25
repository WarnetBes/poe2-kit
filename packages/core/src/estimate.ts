/**
 * Приближённая оценка билда: EHP по слоям защиты и DPS оружия — БЕЗ PoB-движка.
 *
 * Закрывает ~80% AI-запросов «evaluate my build»: если игрок не открывал PoB
 * (чисел PlayerStat нет), считаем сами по клир-тексту снаряжения.
 *
 * Формулы сверены с каноном PoB2 (docs/POB2_CALC_FORMULAS.md;
 * исходники — _research/path-of-building-poe2, CalcDefence.lua):
 *   - Броня: DR = A / (A + 10 × D_raw), кап 90% (PoE2: броня ДО резистов, и её
 *     эффективность зависит от размера удара);
 *   - Уклонение ЗАЩИЩАЮЩЕГОСЯ (монстр бьёт игрока): Hit% = 100 − 95·Ev/(Ev + 4·Acc),
 *     кламп 5–100%, кап уворота 95% (CalcDefence.lua:41-47);
 *   - Блок: кап 50% (PoE2, не 75% как в PoE1);
 *   - Резисты: кап 75%;
 *   - Хаос в PoE2 снимает ES с ×2 скоростью (не обходит целиком, как в PoE1);
 *   - Слоя защита перемножаются: DamageMult = (1-evade)(1-block)(1-armor)(1-res),
 *     EHP = RawHP / DamageMult.
 */

import { parseItemText } from './parse.js';
import type { BuildGearItem } from './types.js';
import { buildCodeToGear, toXml } from './build.js';

// ─── Константы PoE2 ──────────────────────────────────────────────────────────

export const DEFENSE_CONSTANTS = {
  ARMOR_MAX_DR: 90, // макс. reduction от брони, %
  ARMOR_MULTIPLIER: 10, // множитель в формуле брони (ArmourRatio, Data.lua:261)
  EVADE_MIN_HIT_CHANCE: 5, // мин. шанс удара по игроку, %
  MONSTER_EVASION_FACTOR: 0.95, // hit = 100 − 95·Ev/(Ev+4·Acc)
  MONSTER_EVASION_ACCURACY_FACTOR: 4,
  EVADE_MAX_CHANCE: 95, // кап шанса уклониться (Misc.lua:111)
  BLOCK_MAX_CHANCE: 50, // PoE2 cap блока, %
  RESISTANCE_CAP: 75, // стандартный кап резистов, %
} as const;

/** Профиль угрозы: от него зависит эффективность брони и уклонения. */
export interface ThreatProfile {
  /** Ожидаемый сырой урон за удар (по умолчанию 1000). */
  expectedHitSize: number;
  /** Точность атакующего (по умолчанию 2000). */
  attackerAccuracy: number;
}

export const DEFAULT_THREAT: ThreatProfile = { expectedHitSize: 1000, attackerAccuracy: 2000 };

// ─── Чистые формулы (PoE2) ───────────────────────────────────────────────────

/** DR-% брони против удара `rawDamage` (формула PoE2, кап 90%). */
export function armorDr(armor: number, rawDamage: number): number {
  if (armor <= 0 || rawDamage <= 0) return 0;
  const dr = (armor / (armor + DEFENSE_CONSTANTS.ARMOR_MULTIPLIER * rawDamage)) * 100;
  return Math.min(dr, DEFENSE_CONSTANTS.ARMOR_MAX_DR);
}

/**
 * Шанс удара (0–100%) монстра с точностью acc по игроку с уклонением ev.
 * Формула защищающегося (CalcDefence.lua:41-47): hit = 100 − 95·Ev/(Ev + 4·Acc),
 * кламп [5..100]; кап уворота 95%.
 */
export function hitChance(evasion: number, accuracy: number): number {
  const ev = Math.max(0, evasion);
  const ac = Math.max(0, accuracy);
  if (ac <= 0) return 100 - DEFENSE_CONSTANTS.EVADE_MAX_CHANCE;
  const raw =
    (1 - (DEFENSE_CONSTANTS.MONSTER_EVASION_FACTOR * ev) /
      (ev + DEFENSE_CONSTANTS.MONSTER_EVASION_ACCURACY_FACTOR * ac)) * 100;
  return Math.min(Math.max(raw, DEFENSE_CONSTANTS.EVADE_MIN_HIT_CHANCE), 100);
}

/** Сколько брони нужно для targetDR% против удара rawDamage. */
export function armorNeededForDr(targetDrPercent: number, rawDamage: number): number {
  if (targetDrPercent >= DEFENSE_CONSTANTS.ARMOR_MAX_DR) return Infinity;
  if (targetDrPercent <= 0 || rawDamage <= 0) return 0;
  const d = targetDrPercent / 100;
  return (d * DEFENSE_CONSTANTS.ARMOR_MULTIPLIER * rawDamage) / (1 - d);
}

// ─── Суммарные защиты из снаряжения ──────────────────────────────────────────

/** Суммарные защиты, вытащенные из клир-текста предметов (приближённо). */
export interface EstimatedDefenses {
  life: number;
  energyShield: number;
  armour: number;
  evasion: number;
  blockChance: number;
  fireRes: number;
  coldRes: number;
  lightningRes: number;
  chaosRes: number;
  /** Слоты без клир-текста (укажут на неполноту оценки). */
  emptySlots: number;
  /** Сумма «increased» к life/ES/armour/evasion из модов, % (для отчёта). */
  percentMods: { life: number; energyShield: number; armour: number; evasion: number };
}

const PCT = '(\\d+(?:\\.\\d+)?)';
const SIGNED = '([+-]?\\d+(?:\\.\\d+)?)';

/** Извлечь первое число из строк модов, подпадающих под регулярное выражение. */
function sumModValues(mods: string[], re: RegExp, sign = false): number {
  let total = 0;
  for (const m of mods) {
    const r = sign ? new RegExp(re.source, 'g') : re;
    const match = r.exec(m);
    if (match) {
      const raw = match.slice(1).find((g) => g != null);
      if (raw != null) {
        const v = parseFloat(raw);
        if (!Number.isNaN(v)) total += sign ? v : Math.abs(v);
      }
    }
  }
  return total;
}

function collectMods(itemText: string): string[] {
  try {
    const parsed = parseItemText(itemText);
    return parsed ? parsed.mods.map((m) => m.text) : [];
  } catch {
    return [];
  }
}

/**
 * Защиты одного предмета снаряжения: плоские (+base) вклады, резисты, блок и
 * «% increased» по категориям. Компаунд «% increased» НЕ применяется здесь —
 * он глобальный (моды со всех слотов влияют на общий пул), поэтому его честно
 * показывать отдельно (см. mergeGearDefenses, defenseBreakdownBySlot).
 */
export interface SlotDefense {
  /** Слот (Helm, BodyArmour, …). */
  slot: string;
  /** Имя предмета (если известно). */
  name: string;
  /** Пусто: клир-текста нет/слишком короткий — статы не вошли в оценку. */
  empty: boolean;
  /** Плоские жизни/ES/брони/уклонения (до «% increased»). */
  life: number;
  energyShield: number;
  armour: number;
  evasion: number;
  /** Шанс блока (base или мода, максимум по предмету). */
  blockChance: number;
  fireRes: number;
  coldRes: number;
  lightningRes: number;
  chaosRes: number;
  /** «% increased» к пулу (применяется к суммарному, не к этому слоту). */
  percentMods: { life: number; energyShield: number; armour: number; evasion: number };
}

/** Посчитать защиты ОДНОГО предмета (без компаунда «% increased»). */
export function defenseForItem(item: BuildGearItem): SlotDefense {
  const s: SlotDefense = {
    slot: item.slot,
    name: item.name,
    empty: !item.itemText || item.itemText.trim().length < 10,
    life: 0,
    energyShield: 0,
    armour: 0,
    evasion: 0,
    blockChance: 0,
    fireRes: 0,
    coldRes: 0,
    lightningRes: 0,
    chaosRes: 0,
    percentMods: { life: 0, energyShield: 0, armour: 0, evasion: 0 },
  };
  if (s.empty) return s;
  let parsed = null;
  try {
    parsed = parseItemText(item.itemText);
  } catch {
    parsed = null;
  }
  const mods: string[] = parsed ? parsed.mods.map((m) => m.text) : collectMods(item.itemText);

  if (parsed) {
    s.armour += parsed.defences.armour?.value ?? 0;
    s.evasion += parsed.defences.evasion?.value ?? 0;
    s.energyShield += parsed.defences.energyShield?.value ?? 0;
    s.blockChance = Math.max(s.blockChance, parsed.defences.blockChance?.value ?? 0);
  }
  // «% increased» — применяем к уже собранным плоским значениям ниже.
  s.percentMods.life += sumModValues(mods, new RegExp(`${PCT}% increased maximum Life`));
  s.percentMods.energyShield += sumModValues(mods, new RegExp(`${PCT}% increased(?: maximum)? Energy Shield`));
  s.percentMods.armour += sumModValues(mods, new RegExp(`${PCT}% increased Armour`));
  s.percentMods.evasion += sumModValues(
    mods,
    new RegExp(`${PCT}% increased (?:Evasion Rating|Evasion and Armour|Armour and Evasion)`),
  );
  // Учитываем моды «increased Evasion and Armour» в обоих полях (дубль выше по классу),
  // поэтому отдельно evasion-and-armour не добавляем второй раз к evasion.
  const flatLife = sumModValues(mods, /(?:\+(\d+) to (?:maximum )?Life|\+(\d+) Life)/);
  s.life += flatLife;
  s.energyShield += sumModValues(mods, new RegExp(`\\+${PCT} to maximum Energy Shield`));
  s.armour += sumModValues(mods, new RegExp(`\\+${PCT} (?:to )?Armour($|[^A-Za-z])`));
  s.evasion += sumModValues(mods, new RegExp(`\\+${PCT} (?:to )?Evasion Rating`));
  s.blockChance = Math.max(
    s.blockChance,
    sumModValues(mods, new RegExp(`${PCT}% (?:additional )?chance to Block`)),
  );

  const eleAll = sumModValues(mods, new RegExp(`\\+${SIGNED}% to all Elemental Resistances`), true);
  s.fireRes += eleAll;
  s.coldRes += eleAll;
  s.lightningRes += eleAll;
  for (const mm of mods) {
    const r = new RegExp(`\\+${SIGNED}%\\s+to\\s+(Fire|Cold|Lightning|Chaos)\\s+Resistance`, 'g');
    let m: RegExpExecArray | null;
    while ((m = r.exec(mm))) {
      const v = parseFloat(m[1]);
      if (Number.isNaN(v)) continue;
      switch (m[2]) {
        case 'Fire': s.fireRes += v; break;
        case 'Cold': s.coldRes += v; break;
        case 'Lightning': s.lightningRes += v; break;
        case 'Chaos': s.chaosRes += v; break;
        default: break;
      }
    }
    // формат «Fire Resistance +12%»
    const alt = new RegExp(`(Fire|Cold|Lightning|Chaos) Resistance +${SIGNED}%`);
    const am = alt.exec(mm);
    if (am) {
      const v = parseFloat(am[2]);
      if (!Number.isNaN(v)) {
        if (am[1] === 'Fire') s.fireRes += v;
        else if (am[1] === 'Cold') s.coldRes += v;
        else if (am[1] === 'Lightning') s.lightningRes += v;
        else s.chaosRes += v;
      }
    }
  }
  return s;
}

/**
 * По-слотная разбивка защиты (P1 #7): что даёт каждый слот снаряжения.
 * Возвращает плоские вклады по каждому предмету (до «% increased») — честный
 * ответ на «откуда цифра?». Компаунд «% increased» показывается отдельно и
 * применяется к суммарному пулу, а не к отдельному слоту.
 */
export function defenseBreakdownBySlot(
  gear: Record<string, string> | BuildGearItem[],
): SlotDefense[] {
  const items: BuildGearItem[] = Array.isArray(gear)
    ? gear
    : Object.entries(gear).map(([slot, itemText]) => ({ slot, name: '', itemText }));
  return items.map((it) => defenseForItem(it));
}

/**
 * Свести защиты из списка предметов билда.
 * Плоские значения — из блоков Defences/itemText; резисты и «increased» — по
 * регулярным выражениям из модов. Оценка ПРИБЛИЖЁННАЯ: дерево пассивок и
 * асценданси не учитываются (нет данных).
 */
export function mergeGearDefenses(gear: BuildGearItem[]): EstimatedDefenses {
  const d: EstimatedDefenses = {
    life: 0,
    energyShield: 0,
    armour: 0,
    evasion: 0,
    blockChance: 0,
    fireRes: 0,
    coldRes: 0,
    lightningRes: 0,
    chaosRes: 0,
    emptySlots: 0,
    percentMods: { life: 0, energyShield: 0, armour: 0, evasion: 0 },
  };
  let empty = 0;
  for (const item of gear) {
    const s = defenseForItem(item);
    if (s.empty) {
      empty += 1;
      continue;
    }
    d.life += s.life;
    d.energyShield += s.energyShield;
    d.armour += s.armour;
    d.evasion += s.evasion;
    // Блок — максимум по слотам (не суммируется).
    d.blockChance = Math.max(d.blockChance, s.blockChance);
    d.fireRes += s.fireRes;
    d.coldRes += s.coldRes;
    d.lightningRes += s.lightningRes;
    d.chaosRes += s.chaosRes;
    d.percentMods.life += s.percentMods.life;
    d.percentMods.energyShield += s.percentMods.energyShield;
    d.percentMods.armour += s.percentMods.armour;
    d.percentMods.evasion += s.percentMods.evasion;
  }
  d.emptySlots = empty;
  // Применяем увеличенные % к плоским значениям (компаунд-приближение).
  const apply = (flat: number, pct: number) => (pct ? flat * (1 + pct / 100) : flat);
  d.life = apply(d.life, d.percentMods.life);
  d.energyShield = apply(d.energyShield, d.percentMods.energyShield);
  d.armour = apply(d.armour, d.percentMods.armour);
  d.evasion = apply(d.evasion, d.percentMods.evasion);
  d.blockChance = Math.min(d.blockChance, DEFENSE_CONSTANTS.BLOCK_MAX_CHANCE);
  // Базовый «халявный» резерв: у персонажа есть жизнь с уровней — избегаем нуля.
  if (d.life <= 0) d.life = 100;
  return d;
}

/** Разбивка источников «% increased» по слотам (для отчёта «откуда бонус»). */
export function percentModsBySlot(gear: Record<string, string> | BuildGearItem[]): Array<{ slot: string; type: string; value: number }> {
  const rows: Array<{ slot: string; type: string; value: number }> = [];
  for (const s of defenseBreakdownBySlot(gear)) {
    const p = s.percentMods;
    if (p.life) rows.push({ slot: s.slot || s.name, type: 'Life', value: p.life });
    if (p.energyShield) rows.push({ slot: s.slot || s.name, type: 'Energy Shield', value: p.energyShield });
    if (p.armour) rows.push({ slot: s.slot || s.name, type: 'Armour', value: p.armour });
    if (p.evasion) rows.push({ slot: s.slot || s.name, type: 'Evasion', value: p.evasion });
  }
  return rows;
}

// ─── Многослойный EHP ────────────────────────────────────────────────────────

export type DamageTypeKind = 'physical' | 'fire' | 'cold' | 'lightning' | 'chaos';

/** Разбор EHP по одному типу урона. */
export interface EhpResult {
  damageType: DamageTypeKind;
  rawHp: number;
  evadeMitigation: number; // 0..1
  blockMitigation: number; // 0..1
  armorDr: number; // 0..1 (только physical)
  resistanceDr: number; // 0..1
  totalMitigation: number; // 0..1
  effectiveHp: number;
}

/** EHP по одному типу урона (слои перемножаются, хаос съедает ES ×2). */
export function calculateEhp(d: EstimatedDefenses, damageType: DamageTypeKind, threat: ThreatProfile = DEFAULT_THREAT): EhpResult {
  const rawHp =
    damageType === 'chaos' ? d.life + d.energyShield / 2 : d.life + d.energyShield;
  const evade = d.evasion > 0 ? 1 - hitChance(d.evasion, threat.attackerAccuracy) / 100 : 0;
  const block = d.blockChance > 0 ? d.blockChance / 100 : 0;
  const armor = damageType === 'physical' ? armorDr(d.armour, threat.expectedHitSize) / 100 : 0;
  const resValue =
    damageType === 'fire' ? d.fireRes
    : damageType === 'cold' ? d.coldRes
    : damageType === 'lightning' ? d.lightningRes
    : damageType === 'chaos' ? d.chaosRes
    : 0;
  // Отрицательный резист УСИЛИВАЕТ урон: DR отрицательный.
  const res = resValue / 100;
  const mult = (1 - evade) * (1 - block) * (1 - armor) * (1 - res);
  const totalMitigation = 1 - mult;
  const effectiveHp = mult > 0 ? rawHp / mult : Infinity;
  return { damageType, rawHp, evadeMitigation: evade, blockMitigation: block, armorDr: armor, resistanceDr: res, totalMitigation, effectiveHp };
}

/** EHP по всем пяти типам урона. */
export function calculateAllEhp(d: EstimatedDefenses, threat: ThreatProfile = DEFAULT_THREAT): Record<DamageTypeKind, EhpResult> {
  const out = {} as Record<DamageTypeKind, EhpResult>;
  for (const t of ['physical', 'fire', 'cold', 'lightning', 'chaos'] as DamageTypeKind[]) {
    out[t] = calculateEhp(d, t, threat);
  }
  return out;
}

// ─── Слабые места защиты (порты проверок ehp_calculator.identify_defense_gaps) ──

/** Найденная слабость защиты. */
export interface DefenseGap {
  type: string;
  /** 0–10, 10 — критично. */
  severity: number;
  description: string;
  recommendation: string;
}

export function identifyDefenseGaps(d: EstimatedDefenses, threat: ThreatProfile = DEFAULT_THREAT): DefenseGap[] {
  const gaps: DefenseGap[] = [];
  const res: Array<[string, number]> = [
    ['fire', d.fireRes],
    ['cold', d.coldRes],
    ['lightning', d.lightningRes],
    ['chaos', d.chaosRes],
  ];
  for (const [name, value] of res) {
    if (value < DEFENSE_CONSTANTS.RESISTANCE_CAP) {
      const deficit = DEFENSE_CONSTANTS.RESISTANCE_CAP - value;
      let severity = Math.min(10, deficit / 10);
      if (name === 'chaos') severity *= 0.5;
      gaps.push({
        type: `uncapped_${name}_resistance`,
        severity,
        description: `${name} resistance ${value.toFixed(0)}% — ниже капа ${DEFENSE_CONSTANTS.RESISTANCE_CAP}% (не хватает ${deficit.toFixed(0)}%)`,
        recommendation: `Поднять ${name} resist на ${deficit.toFixed(0)}% (капы на гире/дереве)`,
      });
    }
  }
  const totalHp = d.life + d.energyShield;
  if (totalHp < 3000) {
    gaps.push({
      type: 'low_hp_pool',
      severity: Math.min(10, (3000 - totalHp) / 500),
      description: `Суммарный пул HP ${totalHp.toFixed(0)} ниже рекомендуемого минимума 3000 для эндгейма`,
      recommendation: `Добавить ${Math.round(3000 - totalHp)} жизни/ES`,
    });
  }
  const layers = (d.armour >= 5000 ? 1 : 0) + (d.evasion >= 3000 ? 1 : 0) + (d.blockChance >= 20 ? 1 : 0) + (d.energyShield >= 500 ? 1 : 0);
  if (layers === 0) {
    gaps.push({
      type: 'no_layered_defenses',
      severity: 8,
      description: 'Нет слоёв защиты кроме HP (ни брони, ни уклонения, ни блока, ни ES)',
      recommendation: 'Взять хотя бы один слой: броня / уклонение / блок / ES',
    });
  } else if (layers === 1) {
    gaps.push({
      type: 'single_defense_layer',
      severity: 4,
      description: 'Только один слой защиты',
      recommendation: 'Добавить второй слой для выживаемости',
    });
  }
  if (d.armour > 0 && armorDr(d.armour, 5000) < 30) {
    gaps.push({
      type: 'armor_ineffective_vs_large_hits',
      severity: 5,
      description: `Броня ${d.armour.toFixed(0)} даёт лишь ${armorDr(d.armour, 5000).toFixed(1)}% DR против больших ударов (5000)`,
      recommendation: 'Дополнить броню другими защитами от ваншотов',
    });
  }
  if (d.chaosRes < 0) {
    gaps.push({
      type: 'negative_chaos_resistance',
      severity: Math.min(6, Math.abs(d.chaosRes) / 20),
      description: `Отрицательный хаос-резист (${d.chaosRes.toFixed(0)}%) усиливает хаос-урон`,
      recommendation: `Поднять chaos res на ${Math.abs(d.chaosRes).toFixed(0)}% хотя бы до 0`,
    });
  }
  return gaps.sort((a, b) => b.severity - a.severity);
}

// ─── DPS оружия (грубая оценка) ──────────────────────────────────────────────

/** Грубая DPS-оценка по оружию из билда (без дерева/гемов — только сам предмет). */
export function estimateWeaponDps(gear: BuildGearItem[]): { weapon: string | null; physDps: number; elementalDps: number; attacksPerSecond: number; totalDps: number } {
  const weapons = gear.filter((g) => /weapon/i.test(g.slot ?? '') || /weapon/i.test(g.name ?? ''));
  let best: { name: string | null; pdps: number; edps: number; aps: number } | null = null;
  for (const w of weapons) {
    if (!w.itemText || w.itemText.trim().length < 10) continue;
    try {
      const p = parseItemText(w.itemText);
      if (!p) continue;
      const phys = p.offense.physicalDamage;
      const pdps = phys ? ((phys.min + phys.max) / 2) * (p.offense.attacksPerSecond?.value ?? 1) : 0;
      const edps =
        p.offense.elementalDamage.reduce((acc, e) => acc + ((e.min + e.max) / 2) * (p.offense.attacksPerSecond?.value ?? 1), 0);
      const aps = p.offense.attacksPerSecond?.value ?? 0;
      if (!best || pdps + edps > best.pdps + best.edps) {
        best = { name: p.name ?? p.baseType, pdps, edps, aps };
      }
    } catch {
      /* пропускаем непонятные предметы */
    }
  }
  return {
    weapon: best?.name ?? null,
    physDps: Math.round(best?.pdps ?? 0),
    elementalDps: Math.round(best?.edps ?? 0),
    attacksPerSecond: best?.aps ?? 0,
    totalDps: Math.round((best?.pdps ?? 0) + (best?.edps ?? 0)),
  };
}

// ─── Полная оценка билда ────────────────────────────────────────────────────

/** Итоговая оценка билда. */
export interface BuildEstimate {
  /** Откуда числа: gear — только наш расчёт; pob+gear — есть и PlayerStat из PoB. */
  source: 'gear' | 'pob+gear';
  characterLevel: number | null;
  className: string | null;
  ascendancy: string | null;
  /** PlayerStat из PoB (если игрок открывал билд в PoB). */
  pobStats: Record<string, number>;
  defenses: EstimatedDefenses;
  ehp: Record<DamageTypeKind, EhpResult>;
  worstEhp: { damageType: DamageTypeKind; effectiveHp: number } | null;
  gaps: DefenseGap[];
  weapon: ReturnType<typeof estimateWeaponDps>;
  /** Честные предупреждения о приближениях. */
  notes: string[];
}

/**
 * Приближённая оценка билда: PoB share-код / XML / уже извлечённый gear.
 * EHP по слоям защиты + слабые места + DPS оружия.
 */
export async function estimateBuild(input: string | BuildGearItem[], threat: ThreatProfile = DEFAULT_THREAT): Promise<BuildEstimate> {
  let gear: BuildGearItem[];
  let xml: string | null = null;
  if (Array.isArray(input)) {
    gear = input;
  } else {
    const raw = input.trim();
    xml = raw.startsWith('<') ? raw : await toXml(raw);
  }

  let pobStats: Record<string, number> = {};
  let characterLevel: number | null = null;
  let className: string | null = null;
  let ascendancy: string | null = null;
  if (xml) {
    for (const m of xml.matchAll(/<PlayerStat stat="([^"]+)" value="([\d.-]+)"\/>/g)) {
      pobStats[m[1]!] = parseFloat(m[2]!);
    }
    const buildTag = /<Build\b([^>]*)>/.exec(xml);
    if (buildTag) {
      const attrs = buildTag[1]!;
      const lvl = /level="(\d+)"/.exec(attrs);
      if (lvl) characterLevel = parseInt(lvl[1]!, 10);
      const cls = /className="([^"]+)"/.exec(attrs);
      if (cls) className = cls[1]!;
      const asc = /ascendClassName="([^"]+)"/.exec(attrs);
      if (asc) ascendancy = asc[1]!;
    }
    gear = await buildCodeToGear(xml);
  } else {
    gear = (input as BuildGearItem[]);
  }

  const defenses = mergeGearDefenses(gear);
  const ehp = calculateAllEhp(defenses, threat);
  let worstEhp: BuildEstimate['worstEhp'] = null;
  for (const t of Object.keys(ehp) as DamageTypeKind[]) {
    if (ehp[t].effectiveHp !== Infinity && (!worstEhp || ehp[t].effectiveHp < worstEhp.effectiveHp)) {
      worstEhp = { damageType: t, effectiveHp: ehp[t].effectiveHp };
    }
  }
  const gaps = identifyDefenseGaps(defenses, threat);
  const weapon = estimateWeaponDps(gear);

  const notes: string[] = [
    'Оценка ПРИБЛИЖЁННАЯ: учитывается только снаряжение (плоские статы + моды гира).',
    'Дерево пассивок, асcенданси, гемы, заряды и ауры НЕ учитываются — реальные числа выше.',
  ];
  if (defenses.emptySlots > 0) notes.push(`Слотов без клир-текста: ${defenses.emptySlots} — их статы не вошли в оценку.`);
  if (Object.keys(pobStats).length > 0) notes.push('Найдены PlayerStat из PoB — они точнее геар-оценки (см. pobStats).');
  if (weapon.weapon === null) notes.push('Оружие не распознано — DPS не оценён.');

  return {
    source: Object.keys(pobStats).length > 0 ? 'pob+gear' : 'gear',
    characterLevel,
    className,
    ascendancy,
    pobStats,
    defenses,
    ehp,
    worstEhp,
    gaps,
    weapon,
    notes,
  };
}
