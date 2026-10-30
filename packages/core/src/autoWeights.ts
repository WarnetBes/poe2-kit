/**
 * W3-1: автовеса статов из экипированного гира — «find upgrades weighted by
 * your build».
 *
 * Idea reference: poe2-upgrade-checker (GPL-3) autoweights.js — НИ СТРОКИ кода
 * не скопировано (№686/№687): перенята только ЭВРИСТИКА (не охраняема):
 *   - «статы, которые ваш гир уже стекает = ваши приоритеты»;
 *   - типичный ролл стата ≈ 30 целевых очков; чем больше слотов его несут,
 *     тем важнее: target = 30 × (1 + 0.5·(слоты−1));
 *   - спец-веса: скорость передвижения (главный стат сапог) — потолок 90,
 *     атрибуты — 45, броня/уклонение — 50; DPS оружия — вне scope этого
 *     модуля (№696 P2-2: нереализованное обещание удалено; веса оружия
 *     считаются в gearscore-профилях);
 *   - уники выбрасываются (их фиксированные моды о приоритетах билда не
 *     говорят); double-count исключён: локальные «% increased …»-моды поверх
 *     базового значения предмета не весятся.
 *
 * Реализация своя: поверх core.parseItemText (RU/EN клир-текст), выход —
 * готовые label-статы для stat_overrides poe2_trade_search.
 */

import { parseItemText } from './parse.js';

export type GearStatKind = 'life' | 'es' | 'spirit' | 'fres' | 'cres' | 'lres' | 'chaores' | 'ms' | 'str' | 'dex' | 'int' | 'armour' | 'evasion';

export interface GearFocus {
  /** Канонический label для stat_overrides trade-поиска. */
  label: string;
  kind: GearStatKind;
  /** Средний ролл по всем предметам, несущим стат. */
  avgValue: number;
  /** Сколько слотов несут стат. */
  slots: number;
  /** Целевые очки важности (30 × мультипликатор, капы по типу). */
  target: number;
  /** Готовый минимум для trade-фильтра = средний ролл (округлён). */
  suggestedMin: number;
}

interface ModPattern {
  re: RegExp;
  kind: GearStatKind;
  label: string;
  /** value → весовые очки (для капов/target-политики). */
  base?: number;
  cap?: number;
}

/** EN + RU шаблоны (RU-клиент — живая боль №680–684, поддержан базовый набор). */
const MOD_PATTERNS: ModPattern[] = [
  { re: /^\+(\d+) to maximum Life$/im, kind: 'life', label: 'Life', base: 30, cap: 60 },
  { re: /^\+(\d+) к максимуму (?:жизни|здоровья)$/im, kind: 'life', label: 'Life', base: 30, cap: 60 },
  { re: /^\+(\d+) to maximum Energy Shield$/im, kind: 'es', label: 'Energy Shield', base: 30, cap: 60 },
  { re: /^\+(\d+) к максимуму энергетического щита$/im, kind: 'es', label: 'Energy Shield', base: 30, cap: 60 },
  { re: /^\+(\d+) to Spirit$/im, kind: 'spirit', label: 'Spirit', base: 30, cap: 60 },
  { re: /^\+(\d+) к духу$/im, kind: 'spirit', label: 'Spirit', base: 30, cap: 60 },
  { re: /^(?:\+)?(\d+)% (?:to|increased) Fire Resistance$/im, kind: 'fres', label: 'Fire Res', base: 30, cap: 60 },
  { re: /^(?:\+)?(\d+)% к сопротивлению огню$/im, kind: 'fres', label: 'Fire Res', base: 30, cap: 60 },
  { re: /^(?:\+)?(\d+)% (?:to|increased) Cold Resistance$/im, kind: 'cres', label: 'Cold Res', base: 30, cap: 60 },
  { re: /^(?:\+)?(\d+)% к сопротивлению холоду$/im, kind: 'cres', label: 'Cold Res', base: 30, cap: 60 },
  { re: /^(?:\+)?(\d+)% (?:to|increased) Lightning Resistance$/im, kind: 'lres', label: 'Lightning Res', base: 30, cap: 60 },
  { re: /^(?:\+)?(\d+)% к сопротивлению молнии$/im, kind: 'lres', label: 'Lightning Res', base: 30, cap: 60 },
  { re: /^(?:\+)?(\d+)% (?:to|increased) Chaos Resistance$/im, kind: 'chaores', label: 'Chaos Res', base: 30, cap: 60 },
  { re: /^(?:\+)?(\d+)% к сопротивлению хаосу$/im, kind: 'chaores', label: 'Chaos Res', base: 30, cap: 60 },
  { re: /^(?:\+)?(\d+)% increased Movement Speed$/im, kind: 'ms', label: 'Movement Speed', base: 30, cap: 90 },
  { re: /^(?:\+)?(\d+)% повышение скорости передвижения$/im, kind: 'ms', label: 'Movement Speed', base: 30, cap: 90 },
  { re: /^\+(\d+) to Strength$/im, kind: 'str', label: 'Str', base: 30, cap: 45 },
  { re: /^\+(\d+) к силе$/im, kind: 'str', label: 'Str', base: 30, cap: 45 },
  { re: /^\+(\d+) to Dexterity$/im, kind: 'dex', label: 'Dex', base: 30, cap: 45 },
  { re: /^\+(\d+) к ловкости$/im, kind: 'dex', label: 'Dex', base: 30, cap: 45 },
  { re: /^\+(\d+) to Intelligence$/im, kind: 'int', label: 'Int', base: 30, cap: 45 },
  { re: /^\+(\d+) к интеллекту$/im, kind: 'int', label: 'Int', base: 30, cap: 45 },
  { re: /^\+(\d+) to Armour$/im, kind: 'armour', label: 'Armour', base: 30, cap: 50 },
  { re: /^\+(\d+) к броне$/im, kind: 'armour', label: 'Armour', base: 30, cap: 50 },
  { re: /^\+(\d+) to Evasion(?: Rating)?$/im, kind: 'evasion', label: 'Evasion', base: 30, cap: 50 },
  { re: /^\+(\d+) к (?:рейтингу )?уклонени(?:я|ю)$/im, kind: 'evasion', label: 'Evasion', base: 30, cap: 50 },
];

