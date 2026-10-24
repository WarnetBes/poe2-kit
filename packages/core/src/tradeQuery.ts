/**
 * Построитель запросов к официальному trade API PoE2 (trade2).
 *
 * Функциональный порт TradeQueryBuilder из _research/pob2-mcp/src/services/
 * tradeQueryBuilder.ts в удобные для нас чистые функции (копирование разрешено
 * автором исследования). Сокеты/линки выброшены — в PoE2 их нет.
 *
 * Две главные точки входа:
 *  - buildTradeQuery(filterы) → JSON-запрос для POST /api/trade2/search/{league}
 *  - modsToStatFilters(modTexts) → stat-фильтры из модов предмета
 *    (маппинг текст→stat id через псевдо-статы trade и явные известные id).
 */

import { parseItemText } from './parse.js';
import { httpJson } from './http.js';
import { resolveLeague } from './trade.js';
import { ruToEnBase, ruToEnName } from './ruLocale.js';

// ─── Типы запроса trade2 ────────────────────────────────────────────────────

export interface StatFilter {
  id: string;
  disabled?: boolean;
  value?: { min?: number; max?: number };
}

export interface StatFilterGroup {
  type: 'and' | 'or' | 'count' | 'weight';
  /** Для type='count'/'weight'. */
  value?: number;
  filters: StatFilter[];
}

export interface TradeQueryFilters {
  type_filters?: { filters?: Record<string, { option?: string; min?: number; max?: number }> };
  trade_filters?: { filters?: Record<string, { option?: string; min?: number; max?: number }> };
  /** Группа обороны/урона trade2: ar, ev, es, dps, pdps, edps (живой /api/trade2/data/filters). */
  equipment_filters?: { filters?: Record<string, { min?: number; max?: number }> };
}

export interface TradeQueryPayload {
  query: {
    status: { option: 'available' | 'online' | 'onlineleague' | 'any' };
    name?: string;
    type?: string;
    term?: string;
    filters?: TradeQueryFilters;
    stats?: StatFilterGroup[];
  };
  sort?: Record<string, 'asc' | 'desc'>;
  /**
   * Служебное поле (НЕ отправляется в trade2 — вырезается в searchTradeQuery):
   * true — RU-база успешно канонизирована в EN; false — RU-база осталась сырой
   * (словарь промахнулся); отсутствует — RU не было / baseType не задан.
   */
  baseTypeResolved?: boolean;
}

/** Высокоуровневые фильтры для сборки запроса. */
export interface TradeQueryInput {
  name?: string;
  /** Базовый тип или категория ('ring', 'boots', 'staff', ...). */
  type?: string;
  term?: string;
  online?: 'available' | 'online' | 'onlineleague' | 'any';
  rarity?: 'normal' | 'magic' | 'rare' | 'unique';
  itemLevelMin?: number;
  priceMin?: number;
  priceMax?: number;
  /** Оборонные фильтры (equipment_filters). */
  armourMin?: number;
  armourMax?: number;
  evasionMin?: number;
  evasionMax?: number;
  esMin?: number;
  esMax?: number;
  /** DPS-фильтры (equipment_filters). */
  dpsMin?: number;
  dpsMax?: number;
  pdpsMin?: number;
  pdpsMax?: number;
  edpsMin?: number;
  edpsMax?: number;
  /** Готовые stat-фильтры (id+min/max) — добавляются группой 'and'. */
  stats?: Array<{ id: string; min?: number; max?: number }>;
  sort?: 'price_asc' | 'price_desc';
}

