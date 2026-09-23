/**
 * Торговля и цены: бесплатные публичные источники (проверенные endpoint'ы).
 *  - poe2scout    — актуальный список лиг + цены валют и уникальных в любой лиге
 *                   (в базовой валюте лиги, конвертируем в Chaos через DivinePrice/ChaosDivinePrice)
 *  - poe.ninja    — курсы валют / обмен (PoE2 Economy API)
 *  - trade2       — официальный теid торговый поиск (без авторизации, базовый)
 * Никогда не скрейпим сайт торговли и не требуем учётку.
 *
 * Все лиги поддерживаются автоматически: список подтягивается из poe2scout,
 * кэшируется с TTL и используется для переключения между лигами.
 */

import { httpJson } from './http.js';
import { parseItemText, itemDisplayName } from './parse.js';
import type {
  CurrencyRate,
  League,
  PriceCheckResult,
  PriceEstimate,
  TradeListing,
} from './types.js';

const SCOUT_HOST = 'https://api.poe2scout.com/poe2';
const NINJA_EXCHANGE = 'https://poe.ninja/poe2/api/economy/exchange/current/overview';
const TRADE_API = 'https://www.pathofexile.com/api/trade2';

/** Категории валют/уников poe2scout (ApiIds). */
type ScoutCategory = 'currency' | 'fragments' | 'runes' | 'ultimatum' | 'vaultkeys';
type ScoutUniqueCategory =
  | 'armour'
  | 'weapon'
  | 'accessory'
  | 'jewel'
  | 'flask'
  | 'body'
  | 'helmets'
  | 'gloves'
  | 'boots'
  | 'shield'
  | 'quivers'
  | 'foci'
  | 'bows'
  | 'staves'
  | 'wands'
  | 'sceptres'
  | 'maces'
  | 'swords'
  | 'axes'
  | 'claws'
  | 'daggers'
  | 'flails'
  | 'spears'
  | 'crossbows'
  | 'rings'
  | 'amulets'
  | 'belts';

// ────────────────────────────────────────────────
// Актуальные лиги (загрузка из poe2scout)
// ────────────────────────────────────────────────

const LEAGUES_TTL = 6 * 60 * 60 * 1000; // 6 часов — список лиг меняется редко
let leaguesCache: { at: number; leagues: League[] } | null = null;

/** Статичный список лиг (fallback/начальные опции). Актуальные загружаются из poe2scout через fetchLeagues(). */
export const KNOWN_LEAGUES: League[] = [
  { id: 'Runes of Aldur', name: 'Runes of Aldur', isCurrent: true, shortName: 'runes' },
  { id: 'Rise of the Abyssal', name: 'Rise of the Abyssal', shortName: 'riseoftheabyssal' },
  { id: 'Dawn of the Hunt', name: 'Dawn of the Hunt', shortName: 'dawnofthehunt' },
  { id: 'Standard', name: 'Standard (PoE2)', shortName: 'standard' },
];
const FALLBACK_LEAGUES: League[] = KNOWN_LEAGUES;

/** Формат ответа poe2scout на /poe2/Leagues. */
interface ScoutLeague {
  Value: string;
  ShortName: string;
  IsCurrent?: boolean;
  DivinePrice?: number | null;
  ChaosDivinePrice?: number | null;
  BaseCurrencyApiId?: string;
  BaseCurrencyText?: string;
}

