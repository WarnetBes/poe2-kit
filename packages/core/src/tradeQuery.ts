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
  weapon_filters?: { filters?: Record<string, { min?: number; max?: number }> };
  armour_filters?: { filters?: Record<string, { min?: number; max?: number }> };
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
  /** Оружейные фильтры. */
  dpsMin?: number;
  pdpsMin?: number;
  edpsMin?: number;
  /** Броневые фильтры. */
  armourMin?: number;
  evasionMin?: number;
  esMin?: number;
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
  if (Object.keys(tf).length) query.filters!.type_filters = { filters: { ...tf, ...(query.filters!.type_filters?.filters ?? {}) } };

  const trf: Record<string, { option?: string; min?: number; max?: number }> = {};
  if (input.priceMin != null || input.priceMax != null) {
    trf.price = { min: input.priceMin, max: input.priceMax };
  }
  if (Object.keys(trf).length) query.filters!.trade_filters = { filters: trf };

  const wf: Record<string, { min?: number; max?: number }> = {};
  if (input.dpsMin != null) wf.dps = { min: input.dpsMin };
  if (input.pdpsMin != null) wf.pdps = { min: input.pdpsMin };
  if (input.edpsMin != null) wf.edps = { min: input.edpsMin };
  if (Object.keys(wf).length) query.filters!.weapon_filters = { filters: wf };

  const af: Record<string, { min?: number; max?: number }> = {};
  if (input.armourMin != null) af.ar = { min: input.armourMin };
  if (input.evasionMin != null) af.ev = { min: input.evasionMin };
  if (input.esMin != null) af.es = { min: input.esMin };
  if (Object.keys(af).length) query.filters!.armour_filters = { filters: af };

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
 */
export const MOD_TEXT_TO_STAT: Array<{ pattern: RegExp; id: string; label: string }> = [
  { pattern: /maximum Life/, id: 'pseudo.pseudo_total_life', label: 'Life' },
  { pattern: /maximum Energy Shield/, id: 'pseudo.pseudo_total_energy_shield', label: 'Energy Shield' },
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
];

/**
 * Собрать stat-фильтры из модов предмета: каждой распознанной группе —
 * минимальное значение, взятое из этого предмета (минус допуск).
 */
export function modsToStatFilters(
  modTexts: string[],
  opts: { tolerance?: number } = {},
): Array<{ id: string; min?: number; max?: number; label?: string; value?: number }> {
  const tol = opts.tolerance ?? 0; // 0..: насколько ниже значения предмета искать
  const out = new Map<string, { id: string; min: number; label: string; value: number }>();
  for (const text of modTexts) {
    const num = /([+-]?\d+(?:\.\d+)?)/.exec(text);
    if (!num) continue;
    const value = parseFloat(num[1]);
    if (Number.isNaN(value)) continue;
    for (const entry of MOD_TEXT_TO_STAT) {
      if (entry.pattern.test(text)) {
        if (value > 0) {
          const prev = out.get(entry.id);
          const min = Math.max(0, Math.round(value - tol));
          if (!prev || min > prev.min) out.set(entry.id, { id: entry.id, min, label: entry.label, value });
        }
        break;
      }
    }
  }
  return [...out.values()].map((e) => ({ id: e.id, min: e.min, label: e.label, value: e.value }));
}

/**
 * Собрать trade-запрос из клир-текста предмета: базовый тип/категория,
 * рейтинги защиты/урона как числовые фильтры, моды как stat-фильтры.
 */
export function buildTradeQueryFromItem(itemText: string, opts: { tolerance?: number; priceMax?: number } = {}): TradeQueryPayload {
  const parsed = parseItemText(itemText);
  const input: TradeQueryInput = {};
  if (parsed.name && parsed.rarity === 'Unique') input.name = parsed.name;
  if (parsed.baseType) input.type = parsed.baseType;

  if (parsed.defences.armour?.value) input.armourMin = Math.round(parsed.defences.armour.value * 0.8);
  if (parsed.defences.evasion?.value) input.evasionMin = Math.round(parsed.defences.evasion.value * 0.8);
  if (parsed.defences.energyShield?.value) input.esMin = Math.round(parsed.defences.energyShield.value * 0.8);

  if (parsed.offense.attacksPerSecond?.value && (parsed.offense.physicalDamage || parsed.offense.elementalDamage.length)) {
    const aps = parsed.offense.attacksPerSecond.value;
    const pdps = parsed.offense.physicalDamage ? ((parsed.offense.physicalDamage.min + parsed.offense.physicalDamage.max) / 2) * aps : 0;
    const edps = parsed.offense.elementalDamage.reduce((a, e) => a + ((e.min + e.max) / 2) * aps, 0);
    if (pdps + edps > 0) {
      input.dpsMin = Math.round((pdps + edps) * 0.7);
      input.pdpsMin = Math.round(pdps * 0.7);
      input.edpsMin = Math.round(edps * 0.7);
    }
  }

  if (parsed.rarity === 'Rare' || parsed.rarity === 'Magic') input.rarity = parsed.rarity.toLowerCase() as 'rare' | 'magic';
  if (opts.priceMax != null) input.priceMax = opts.priceMax;

  const statFilters = modsToStatFilters(parsed.mods.map((m) => m.text), { tolerance: opts.tolerance });
  if (statFilters.length) input.stats = statFilters.map((s) => ({ id: s.id, min: s.min }));

  return buildTradeQuery(input);
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
  const league = opts.league ?? 'Standard';
  const limit = Math.min(opts.limit ?? 10, 20);
  try {
    const search = await httpJson<{ id?: string; total?: number; result?: string[]; error?: string }>(
      `https://www.pathofexile.com/api/trade2/search/poe2/${encodeURIComponent(league)}`,
      { method: 'POST', body: payload as unknown as Record<string, unknown> },
    );
    if (!search?.id) {
      return { queryId: null, listings: [], error: search ? (search as { error?: string }).error ?? 'нет результатов' : 'нет ответа' };
    }
    // fetch принимает ХЭШИ результатов (не id поиска), максимум 10 за раз.
    const hashes = (search.result ?? []).slice(0, Math.min(limit, 10)).join(',');
    if (!hashes) return { queryId: search.id, total: search.total, listings: [] };
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
    const listings: TradeQueryListing[] = [];
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
    return { queryId: search.id, total: search.total, listings };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { queryId: null, listings: [], error: msg };
  }
}