/** Маппинг коротких категорий → опции trade2 type_filters.category. */
export const TRADE_CATEGORY_MAP: Record<string, string> = {
  boots: 'armour.boots',
  gloves: 'armour.gloves',
  helmet: 'armour.helmet',
  helmetes: 'armour.helmet',
  'body armour': 'armour.chest',
  'body armours': 'armour.chest',
  chest: 'armour.chest',
  shield: 'armour.shield',
  quiver: 'armour.quiver',
  ring: 'accessory.ring',
  rings: 'accessory.ring',
  amulet: 'accessory.amulet',
  amulets: 'accessory.amulet',
  belt: 'accessory.belt',
  belts: 'accessory.belt',
  jewel: 'jewel',
  flask: 'flask',
  flasks: 'flask',
  bow: 'weapon.bow',
  crossbow: 'weapon.crossbow',
  claw: 'weapon.claw',
  dagger: 'weapon.dagger',
  wand: 'weapon.wand',
  staff: 'weapon.staff',
  'warstaff': 'weapon.warstaff',
  sceptre: 'weapon.sceptre',
  mace: 'weapon.mace',
  'one hand sword': 'weapon.onesword',
  'two hand sword': 'weapon.twosword',
  'one hand axe': 'weapon.oneaxe',
  'two hand axe': 'weapon.twoaxe',
  'one hand mace': 'weapon.onemace',
  'two hand mace': 'weapon.twomace',
  'one hand club': 'weapon.oneclub',
  'two hand club': 'weapon.twoclub',
  quarterstaff: 'weapon.warstaff',
};

/**
 * Собрать готовый JSON-запрос trade2 из высокоуровневых фильтров.
 */
export function buildTradeQuery(input: TradeQueryInput): TradeQueryPayload {
  const query: TradeQueryPayload['query'] = {
    status: { option: input.online ?? 'available' },
    filters: {},
  };

  if (input.name) query.name = input.name;
  if (input.term) query.term = input.term;
  if (input.type) {
    const category = TRADE_CATEGORY_MAP[input.type.toLowerCase()];
    if (category) {
      query.filters!.type_filters = {
        filters: { category: { option: category } },
      };
    } else {
      query.type = input.type;
    }
  }

  const tf: Record<string, { option?: string; min?: number; max?: number }> = {};
  if (input.rarity) tf.rarity = { option: input.rarity };
  if (input.itemLevelMin != null) tf.ilvl = { min: input.itemLevelMin };
  const trf: Record<string, { option?: string; min?: number; max?: number }> = {};
  if (input.priceMin != null || input.priceMax != null) {
    trf.price = { min: input.priceMin, max: input.priceMax };
  }
  if (Object.keys(trf).length) query.filters!.trade_filters = { filters: trf };

  // ВАЖНО (trade2 PoE2, проверено живым GET /api/trade2/data/filters 24.10.2026):
  // групп weapon_filters и armour_filters НЕ СУЩЕСТВУЕТ → 400 "Unknown filter
  // group". ВСЕ числовые фильтры предмета живут в equipment_filters:
  // damage, aps, crit, dps, pdps, edps, ar, ev, es, ward, block, spirit, ...
  // В type_filters остаются только category, rarity, ilvl, quality.
  const ef: Record<string, { min?: number; max?: number }> = {};
  if (input.armourMin != null || input.armourMax != null) ef.ar = { min: input.armourMin, max: input.armourMax };
  if (input.evasionMin != null || input.evasionMax != null) ef.ev = { min: input.evasionMin, max: input.evasionMax };
  if (input.esMin != null || input.esMax != null) ef.es = { min: input.esMin, max: input.esMax };
  if (input.dpsMin != null || input.dpsMax != null) ef.dps = { min: input.dpsMin, max: input.dpsMax };
  if (input.pdpsMin != null || input.pdpsMax != null) ef.pdps = { min: input.pdpsMin, max: input.pdpsMax };
  if (input.edpsMin != null || input.edpsMax != null) ef.edps = { min: input.edpsMin, max: input.edpsMax };
  if (Object.keys(ef).length) query.filters!.equipment_filters = { filters: ef };

  if (Object.keys(tf).length) query.filters!.type_filters = { filters: { ...tf, ...(query.filters!.type_filters?.filters ?? {}) } };

  if (input.stats?.length) {
    query.stats = [
      {
        type: 'and',
        filters: input.stats.map((s) => ({ id: s.id, value: { min: s.min, max: s.max } })),
      },
    ];
  }

  const payload: TradeQueryPayload = { query };
  if (input.sort === 'price_desc') payload.sort = { price: 'desc' };
  else payload.sort = { price: 'asc' };
  return payload;
}

