/**
 * Торговля и цены: бесплатные публичные источники (проверенные endpoint'ы).
 *  - poe.ninja PoE2 Economy API — курсы валют / обмен
 *  - poe2scout — цены уникальных предметов (единая категория), которые poe.ninja не покрывает
 *  - официальный trade2 API — поиск объявлений (без авторизации, базовый)
 * Никогда не скрейпим сайт торговли и не требуем учётку.
 */

import { httpJson } from './http.js';
import type {
  CurrencyRate,
  League,
  PriceCheckResult,
  PriceEstimate,
  TradeListing,
} from './types.js';

const NINJA_EXCHANGE = 'https://poe.ninja/poe2/api/economy/exchange/current/overview';
const SCOUT_UNIQUE = 'https://poe2scout.com/api/items/unique';
const TRADE_API = 'https://www.pathofexile.com/api/trade2';

/** Актуальные лиги Path of Exile 2. */
export const KNOWN_LEAGUES: League[] = [
  { id: 'Runes of Aldur', name: 'Runes of Aldur' },
  { id: 'Rise of the Abyssal', name: 'Rise of the Abyssal' },
  { id: 'Dawn of the Hunt', name: 'Dawn of the Hunt' },
  { id: 'Standard', name: 'Standard (PoE2)' },
];

let currentLeague: string | null = null;

/** Установить активную лигу (например, "Runes of Aldur"). */
export function setLeague(league: string | null): void {
  currentLeague = league;
}

export function getLeague(): string | null {
  return currentLeague;
}

// Совместно используемые кэши снапшотов цен (приём из Exiled-Exchange-2):
// вместо точечных запросов на каждый предмет — один раз качаем полный снапшот
// и работаем из памяти с TTL. Это резко снижает нагрузку на рейт-лимит poe.ninja.

const NINJA_TTL = 5 * 60 * 1000; // 5 минут — цена устаревает быстро
const ninjaCache = new Map<
  string,
  { at: number; rates: CurrencyRate[] }
>();

// ─── poe.ninja Exchange ─────────────────────────────────────────────────

interface NinjaExchangeResponse {
  core?: {
    items?: Array<{ id: string; name: string }>;
    rates?: Record<string, number>;
    primary?: string;
    secondary?: string;
  };
  lines?: Array<{ id: string; primaryValue: number; sparkline?: { totalChange: number } }>;
}

/**
 * Получить курсы валют (тип Currency) из poe.ninja PoE2 Economy API.
 * Возвращает цену каждой валюты в Chaos Orbs.
 */
export async function fetchCurrencyRates(league?: string): Promise<CurrencyRate[]> {
  const l = league ?? currentLeague ?? 'Runes of Aldur';
  // Снапшот из кэша, если ещё свеж.
  const hit = ninjaCache.get(l);
  if (hit && Date.now() - hit.at < NINJA_TTL) return hit.rates;

  const url = `${NINJA_EXCHANGE}?league=${encodeURIComponent(l)}&type=${encodeURIComponent('Currency')}`;
  const data = await httpJson<NinjaExchangeResponse>(url);

  const core = data.core;
  if (!core?.items || !core.rates) return [];

  const chaosRate = core.rates[core.secondary ?? ''] ?? 1;
  const idToName = new Map(core.items.map((it) => [it.id, it.name]));

  const rates: CurrencyRate[] = [];
  for (const line of data.lines ?? []) {
    const name = idToName.get(line.id) ?? line.id;
    rates.push({
      name,
      chaosValue: line.primaryValue * chaosRate,
      divineValue: null,
      source: 'poe.ninja',
      updatedAt: Date.now(),
    });
  }
  ninjaCache.set(l, { at: Date.now(), rates });
  return rates;
}

/** Принудительно сбросить кэш курсов (например, при смене лиги или через UI). */
export function clearRatesCache(): void {
  ninjaCache.clear();
}

// ─── poe2scout Uniques ──────────────────────────────────────────────────

type ScoutCategory = 'armour' | 'weapon' | 'accessory' | 'jewel' | 'flask';

interface ScoutItem {
  id: number;
  name: string;
  type: string;
  categoryApiId: string;
  currentPrice: number | null;
  priceLogs: Array<{ price: number; time: string; quantity: number } | null>;
}

interface ScoutResponse {
  items: ScoutItem[];
}

/** Маппинг item class строки → категория poe2scout. */
export function mapItemClassToScoutCategory(itemClass: string): ScoutCategory | null {
  if (/body armour|helmet|glove|boot|shield|quiver|focus/i.test(itemClass)) return 'armour';
  if (/bow|stave|staff|wand|sceptre|mace|sword|axe|claw|dagger|flail|spear|crossbow/i.test(itemClass)) {
    return 'weapon';
  }
  if (/ring|amulet|belt/i.test(itemClass)) return 'accessory';
  if (/jewel/i.test(itemClass)) return 'jewel';
  if (/flask/i.test(itemClass)) return 'flask';
  return null;
}

/** Загрузить уникальные предметы категории (до 250 за страницу). */
export async function getScoutUniques(
  category: ScoutCategory,
  league: string,
  search = '',
): Promise<ScoutItem[]> {
  const params = new URLSearchParams({
    league,
    referenceCurrency: 'chaos',
    search,
    page: '1',
    perPage: '250',
  });
  const url = `${SCOUT_UNIQUE}/${category}?${params}`;
  const res = await httpJson<ScoutResponse>(url);
  return res.items ?? [];
}