/** Актуальный список лиг из poe2scout (с кэшем). */
export async function fetchLeagues(): Promise<League[]> {
  const now = Date.now();
  if (leaguesCache && now - leaguesCache.at < LEAGUES_TTL) return leaguesCache.leagues;

  try {
    const data = await httpJson<ScoutLeague[]>(`${SCOUT_HOST}/Leagues`);
    if (!Array.isArray(data) || data.length === 0) {
      leaguesCache = { at: now, leagues: FALLBACK_LEAGUES };
      return FALLBACK_LEAGUES;
    }
    const leagues: League[] = data.map((l) => ({
      id: l.Value,
      name: l.Value,
      shortName: l.ShortName || l.Value,
      isCurrent: !!l.IsCurrent,
      baseCurrencyApiId: l.BaseCurrencyApiId,
      baseCurrencyText: l.BaseCurrencyText,
      divinePrice: l.DivinePrice ?? null,
      chaosDivinePrice: l.ChaosDivinePrice ?? null,
      updatedAt: now,
    }));
    // Активные лиги в начале списка.
    leagues.sort((a, b) => Number(b.isCurrent ?? false) - Number(a.isCurrent ?? false));
    leaguesCache = { at: now, leagues };
    return leagues;
  } catch {
    leaguesCache = { at: now, leagues: FALLBACK_LEAGUES };
    return FALLBACK_LEAGUES;
  }
}

/** Принудительно перезагрузить список лиг (например, по кнопке «Обновить»). */
export function invalidateLeagues(): void {
  leaguesCache = null;
}

/** Получить league-объект по строке (id или shortName), иначе стейтик. */
export async function resolveLeague(league?: string | null): Promise<League | null> {
  const wanted = league ?? currentLeague;
  if (!wanted) return null;
  const all = await fetchLeagues();
  return (
    all.find((l) => l.id === wanted || l.shortName === wanted || l.name === wanted) ?? null
  );
}

/** Код для URL API poe2scout: shortName, если есть, иначе id. */
export async function scoutLeagueCode(league?: string | null): Promise<string> {
  const resolved = await resolveLeague(league);
  return (resolved?.shortName || resolved?.id || league || currentLeague || 'Runes of Aldur')
    .split(' ')
    .join('');
}

// ────────────────────────────────────────────────
// Активная лига
// ────────────────────────────────────────────────

let currentLeague: string | null = null;

/** Установить активную лигу (например, "Runes of Aldur"). */
export function setLeague(league: string | null): void {
  currentLeague = league;
  // Смена лиги инвалидирует все ценовые кэши — они лиго-зависимы.
  clearRatesCache();
  clearScoutCache();
}

export function getLeague(): string | null {
  return currentLeague;
}

/** Снапшот курсов одной лиги для конвертации (из кэша лиг или через fetchLeagues). */
async function leagueConversion(
  league?: string | null,
): Promise<{ divineInBase: number | null; chaosInBase: number | null }> {
  const resolved = await resolveLeague(league);
  if (!resolved) return { divineInBase: null, chaosInBase: null };
  // divineInBase = сколько единиц базовой валюты (exalted) стоит 1 Divine.
  // ChaosDivinePrice = сколько Chaos стоит 1 Divine.
  // Отсюда 1 единица базовой (1 exalted) = ChaosDivinePrice / divineInBase chaos.
  const dp = resolved.divinePrice ?? null;
  const cdp = resolved.chaosDivinePrice ?? null;
  if (dp != null && cdp != null && dp > 0) {
    return { divineInBase: dp, chaosInBase: cdp / dp };
  }
  return { divineInBase: dp, chaosInBase: null };
}

/** Перевести цену из базовой валюты лиги в Chaos Orbs. */
export async function priceToChaos(
  priceInBase: number,
  league?: string | null,
): Promise<number | null> {
  const conv = await leagueConversion(league);
  if (conv.chaosInBase == null) return null;
  return priceInBase * conv.chaosInBase;
}

export async function priceToDivine(
  priceInBase: number,
  league?: string | null,
): Promise<number | null> {
  const conv = await leagueConversion(league);
  if (conv.divineInBase == null || conv.divineInBase <= 0) return null;
  return priceInBase / conv.divineInBase;
}

// ────────────────────────────────────────────────
// poe2scout: курсы валют (в любой лиге)
// ────────────────────────────────────────────────