// ─── Маппинг «текст мода → stat id trade2» ──────────────────────────────────

/**
 * Известные stat-id официального trade API PoE2 (pseudo-статы для итоговых
 * значений + явные хэши популярных модов). Пополнение по мере сбора.
 * Строки-паттерны: '#' — число.
 *
 * Все explicit-id ниже проверены живыми запросами trade2 (патч 0.5,
 * лига Forbidden Rites) через /api/trade2/data/stats и POST /search.
 * Для weapon-модов (локальные "increased Physical Damage", "Attack Speed (Local)",
 * flat phys) id зависит от домена — выбор через opts.weapon.
 */
export const MOD_TEXT_TO_STAT: Array<{
  pattern: RegExp;
  id: string | ((weapon: boolean) => string);
  label: string;
}> = [
  // Плоские значения → pseudo-итоги (порядок важен: сначала flat, потом процентные).
  { pattern: /\d+ to maximum Life/, id: 'pseudo.pseudo_total_life', label: 'Life (flat)' },
  { pattern: /\d+ to (?:maximum )?Energy Shield/, id: 'pseudo.pseudo_total_energy_shield', label: 'Energy Shield (flat)' },
  { pattern: /to (?:Armour|Armour Rating)/, id: 'pseudo.pseudo_total_armour', label: 'Armour' },
  { pattern: /to (?:Evasion Rating|Evasion)/, id: 'pseudo.pseudo_total_evasion_rating', label: 'Evasion' },
  { pattern: /to Fire Resistance/, id: 'pseudo.pseudo_total_fire_resistance', label: 'Fire Res' },
  { pattern: /to Cold Resistance/, id: 'pseudo.pseudo_total_cold_resistance', label: 'Cold Res' },
  { pattern: /to Lightning Resistance/, id: 'pseudo.pseudo_total_lightning_resistance', label: 'Lightning Res' },
  { pattern: /to Chaos Resistance/, id: 'pseudo.pseudo_total_chaos_resistance', label: 'Chaos Res' },
  { pattern: /to all Elemental Resistances/, id: 'pseudo.pseudo_total_elemental_resistance', label: 'All Ele Res' },
  { pattern: /\+\d+ to Spirit/, id: 'pseudo.pseudo_total_spirit', label: 'Spirit' },
  { pattern: /to Strength/, id: 'pseudo.pseudo_total_strength', label: 'Strength' },
  { pattern: /to Dexterity/, id: 'pseudo.pseudo_total_dexterity', label: 'Dexterity' },
  { pattern: /to Intelligence/, id: 'pseudo.pseudo_total_intelligence', label: 'Intelligence' },
  // Проценты/урон/скорость — явные explicit-id (проверены живыми запросами).
  { pattern: /% increased (?:maximum )?Energy Shield/, id: 'explicit.stat_2482852589', label: 'Energy Shield %' },
  { pattern: /Adds [\d.]+ to [\d.]+ Physical Damage to Attacks/, id: 'explicit.stat_3032590688', label: 'Flat Phys (Attacks)' },
  { pattern: /Adds [\d.]+ to [\d.]+ Physical Damage/, id: (w) => (w ? 'explicit.stat_1940865751' : 'explicit.stat_3032590688'), label: 'Flat Phys' },
  { pattern: /% increased Attack Speed/, id: (w) => (w ? 'explicit.stat_210067635' : 'explicit.stat_681332047'), label: 'Attack Speed' },
  { pattern: /% increased Physical Damage/, id: (w) => (w ? 'explicit.stat_1509134228' : ''), label: 'Physical Damage %' },
  { pattern: /% increased Critical Damage Bonus/, id: 'explicit.stat_3556824919', label: 'Critical Damage Bonus %' },
  { pattern: /% increased Cold Damage/, id: 'explicit.stat_3291658075', label: 'Cold Damage %' },
  { pattern: /% increased Skill Speed/, id: 'explicit.stat_970213192', label: 'Skill Speed %' },
  { pattern: /Gain additional Stun Threshold equal to [\d.]+% of maximum Energy Shield/, id: 'explicit.stat_416040624', label: 'Stun Threshold from ES' },
];