// Кэш уникальных цен (приём из Exiled-Exchange-2) — не бьём по poe2scout
// на каждый повторный прайс-чек одного и того же предмета.
const SCOUT_TTL = 10 * 60 * 1000; // 10 минут
const scoutCache = new Map<string, { at: number; value: number | null }>();

export function clearScoutCache(): void {
  scoutCache.clear();
}

/**
 * Цена уникального предмета по точному имени.
 * Пытается по всем категориям (т.к. имя не говорит, weapon это или armour).
 * Возвращает цену в chaos или null.
 */
export async function priceUnique(name: string, league?: string): Promise<number | null> {
  const l = league ?? currentLeague ?? 'Runes of Aldur';
  const key = `${l}::${name.trim().toLowerCase()}`;
  const c = scoutCache.get(key);
  if (c && Date.now() - c.at < SCOUT_TTL) return c.value;

  const categories: ScoutCategory[] = ['weapon', 'armour', 'accessory', 'jewel', 'flask'];
  const lower = name.trim().toLowerCase();
  let value: number | null = null;
  for (const cat of categories) {
    try {
      const items = await getScoutUniques(cat, l, name.trim());
      const match = items.find(
        (it) => it.name.toLowerCase() === lower && it.currentPrice !== null,
      );
      if (match?.currentPrice != null) {
        value = match.currentPrice;
        break;
      }
    } catch {
      // пробуем следующую категорию
    }
  }
  scoutCache.set(key, { at: Date.now(), value });
  return value;
}

// ─── Официальный trade2 API (базовый, без авторизации) ─────────────────

/**
 * Поиск по официальному торговому сайту без авторизации (базовый запрос).
 * Возвращает минимальные/доступные объявления.
 */
export async function searchTrade(
  query: { type?: string; name?: string },
  opts: { limit?: number } = {},
): Promise<TradeListing[]> {
  const limit = opts.limit ?? 10;
  const searchQuery: Record<string, unknown> = {
    query: {
      status: { option: 'online' },
      name: query.name ? { option: query.name } : undefined,
      type: query.type ? { option: query.type } : undefined,
      stats: [{ type: 'and', filters: [] }],
    },
    sort: { price: 'asc' },
  };

  const league = getLeague() ?? 'Runes of Aldur';
  try {
    const search = await httpJson<{ id?: string }>(`${TRADE_API}/search/${encodeURIComponent(league)}`, {
      method: 'POST',
      body: searchQuery,
    });
    if (!search?.id) return [];
    const fetchRes = await httpJson<{
      result?: Array<{ listing?: { price?: { amount?: number; type?: string } } }>;
    }>(`${TRADE_API}/fetch/${search.id}?query=${search.id}&count=${limit}`);
    const listings: TradeListing[] = [];
    for (const entry of fetchRes?.result ?? []) {
      const p = entry?.listing?.price;
      if (p && typeof p.amount === 'number') {
        listings.push({ price: p.amount, currency: p.type ?? 'chaos' });
      }
    }
    return listings;
  } catch {
    return [];
  }
}

// ─── Прайс-чек ──────────────────────────────────────────────────────────

/**
 * Выполнить прайс-чек предмета.
 *  - уникальные вещи ищем через poe2scout (точная цена по имени)
 *  - прочее / дополнение — через официальный trade API (медиана первых листингов)
 */
export async function priceCheck(itemText: string): Promise<PriceCheckResult> {
  const parsed = parseItemText(itemText);
  let estimate: PriceEstimate | null = null;
  let listings: TradeListing[] = [];

  if (parsed.rarity === 'unique' && parsed.name) {
    const v = await priceUnique(parsed.name);
    if (v != null) {
      estimate = { min: v * 0.8, max: v * 1.2, median: v, confidence: 'approx' };
    }
  }

  if (parsed.name || parsed.type) {
    listings = await searchTrade({ name: parsed.name ?? undefined, type: parsed.type ?? undefined });
    if (!estimate) {
      const prices = listings.filter((l) => l.currency === 'chaos').map((l) => l.price);
      if (prices.length > 2) {
        prices.sort((a, b) => a - b);
        const median = prices[Math.floor(prices.length / 2)];
        estimate = { min: prices[0], max: prices[prices.length - 1], median, confidence: 'approx' };
      }
    }
  }

  return {
    itemName: parsed.name ?? parsed.type ?? 'Неизвестный предмет',
    rarity: parsed.rarity,
    estimate,
    listings,
    sources: Array.from(
      new Set([
        ...(parsed.rarity === 'unique' && estimate ? ['poe2scout'] : []),
        ...(listings.length ? ['trade2'] : []),
      ]),
    ),
    updatedAt: Date.now(),
  };
}

interface ParsedItem {
  rarity: string;
  name?: string;
  type?: string;
  mods: string[];
}

function parseItemText(text: string): ParsedItem {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const rarity = detectRarity(lines[0] ?? '');
  const result: ParsedItem = { rarity, mods: [] };
  for (const line of lines) {
    if (/^Rarity:/i.test(line)) continue;
    if (/^Item (Level|Class)/i.test(line)) continue;
    if (!result.name) {
      result.name = line;
    }
  }
  return result;
}

function detectRarity(firstLine: string): string {
  const t = firstLine.toLowerCase();
  if (t.includes('unique')) return 'unique';
  if (t.includes('rare')) return 'rare';
  if (t.includes('magic')) return 'magic';
  if (t.includes('currency')) return 'currency';
  if (t.includes('gem')) return 'gem';
  return 'other';
}