const SCOUT_TTL = 5 * 60 * 1000; // 5 минут
const scoutCurrencyCache = new Map<string, { at: number; rates: CurrencyRate[] }>();
const scoutUniqueCache = new Map<string, { at: number; value: number | null }>();

export function clearScoutCache(): void {
  scoutCurrencyCache.clear();
  scoutUniqueCache.clear();
}

interface ScoutCurrencyItem {
  ApiId?: string;
  Text?: string;
  CurrentPrice?: number | null;
}

interface ScoutPage {
  Total?: number;
  Items?: ScoutCurrencyItem[];
}

/** Курсы валют лиги из poe2scout (цена в базовой валюте лиги → конвертируем в Chaos). */
export async function fetchScoutCurrencyRates(league?: string): Promise<CurrencyRate[]> {
  const l = league ?? currentLeague ?? 'Runes of Aldur';
  const key = l;
  const hit = scoutCurrencyCache.get(key);
  if (hit && Date.now() - hit.at < SCOUT_TTL) return hit.rates;

  const code = await scoutLeagueCode(l);
  let rates: CurrencyRate[] = [];
  try {
    const url = `${SCOUT_HOST}/Leagues/${encodeURIComponent(code)}/Currencies/ByCategory?Category=currency&PerPage=250`;
    const data = await httpJson<ScoutPage>(url);
    const items = data.Items ?? [];
    rates = await Promise.all(
      items.map(async (it) => {
        const raw = it.CurrentPrice ?? null;
        const chaos = raw != null ? await priceToChaos(raw, l) : null;
        const divine = raw != null ? await priceToDivine(raw, l) : null;
        return {
          name: it.Text ?? it.ApiId ?? 'Unknown',
          chaosValue: chaos,
          divineValue: divine,
          source: 'poe2scout',
          updatedAt: Date.now(),
        };
      }),
    );
  } catch {
    rates = [];
  }
  scoutCurrencyCache.set(key, { at: Date.now(), rates });
  return rates;
}

// ────────────────────────────────────────────────
// poe.ninja Exchange (резервный источник курсов)
// ────────────────────────────────────────────────

const NINJA_TTL = 5 * 60 * 1000;
const ninjaCache = new Map<string, { at: number; rates: CurrencyRate[] }>();

interface NinjaExchangeResponse {
  core?: {
    items?: Array<{ id: string; name: string }>;
    rates?: Record<string, number>;
    primary?: string;
    secondary?: string;
  };
  lines?: Array<{ id: string; primaryValue: number; sparkline?: { totalChange: number } }>;
}