/**
 * Собрать stat-фильтры из модов предмета: каждой распознанной группе —
 * минимальное значение, взятое из этого предмета (минус допуск).
 */
export function modsToStatFilters(
  modTexts: string[],
  opts: { tolerance?: number; weapon?: boolean } = {},
): Array<{ id: string; min?: number; max?: number; label?: string; value?: number }> {
  const tol = opts.tolerance ?? 0; // 0..: насколько ниже значения предмета искать
  const weapon = opts.weapon ?? false;
  const out = new Map<string, { id: string; min: number; label: string; value: number }>();
  for (const text of modTexts) {
    const num = /([+-]?\d+(?:\.\d+)?)/.exec(text);
    if (!num) continue;
    const value = parseFloat(num[1]);
    if (Number.isNaN(value)) continue;
    for (const entry of MOD_TEXT_TO_STAT) {
      if (entry.pattern.test(text)) {
        const id = typeof entry.id === 'function' ? entry.id(weapon) : entry.id;
        if (id && value > 0) {
          const prev = out.get(id);
          const min = Math.max(0, Math.round(value - tol));
          if (!prev || min > prev.min) out.set(id, { id, min, label: entry.label, value });
        }
        break;
      }
    }
  }
  return [...out.values()].map((e) => ({ id: e.id, min: e.min, label: e.label, value: e.value }));
}

// ─── AutoSelect-lite: опции автозаполнения из клир-текста ─────────────────────

/** Явное переопределение одного стата по имени (паттерн Sidekick AutoSelectPreferences). */
export interface ItemStatOverride {
  /**
   * Имя стата. Матчинг по нормализованному тексту (lowercase, без
   * не-буквенно-цифровых символов) против:
   *  - ключей numeric-фильтров и их алиасов: ar/armour, ev/evasion,
   *    es/energy shield, dps/total dps, pdps/physical dps, edps/elemental dps;
   *  - label-ов таблицы MOD_TEXT_TO_STAT ('Fire Res', 'Life (flat)', 'Spirit', ...);
   *  - готовых stat-id ('pseudo.pseudo_total_life', 'explicit.stat_...').
   */
  name: string;
  /** Явный минимум — имеет ПРИОРИТЕТ над tolerance-нормализацией. */
  min?: number;
  /** Явный максимум (для stat-модов; для ar/ev/es/dps — max numeric-фильтра). */
  max?: number;
  /** true — убрать фильтр из запроса совсем. */
  disabled?: boolean;
}

export interface BuildTradeQueryFromItemOptions {
  /**
   * Легаси-допуск: абсолютный вычет из значения каждого распознанного мода
   * (min = value − tolerance). Оставлен для совместимости; при заданном
   * tolerance процентная нормализация модов НЕ применяется.
   */
  tolerance?: number;
  priceMax?: number;
  /**
   * Процентный допуск вниз (AutoSelect-lite,Sidekick normalizeBy): автозаполненные
   * минимумы считаются как floor(value × (100 − tolerancePct)/100).
   * Диапазон 0..50, по умолчанию 20 → фактор 0.8 (прежний хардкод для ar/ev/es;
   * dps/pdps/edps сохраняют исторически больший допуск: фактор − 0.1, т.е. 0.7
   * по умолчанию). Применяется к ar/ev/es/dps всегда; к stat-модам — когда
   * задан явно (иначе моды остаются с точным значением, как раньше).
   */
  tolerancePct?: number;
  /**
   * Явные min/max по имени стата — второй режим AutoSelect-lite (Sidekick
   * issue #1005 исправлен заранее: оба режима совместимы — сначала применяется
   * override, поверх — автозаполнение всего остального).
   */
  statOverrides?: ItemStatOverride[];
}