/** Локальные %. increased-моды, НЕ весящиеся поверх базовых чисел предмета (double-count). */
const LOCAL_INCREASED = [
  /% increased (?:Armour|Evasion(?: Rating)?|Energy Shield|Armour and Evasion|Armour and Energy Shield|Evasion and Energy Shield)/i,
  /% (?:повышение|увеличение) (?:брони|уклонения|энергетического щита)/i,
];

function isLocalIncreased(mod: string): boolean {
  return LOCAL_INCREASED.some((re) => re.test(mod));
}

/**
 * Предложить веса статов из гира. Вход — клир-тексты экипированных предметов
 * (RU/EN); уники игнорируются (их моды фиксированы и о билде не говорят).
 * Выход отсортирован: больше слотов → выше (стабильный порядок по label).
 */
export function suggestGearFocus(gearTexts: string[]): GearFocus[] {
  // kind → { values: средниероллы по предметам, slots Set }
  const per = new Map<GearStatKind, { values: number[]; slots: number }>();
  for (const text of gearTexts) {
    let item;
    try {
      item = parseItemText(text);
    } catch {
      continue; // не-предмет (мусор в списке) — пропускаем молча
    }
    if (!item?.baseType) continue;
    if (/unique/i.test(item.rarity)) continue; // фиксированные моды уника — не сигнал
    const seenInThis = new Set<GearStatKind>();
    for (const mod of item.mods) {
      if (isLocalIncreased(mod.text)) continue; // double-count поверх [Base]
      for (const p of MOD_PATTERNS) {
        const m = p.re.exec(mod.text);
        if (!m) continue;
        const v = Number(m[1]);
        if (!Number.isFinite(v) || v <= 0) continue;
        const e = per.get(p.kind) ?? { values: [], slots: 0 };
        if (!seenInThis.has(p.kind)) {
          e.slots++;
          seenInThis.add(p.kind);
        }
        e.values.push(v);
        per.set(p.kind, e);
        break;
      }
    }
  }

  const out: GearFocus[] = [];
  for (const p of MOD_PATTERNS) {
    const e = per.get(p.kind);
    if (!e || !e.values.length) continue;
    const avg = e.values.reduce((a, b) => a + b, 0) / e.values.length;
    const cap = p.cap ?? 60;
    const target = Math.min(Math.round((p.base ?? 30) * (1 + 0.5 * Math.max(0, e.slots - 1))), cap);
    // Ошибка реализации №685-класса не повторяем: avg может быть дробным —
    // suggestedMin округляем ВНИЗ до целого (фильтр торгов не примет 74.99).
    out.push({
      label: p.label,
      kind: p.kind,
      avgValue: Math.round(avg * 10) / 10,
      slots: e.slots,
      target,
      suggestedMin: Math.max(1, Math.floor(avg)),
    });
  }
  // Больше слотов → важнее; при равенстве — алфавит (стабильность для тестов).
  out.sort((a, b) => b.slots - a.slots || b.target - a.target || a.label.localeCompare(b.label));
  return out;
}

/**
 * Веса → stat_overrides для poe2_trade_search: по каждому стекаемому стату
 * минимум = средний ролл гира, пропущенный через допуск tolerancePct
 * (по умолчанию 20% — как автозаполнение buildTradeQueryFromItem).
 */
export function gearFocusToOverrides(
  focus: GearFocus[],
  tolerancePct = 20,
): Array<{ name: string; min: number }> {
  const t = Math.min(Math.max(tolerancePct, 0), 50);
  return focus.map((f) => ({
    name: f.label,
    min: Math.max(1, Math.floor((f.suggestedMin * (100 - t)) / 100)),
  }));
}

/**
 * Средний ролл стата per слот для одного предмета (для панели «что искать»).
 * Практично для resist-плана: сколько резиста даёт текущий слот.
 */
export function resistContributions(gearTexts: string[]): Record<'fres' | 'cres' | 'lres' | 'chaores', number[]> {
  const out: Record<'fres' | 'cres' | 'lres' | 'chaores', number[]> = { fres: [], cres: [], lres: [], chaores: [] };
  for (const text of gearTexts) {
    let item;
    try {
      item = parseItemText(text);
    } catch {
      continue;
    }
    if (!item?.baseType) continue;
    const kinds: Array<'fres' | 'cres' | 'lres' | 'chaores'> = ['fres', 'cres', 'lres', 'chaores'];
    const per: Partial<Record<'fres' | 'cres' | 'lres' | 'chaores', number>> = {};
    for (const mod of item.mods) {
      for (const kind of kinds) {
        for (const p of MOD_PATTERNS) {
          if (p.kind !== kind) continue;
          const m = p.re.exec(mod.text);
          if (m) {
            per[kind] = (per[kind] ?? 0) + Number(m[1]);
            break;
          }
        }
      }
    }
    for (const kind of kinds) if (per[kind]) out[kind].push(per[kind]!);
  }
  return out;
}