/** Курсы валют (тип Currency) из poe.ninja PoE2 Economy API — цена каждой в Chaos. */
export async function fetchCurrencyRates(league?: string): Promise<CurrencyRate[]> {
  const l = league ?? currentLeague ?? 'Runes of Aldur';
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

/** Получить курсы валют, предпочитая poe2scout, при пустом результате — poe.ninja. */
export async function fetchBestCurrencyRates(league?: string): Promise<CurrencyRate[]> {
  const s = await fetchScoutCurrencyRates(league);
  if (s.length > 0) return s;
  return fetchCurrencyRates(league);
}

export function clearRatesCache(): void {
  ninjaCache.clear();
  scoutCurrencyCache.clear();
}

// ────────────────────────────────────────────────
// poe2scout: цены уникальных (в любой лиге)
// ────────────────────────────────────────────────

/** Маппинг item class строки → категория уников poe2scout. */
export function mapItemClassToScoutCategory(itemClass: string): ScoutUniqueCategory | null {
  if (/helm|helmet|head/i.test(itemClass)) return 'helmets';
  if (/glove/i.test(itemClass)) return 'gloves';
  if (/boot/i.test(itemClass)) return 'boots';
  if (/chest|body/i.test(itemClass)) return 'body';
  if (/shield/i.test(itemClass)) return 'shield';
  if (/quiver/i.test(itemClass)) return 'quivers';
  if (/focus/i.test(itemClass)) return 'foci';
  if (/bow/i.test(itemClass)) return 'bows';
  if (/staff/i.test(itemClass)) return 'staves';
  if (/wand/i.test(itemClass)) return 'wands';
  if (/sceptre/i.test(itemClass)) return 'sceptres';
  if (/mace|maul/i.test(itemClass)) return 'maces';
  if (/sword/i.test(itemClass)) return 'swords';
  if (/axe/i.test(itemClass)) return 'axes';
  if (/claw/i.test(itemClass)) return 'claws';
  if (/dagger/i.test(itemClass)) return 'daggers';
  if (/flail/i.test(itemClass)) return 'flails';
  if (/spear|polearm/i.test(itemClass)) return 'spears';
  if (/crossbow/i.test(itemClass)) return 'crossbows';
  if (/ring/i.test(itemClass)) return 'rings';
  if (/amulet/i.test(itemClass)) return 'amulets';
  if (/belt/i.test(itemClass)) return 'belts';
  if (/jewel/i.test(itemClass)) return 'jewel';
  if (/flask/i.test(itemClass)) return 'flask';
  return null;
}

/** Все категории уников для поиска без точного itemClass. */
const ALL_UNIQUE_CATEGORIES: ScoutUniqueCategory[] = [
  'armour',
  'weapon',
  'accessory',
  'body',
  'helmets',
  'gloves',
  'boots',
  'shield',
  'quivers',
  'foci',
  'bows',
  'staves',
  'wands',
  'sceptres',
  'maces',
  'swords',
  'axes',
  'claws',
  'daggers',
  'flails',
  'spears',
  'crossbows',
  'rings',
  'amulets',
  'belts',
  'jewel',
  'flask',
];

interface ScoutUniqueItem {
  ApiId?: string;
  Text?: string;
  CurrentPrice?: number | null;
}

interface ScoutUniquePage {
  Items?: ScoutUniqueItem[];
}

async function fetchUniqueCategory(
  category: string,
  leagueCode: string,
  search: string,
): Promise<ScoutUniqueItem[]> {
  const url = `${SCOUT_HOST}/Leagues/${encodeURIComponent(leagueCode)}/Uniques/ByCategory?Category=${encodeURIComponent(
    category,
  )}&Search=${encodeURIComponent(search)}&PerPage=250`;
  const data = await httpJson<ScoutUniquePage>(url);
  return data.Items ?? [];
}

/**
 * Цена уникального предмета по точному имени (в Chaos).
 * Ищет по категориям poe2scout в выбранной лиге и конвертирует из базовой валюты.
 */
export async function priceUnique(
  name: string,
  league?: string,
  itemClass?: string,
): Promise<number | null> {
  const l = league ?? currentLeague ?? 'Runes of Aldur';
  const key = `${l}::${name.trim().toLowerCase()}::${(itemClass ?? '').toLowerCase()}`;
  const c = scoutUniqueCache.get(key);
  if (c && Date.now() - c.at < SCOUT_TTL) return c.value;

  const code = await scoutLeagueCode(l);
  const lower = name.trim().toLowerCase();
  let value: number | null = null;

  const targetCat = itemClass ? mapItemClassToScoutCategory(itemClass) : null;
  const categories: string[] = targetCat
    ? [targetCat]
    : ALL_UNIQUE_CATEGORIES;

  for (const cat of categories) {
    try {
      const items = await fetchUniqueCategory(cat, code, name.trim());
      const match = items.find(
        (it) =>
          (it.Text ?? it.ApiId ?? '').toLowerCase() === lower &&
          it.CurrentPrice != null,
      );
      if (match?.CurrentPrice != null) {
        value = await priceToChaos(match.CurrentPrice, l);
        if (value == null) value = match.CurrentPrice;
        break;
      }
    } catch {
      // пробуем следующую категорию
    }
  }
  scoutUniqueCache.set(key, { at: Date.now(), value });
  return value;
}

// ────────────────────────────────────────────────
// Официальный trade2 API (базовый, без авторизации)
// ────────────────────────────────────────────────

/**
 * Поиск по официальному торговому сайту без авторизации.
 * Лигу передаём явно — работает во всех лигах (translation), иначе fallback на активную.
 */
export async function searchTrade(
  query: { type?: string; name?: string },
  opts: { limit?: number; league?: string } = {},
): Promise<TradeListing[]> {
  const limit = opts.limit ?? 10;
  const league = opts.league ?? getLeague() ?? 'Runes of Aldur';
  const searchQuery: Record<string, unknown> = {
    query: {
      status: { option: 'online' },
      name: query.name ? { option: query.name } : undefined,
      type: query.type ? { option: query.type } : undefined,
      stats: [{ type: 'and', filters: [] }],
    },
    sort: { price: 'asc' },
  };

  try {
    const search = await httpJson<{ id?: string }>(
      `${TRADE_API}/search/${encodeURIComponent(league)}`,
      { method: 'POST', body: searchQuery },
    );
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

// ────────────────────────────────────────────────
// Прайс-чек
// ────────────────────────────────────────────────

/**
 * Выполнить прайс-чек предмета.
 *  - уникальные — poe2scout (точная цена по имени, в актуальной лиге)
 *  - валюта     — poe2scout/poe.ninja (курс)
 *  - прочее     — официальный trade API (медиана первых листингов)
 */
export async function priceCheck(
  itemText: string,
  opts: { league?: string } = {},
): Promise<PriceCheckResult> {
  const league = opts.league ?? currentLeague ?? undefined;
  const parsed = parseItemText(itemText);
  let estimate: PriceEstimate | null = null;
  let listings: TradeListing[] = [];

  if (parsed.rarity === 'Unique' && (parsed.name ?? parsed.baseType)) {
    const v = await priceUnique(
      parsed.name ?? parsed.baseType,
      league,
      parsed.itemClass || undefined,
    );
    if (v != null) {
      estimate = {
        min: v * 0.8,
        max: v * 1.2,
        median: v,
        confidence: 'approx',
      };
    }
  } else if (parsed.rarity === 'Currency' && parsed.baseType) {
    const rates = await fetchBestCurrencyRates(league);
    const rate = rates.find(
      (r) => r.name.toLowerCase() === parsed.baseType!.toLowerCase(),
    );
    if (rate?.chaosValue != null) {
      estimate = {
        min: rate.chaosValue,
        max: rate.chaosValue,
        median: rate.chaosValue,
        confidence: 'exact',
      };
    }
  }

  if (parsed.name || parsed.baseType) {
    listings = await searchTrade(
      { name: parsed.name ?? undefined, type: parsed.baseType ?? undefined },
      { league },
    );
    if (!estimate) {
      const prices = listings.filter((l) => l.currency === 'chaos').map((l) => l.price);
      if (prices.length > 2) {
        prices.sort((a, b) => a - b);
        const median = prices[Math.floor(prices.length / 2)];
        estimate = {
          min: prices[0],
          max: prices[prices.length - 1],
          median,
          confidence: 'approx',
        };
      }
    }
  }

  return {
    itemName: itemDisplayName(parsed) || 'Неизвестный предмет',
    rarity: parsed.rarity.toLowerCase(),
    estimate,
    listings,
    sources: Array.from(
      new Set([
        ...(parsed.rarity === 'Unique' && estimate ? ['poe2scout'] : []),
        ...(parsed.rarity === 'Currency' && estimate ? ['poe2scout', 'poe.ninja'] : []),
        ...(listings.length ? ['trade2'] : []),
      ]),
    ),
    league: league ?? null,
    updatedAt: Date.now(),
  };
}