/** Нормализация имени для матчинга: lowercase, только [a-z0-9]. */
function normStatName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Алиасы numeric-фильтров → ключ equipment_filters. */
const NUMERIC_FILTER_KEYS: Record<string, 'ar' | 'ev' | 'es' | 'dps' | 'pdps' | 'edps'> = {
  ar: 'ar', armour: 'ar', armor: 'ar', armourrating: 'ar',
  ev: 'ev', evasion: 'ev', evasionrating: 'ev',
  es: 'es', energyshield: 'es', maximumenergyshield: 'es',
  dps: 'dps', totaldps: 'dps',
  pdps: 'pdps', physicaldps: 'pdps',
  edps: 'edps', elementaldps: 'edps',
};

/**
 * Собрать trade-запрос из клир-текста предмета: базовый тип/категория,
 * рейтинги защиты/урона как числовые фильтры (equipment_filters), моды как
 * stat-фильтры. Режимы AutoSelect-lite:
 *  1) нормализация: min = floor(value × (100 − tolerancePct)/100);
 *  2) явные statOverrides по имени (приоритет над нормализацией).
 */
export function buildTradeQueryFromItem(itemText: string, opts: BuildTradeQueryFromItemOptions = {}): TradeQueryPayload {
  const parsed = parseItemText(itemText);
  const input: TradeQueryInput = {};

  // №620: RU-клиент Ctrl+C отдаёт кириллические name/baseType, trade2 принимает
  // только EN («Unknown item base type»). Канонизируем офлайн-словарём руЛокали
  // ДО query.type; EN-входы не содержат кириллицу и проходят без изменений.
  // Промах словаря — прежнее поведение (сырая база), флаг baseTypeResolved=false.
  const isRu = (s: string) => /[\u0400-\u04FF]/.test(s);

  if (parsed.name && parsed.rarity === 'Unique') {
    input.name = isRu(parsed.name) ? (ruToEnName(parsed.name) || parsed.name) : parsed.name;
  }
  let ruBaseKeptRaw = false;
  if (parsed.baseType) {
    if (isRu(parsed.baseType)) {
      const en = ruToEnBase(parsed.baseType);
      if (en) input.type = en;
      else { input.type = parsed.baseType; ruBaseKeptRaw = true; }
    } else {
      input.type = parsed.baseType;
    }
  }

  // Автозаполнение numeric-фильтров: процентная нормализация вместо хардкода.
  const tolPct = Math.min(Math.max(opts.tolerancePct ?? 20, 0), 50);
  const defFactor = (100 - tolPct) / 100;
  // dps-фильтры исторически имели допуск 0.7 против 0.8 у защитных — сохраняем пропорцию.
  const dpsFactor = Math.max(0, defFactor - 0.1);

  interface NumVal { auto: number; min?: number; max?: number; disabled?: boolean }
  const num: Partial<Record<'ar' | 'ev' | 'es' | 'dps' | 'pdps' | 'edps', NumVal>> = {};
  if (parsed.defences.armour?.value) num.ar = { auto: Math.floor(parsed.defences.armour.value * defFactor) };
  if (parsed.defences.evasion?.value) num.ev = { auto: Math.floor(parsed.defences.evasion.value * defFactor) };
  if (parsed.defences.energyShield?.value) num.es = { auto: Math.floor(parsed.defences.energyShield.value * defFactor) };

  if (parsed.offense.attacksPerSecond?.value && (parsed.offense.physicalDamage || parsed.offense.elementalDamage.length)) {
    const aps = parsed.offense.attacksPerSecond.value;
    const pdps = parsed.offense.physicalDamage ? ((parsed.offense.physicalDamage.min + parsed.offense.physicalDamage.max) / 2) * aps : 0;
    const edps = parsed.offense.elementalDamage.reduce((a, e) => a + ((e.min + e.max) / 2) * aps, 0);
    if (pdps + edps > 0) {
      num.dps = { auto: Math.floor((pdps + edps) * dpsFactor) };
      if (pdps > 0) num.pdps = { auto: Math.floor(pdps * dpsFactor) };
      if (edps > 0) num.edps = { auto: Math.floor(edps * dpsFactor) };
    }
  }

  // Явные overrides: применяются ПОСЛЕ автозаполнения, ПО ИМЕНИ (режим 2).
  const overrides = opts.statOverrides ?? [];
  for (const o of overrides) {
    const key = NUMERIC_FILTER_KEYS[normStatName(o.name)];
    if (!key) continue; // не numeric — матчится ниже по модам
    if (!num[key]) num[key] = { auto: 0, disabled: true }; // фильтра нет — создать/выключить
    if (o.disabled) num[key]!.disabled = true;
    else {
      if (o.min != null) { num[key]!.min = o.min; num[key]!.disabled = false; }
      if (o.max != null) { num[key]!.max = o.max; num[key]!.disabled = false; }
    }
  }

  if (num.ar && !num.ar.disabled) { input.armourMin = num.ar.min ?? num.ar.auto; if (num.ar.max != null) input.armourMax = num.ar.max; }
  if (num.ev && !num.ev.disabled) { input.evasionMin = num.ev.min ?? num.ev.auto; if (num.ev.max != null) input.evasionMax = num.ev.max; }
  if (num.es && !num.es.disabled) { input.esMin = num.es.min ?? num.es.auto; if (num.es.max != null) input.esMax = num.es.max; }
  if (num.dps && !num.dps.disabled) { input.dpsMin = num.dps.min ?? num.dps.auto; if (num.dps.max != null) input.dpsMax = num.dps.max; }
  if (num.pdps && !num.pdps.disabled) { input.pdpsMin = num.pdps.min ?? num.pdps.auto; if (num.pdps.max != null) input.pdpsMax = num.pdps.max; }
  if (num.edps && !num.edps.disabled) { input.edpsMin = num.edps.min ?? num.edps.auto; if (num.edps.max != null) input.edpsMax = num.edps.max; }

  if (parsed.rarity === 'Rare' || parsed.rarity === 'Magic') input.rarity = parsed.rarity.toLowerCase() as 'rare' | 'magic';
  if (opts.priceMax != null) input.priceMax = opts.priceMax;

  // Предмет с уроном/APS — оружие: его моды "increased Physical Damage"/"Attack Speed"
  // локальные, выбор explicit-id зависит от этого флага.
  const isWeapon = !!(num.dps || num.pdps || num.edps);
  const statFilters = modsToStatFilters(parsed.mods.map((m) => m.text), {
    tolerance: opts.tolerance,
    weapon: isWeapon,
  });
  // Процентная нормализация модов: только когда tolerancePct задан явно
  // (легаси-вызовы без опций получают точные значения, как раньше).
  if (opts.tolerancePct != null && opts.tolerance == null) {
    for (const f of statFilters) f.min = Math.max(0, Math.floor((f.value ?? f.min ?? 0) * defFactor));
  }
  // Overrides по модам: по stat-id или label из MOD_TEXT_TO_STAT.
  const overrideApplies = (o: ItemStatOverride, id: string, label: string): boolean => {
    if (o.name === id) return true;
    const n = normStatName(o.name);
    const l = normStatName(label);
    return !!n && (l === n || l.startsWith(n));
  };
  const patched = statFilters
    .map((f) => {
      const o = overrides.find((o) => overrideApplies(o, f.id, f.label ?? ''));
      if (!o) return { id: f.id, min: f.min };
      if (o.disabled) return null; // убран из запроса совсем
      const pf: { id: string; min?: number; max?: number } = { id: f.id };
      pf.min = o.min ?? f.min; // явный min бьёт автозаполнение; без min — прежний автозаполненный
      if (o.max != null) pf.max = o.max;
      return pf;
    })
    .filter((p): p is { id: string; min?: number; max?: number } => p != null);
  if (patched.length) input.stats = patched;

  const payload = buildTradeQuery(input);
  if (ruBaseKeptRaw) payload.baseTypeResolved = false;
  else if (parsed.baseType && input.type && input.type !== parsed.baseType) payload.baseTypeResolved = true;
  return payload;
}

// ─── Выполнение запроса ─────────────────────────────────────────────────────

export interface TradeQueryListing {
  item: { name?: string; typeLine?: string } | null;
  price: { amount: number; currency: string } | null;
  whisper?: string;
  accountName?: string;
  indexed?: string;
}

/**
 * Выполнить trade-запрос: POST /api/trade2/search/{league}, затем fetch
 * первых `limit` листингов. Возвращает цены + имена предметов.
 */
export async function searchTradeQuery(
  payload: TradeQueryPayload,
  opts: { league?: string; limit?: number } = {},
): Promise<{ queryId: string | null; total?: number; listings: TradeQueryListing[]; error?: string }> {
  // trade2 принимает ТОЛЬКО отображаемое имя лиги ("Forbidden Rites" с пробелом),
  // слаги poe.ninja/scout ("forbiddenrites") дают 400 "Invalid query".
  // Резолвим любой ввод через список лиг poe2scout.
  let league = opts.league ?? 'Standard';
  try {
    const resolved = await resolveLeague(league);
    if (resolved?.id) league = resolved.id;
  } catch {
    /* оставляем как есть — API сам ответит ошибкой */
  }
  const limit = Math.min(opts.limit ?? 10, 20);
  try {
    // baseTypeResolved — метаданные для вызывающего, trade2 о нём не знает.
    const { baseTypeResolved: _meta, ...body } = payload;
    const search = await httpJson<{ id?: string; total?: number; result?: string[]; error?: string }>(
      `https://www.pathofexile.com/api/trade2/search/poe2/${encodeURIComponent(league)}`,
      { method: 'POST', body: body as unknown as Record<string, unknown> },
    );
    if (!search?.id) {
      return { queryId: null, listings: [], error: search ? (search as { error?: string }).error ?? 'нет результатов' : 'нет ответа' };
    }
    // fetch принимает ХЭШИ результатов (не id поиска), максимум 10 за раз.
    // №197: чанками по 10 — limit > 10 больше не режется молча.
    const hashListAll = (search.result ?? []).slice(0, limit);
    const listings: TradeQueryListing[] = [];
    for (let i = 0; i < hashListAll.length; i += 10) {
      const hashes = hashListAll.slice(i, i + 10).join(',');
      const fetchRes = await httpJson<{
        result?: Array<{
          item?: { name?: string; typeLine?: string };
          listing?: {
            indexed?: string;
            account?: { name?: string };
            whisper?: string;
            price?: { amount?: number; currency?: string; type?: string };
          };
        } | null>;
      }>(`https://www.pathofexile.com/api/trade2/fetch/${hashes}?query=${search.id}`);
      for (const entry of fetchRes?.result ?? []) {
        if (!entry) continue;
        const p = entry.listing?.price;
        listings.push({
          item: entry.item ? { name: entry.item.typeLine ?? entry.item.name, typeLine: entry.item.typeLine } : null,
          price: p && typeof p.amount === 'number' ? { amount: p.amount, currency: p.currency ?? p.type ?? 'chaos' } : null,
          whisper: entry.listing?.whisper,
          accountName: entry.listing?.account?.name,
          indexed: entry.listing?.indexed,
        });
      }
    }
    return { queryId: search.id, total: search.total, listings };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { queryId: null, listings: [], error: msg };
  }
}
