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
import { cachedJson, cachedPostJson, DEFAULT_TTLS } from './cache.js';
import { parseItemText, itemDisplayName } from './parse.js';
import { buildCodeToGear } from './build.js';
import { scountCategoryForUnique } from './uniques.js';
import { recordLearnedItem } from './learnlog.js';
import { getLearnedStatTemplates } from './learnedStats.js';
import type {
  CurrencyRate,
  CurrencyHistoryPoint,
  League,
  PriceCheckResult,
  PriceEstimate,
  TradeListing,
  BuildPriceReport,
  BuildPricedItem,
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
    const { data } = await cachedJson<ScoutLeague[]>(`${SCOUT_HOST}/Leagues`, {
      ttlMs: DEFAULT_TTLS.leagueList,
    });
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

/**
 * Название актуальной лиги по умолчанию (для CLI/overlay/web/MCP без явного выбора).
 * KNOWN_LEAGUES хранит устаревший маркер isCurrent, поэтому реальную текущую
 * лигу берём из живого списка poe2scout (fetchLeagues): лиги с isCurrent=true идут
 * первыми; берём первую обычную. При недоступности — консервативный fallback.
 */
export async function currentDefaultLeague(): Promise<string> {
  try {
    const leagues = await fetchLeagues();
    const current = leagues.find((l) => l.isCurrent);
    if (current?.name) return current.name;
    if (leagues[0]?.name) return leagues[0].name;
  } catch {
    /* fallback ниже */
  }
  return 'Forbidden Rites';
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
  lines?: Array<{
    id: string;
    primaryValue: number;
    category?: string;
    sparkline?: { totalChange: number; data?: Array<number | null> };
  }>;
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
  // в молодых лигах poe2scout может отдавать цены null — берём только валидные
  const usable = s.filter((r) => r.chaosValue != null || r.divineValue != null);
  if (usable.length > 0) return usable;
  return fetchCurrencyRates(league);
}

// ────────────────────────────────────────────────
// История цен (P1 #8): тренд валют из poe.ninja Exchange Overview
// ────────────────────────────────────────────────
const ninjaHistoryCache = new Map<string, { at: number; list: CurrencyHistoryPoint[] }>();

/**
 * История (тренд) валют из poe.ninja PoE2 Exchange Overview.
 *
 * Честно: отдельного публичного history-эндпоинта у poe.ninja PoE2 нет —
 * источником служит sparkline из текущего обзора: `totalChange` (изменение за
 * окно, %) и дневной ряд `days` (что poe.ninja отдаёт как изменения, не цены).
 */
export async function fetchCurrencyHistory(league?: string): Promise<CurrencyHistoryPoint[]> {
  const l = league ?? currentLeague ?? 'Runes of Aldur';
  const hit = ninjaHistoryCache.get(l);
  if (hit && Date.now() - hit.at < NINJA_TTL) return hit.list;

  const url = `${NINJA_EXCHANGE}?league=${encodeURIComponent(l)}&type=${encodeURIComponent('Currency')}`;
  const data = await httpJson<NinjaExchangeResponse>(url);
  const c = data.core;
  if (!c?.items || !c.rates) return [];

  const chaosRate = c.rates[c.secondary ?? ''] ?? 1;
  const idToName = new Map(c.items.map((it) => [it.id, it.name]));
  const list: CurrencyHistoryPoint[] = (data.lines ?? []).map((line) => ({
    id: line.id,
    name: idToName.get(line.id) ?? line.id,
    category: line.category ?? 'Currency',
    chaosValue: line.primaryValue * chaosRate,
    totalChange: line.sparkline?.totalChange ?? null,
    days: line.sparkline?.data ?? [],
  }));
  ninjaHistoryCache.set(l, { at: Date.now(), list });
  return list;
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

/** Пары «regex по базовому типу → категория poe2scout» для вывода категории уника из baseType.
 *  Используется, когда itemClass (строка «Item Class: …») в клир-тексте отсутствует.
 *  Порядок: от специфичного к общему, чтобы сопоставление было точным. */
const BASE_CATEGORY_TABLE: Array<[RegExp, ScoutUniqueCategory]> = [
  [/crossbow/i, 'crossbows'],
  [/quarterstaff/i, 'spears'],
  [/polearm|spear/i, 'spears'],
  [/flail/i, 'flails'],
  [/dagger/i, 'daggers'],
  [/claw/i, 'claws'],
  [/hatchet|axe/i, 'axes'],
  [/sword/i, 'swords'],
  [/maul|mace/i, 'maces'],
  [/sceptre/i, 'sceptres'],
  [/wand/i, 'wands'],
  [/warstaff|staff/i, 'staves'],
  [/bow/i, 'bows'],
  [/shield|buckler/i, 'shield'],
  [/quiver/i, 'quivers'],
  [/focus/i, 'foci'],
  [/helmet|helm|hood|mask|cap|visor|crown|circlet|coif|headguard/i, 'helmets'],
  [/glove|mitt/i, 'gloves'],
  [/boot|greave|tread/i, 'boots'],
  [/ring/i, 'rings'],
  [/amulet|locket|medallion|necklace/i, 'amulets'],
  [/belt/i, 'belts'],
  [/jewel|jewelry/i, 'jewel'],
  [/flask/i, 'flask'],
  [/body|chest|mail|armou?r|vest|coat|jacket|robe/i, 'body'],
];

/** Вывести категорию poe2scout для уникального предмета. Приоритет: itemClass,
 *  иначе угадывание по базовому типу. */
export function inferUniqueCategory(
  baseType: string | null,
  itemClass?: string,
): ScoutUniqueCategory | null {
  const cls = (itemClass ?? '').trim();
  if (cls) {
    const fromClass = mapItemClassToScoutCategory(cls);
    if (fromClass) return fromClass;
  }
  const base = (baseType ?? '').trim();
  if (!base) return null;
  for (const [re, cat] of BASE_CATEGORY_TABLE) {
    if (re.test(base)) return cat;
  }
  // Общие группы, если ничего специфичного не нашлось.
  return null;
}

/** Максимум категорий, перебираемых в fallback-поиске уника, когда категория не угадана
 *  (защита от 27 последовательных запросов; обычно это 0–1 из-за infer по baseType). */
const MAX_UNIQUE_CATEGORIES = 5;

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
  /** Точное имя уника (например, "Headhunter"). */
  Name?: string;
  /** Полный текст-подпись (например, "Headhunter Heavy Belt"). */
  Text?: string;
  /** Базовый тип (например, "Heavy Belt"). */
  Type?: string;
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
  // Заниженный таймаут для категорийного поиска: pое2scout на медленных ответах
  // не должен держать прайс-чек (иначе 10с на категорию × N категорий).
  const data = await httpJson<ScoutUniquePage>(url, { timeoutMs: 5000 });
  return data.Items ?? [];
}

/**
 * Агрегатные группы poe2scout, к которым относится конкретная категория уников.
 * Некоторые уникалы лежат ТОЛЬКО в агрегатной группе (weapon/armour/accessory),
 * а не в узкой категории — поэтому при поиске по узкой категории пробуем и группу.
 * Эмпирическое соответствие (по baseType/item class):
 *   - weapon:  все оружие (bows, staves, wands, sceptres, maces, swords, axes,
 *              claws, daggers, flails, spears, crossbows)
 *   - armour:  body, helmets, gloves, boots, shield, quivers
 *   - accessory: rings, amulets, belts
 *   - фласки/джемы — отдельных групп нет, агрегацию не делаем.
 */
function aggregateGroups(cat: ScoutUniqueCategory): ScoutUniqueCategory[] {
  const weapon: ScoutUniqueCategory[] = [
    'bows', 'staves', 'wands', 'sceptres', 'maces', 'swords', 'axes',
    'claws', 'daggers', 'flails', 'spears', 'crossbows',
  ];
  const armour: ScoutUniqueCategory[] = [
    'body', 'helmets', 'gloves', 'boots', 'shield', 'quivers',
  ];
  const accessory: ScoutUniqueCategory[] = ['rings', 'amulets', 'belts'];
  if (weapon.includes(cat)) return ['weapon'];
  if (armour.includes(cat)) return ['armour'];
  if (accessory.includes(cat)) return ['accessory'];
  return [];
}

/**
 * Цена уникального предмета по точному имени (в Chaos).
 * Ищет по категориям poe2scout в выбранной лиге и конвертирует из базовой валюты.
 */
export async function priceUnique(
  name: string,
  league?: string,
  itemClass?: string,
  baseType?: string | null,
): Promise<number | null> {
  const l = league ?? currentLeague ?? 'Runes of Aldur';
  const key = `${l}::${name.trim().toLowerCase()}::${(itemClass ?? '').toLowerCase()}::${(baseType ?? '').toLowerCase()}`;
  const c = scoutUniqueCache.get(key);
  if (c && Date.now() - c.at < SCOUT_TTL) return c.value;

  const code = await scoutLeagueCode(l);
  const lower = name.trim().toLowerCase();
  let value: number | null = null;

  // Узкая категория из itemClass или угаданная по базовому типу (надёжность и скорость:
  // почти всегда 1 запрос вместо перебора всех категорий). Приоритет — локальный каталог
  // уников (uniques_catalog.json, P2-ун.) по имени: точная категория poe2scout из PoB2
  // без сети и без перебора ALL_UNIQUE_CATEGORIES.
  const targetCat =
    scountCategoryForUnique(name, baseType ?? null) ?? inferUniqueCategory(baseType ?? null, itemClass);
  const categories: string[] = targetCat
    ? [targetCat, ...aggregateGroups(targetCat)]
    : ALL_UNIQUE_CATEGORIES.slice(0, MAX_UNIQUE_CATEGORIES);

  for (const cat of categories) {
    try {
      const items = await fetchUniqueCategory(cat, code, name.trim());
      const match = items.find((it) => {
        if (it.CurrentPrice == null) return false;
        // Сравнение по точному имени (Name), с запасными вариантами Text/ApiId.
        const candidates = [it.Name, it.Type, it.ApiId, it.Text]
          .filter(Boolean)
          .map((s) => String(s).toLowerCase());
        return (
          candidates.includes(lower) ||
          candidates.some((c) => c.startsWith(lower + ' ') || c.startsWith(lower + '\''))
        );
      });
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

/** Общий таймаут поиска цены уникального предмета (мс). Защита от долгого
 *  перебора категорий/сетевых зависаний: не держим прайс-чек слишком долго. */
const PRICE_UNIQUE_TIMEOUT_MS = 20000;

/** priceUnique с гарантированным общим таймаутом: если поиск не уложился —
 *  возвращаем null, не кэшируя отрицательный результат надолго. */
async function priceUniqueWithTimeout(
  name: string,
  league?: string,
  itemClass?: string,
  baseType?: string | null,
): Promise<number | null> {
  return Promise.race([
    priceUnique(name, league, itemClass, baseType),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), PRICE_UNIQUE_TIMEOUT_MS)),
  ]);
}

// ────────────────────────────────────────────────
// Официальный trade2 API (базовый, без авторизации)
// ────────────────────────────────────────────────

/**
 * Поиск по официальному торговому сайту без авторизации.
 * Лигу передаём явно — работает во всех лигах (translation), иначе fallback на активную.
 */
/** Каноническое имя базового типа в каталоге RePoE (для fallback-поиска
 *  по типу). Build Planner/клир-текст иногда дают имена, которые trade2 не
 *  признаёт («Quarterstaff» вместо «Sinister Quarterstaff», «Life Flask»,
 *  «Wand»...): резолвим через base_items.json (5382 записи) + кэш. */
const baseTypeByName = new Map<string, string | null>();
let baseTypeByNameLoaded = false;
async function loadBaseTypeByName(): Promise<void> {
  if (baseTypeByNameLoaded) return;
  baseTypeByNameLoaded = true;
  try {
    const { getBaseItems } = await import('./dataset.js');
    for (const b of getBaseItems()) {
      const n = (b.name ?? '').trim();
      if (n && !baseTypeByName.has(n)) baseTypeByName.set(n, n);
    }
  } catch {
    // локальный датасет недоступен (браузер/оффлайн) — маппинг будет частичным
  }
}

/** trade2-имя базового типа: проверяет, что trade2 принимает `type` (кэш на
 *  30 мин; «Unknown item base type» → null), иначе подсказывает каноническое
 *  имя из RePoE по префиксу/суффиксу/содержанию. Кэшируем оба исхода. */
const tradeTypeValidation = new Map<string, { at: number; ok: boolean; canonical?: string }>();
const TRADE_TYPE_VALIDATION_TTL = 30 * 60 * 1000;
export async function resolveTradeBaseType(
  type: string,
  opts: { league?: string } = {},
): Promise<string | null> {
  const t = type.trim();
  if (!t) return null;
  const hit = tradeTypeValidation.get(t);
  if (hit && Date.now() - hit.at < TRADE_TYPE_VALIDATION_TTL) {
    return hit.ok ? t : (hit.canonical ?? null);
  }
  const league = (await resolveLeague(opts.league ?? ''))?.id ?? null;
  try {
    // search без fetch (limit 0): валидация типа не тратит квоту fetch
    // (на fetch trade2 отдаёт отдельные жёсткие 429 при concurrency).
    const listings = await postTradeSearch(
      { query: { status: { option: 'online' }, type: { option: t }, stats: [] }, sort: { price: 'asc' } },
      { league: league ?? undefined, limit: 0, searchTypes: true },
    );
    const ok = listings.length > 0;
    tradeTypeValidation.set(t, { at: Date.now(), ok });
    return ok ? t : null;
  } catch (e) {
    // 429/500 — временные сбои, не кэшируем «невалиден» (см. isTransientTradeError).
    // ВАЖНО: return t (а не null) — при временном сбое мы НЕ дошли до
    // маппинга RePoE, поэтому вернём исходное имя: fallback-поиск получит
    // рабочий запрос, а следующий вызов заново валидирует тип (кэш не тронут).
    if (isTransientTradeError(e)) return t;
    // 400 «Unknown item base type» или сетевая ошибка — пробуем маппинг
    const mapped = await mapBaseTypeViaRePoe(t);
    if (mapped && mapped !== t) {
      const okMapped = await resolveTradeBaseType(mapped, opts);
      if (okMapped) tradeTypeValidation.set(t, { at: Date.now(), ok: false, canonical: okMapped });
      return okMapped;
    }
    tradeTypeValidation.set(t, { at: Date.now(), ok: false });
    return null;
  }
}

/** Подобрать каноническое имя base type по RePoE (точный match уже проверен
 *  вызывающим; здесь — префикс/суффикс/содержание). */
async function mapBaseTypeViaRePoe(t: string): Promise<string | null> {
  await loadBaseTypeByName();
  if (baseTypeByName.size === 0) return null;
  const lower = t.toLowerCase();
  let best: { name: string; score: number } | null = null;
  for (const name of baseTypeByName.keys()) {
    const nl = name.toLowerCase();
    let score = 0;
    if (nl === lower) score = 100;
    else if (nl.endsWith(' ' + lower)) score = 80; // «...Quarterstaff»
    else if (nl.startsWith(lower + ' ')) score = 70; // «Sinister ...»
    else if (nl.includes(lower)) score = 50;
    if (score >= 50 && (!best || score > best.score)) best = { name, score };
  }
  return best?.name ?? null;
}

export async function searchTrade(
  query: { type?: string; name?: string },
  opts: { limit?: number; league?: string } = {},
): Promise<TradeListing[]> {
  const searchQuery: Record<string, unknown> = {
    query: {
      status: { option: 'online' },
      name: query.name ? { option: query.name } : undefined,
      type: query.type ? { option: query.type } : undefined,
      stats: [],
    },
    sort: { price: 'asc' },
  };
  return postTradeSearch(searchQuery, opts);
}

// ────────────────────────────────────────────────
// trade2: каталог статов → поиск раров по целевым аффиксам
// ────────────────────────────────────────────────

interface TradeStatEntry {
  id: string;
  text: string;
  type?: string;
}

/** Каталог статов торгового сайта (id по шаблону текста, '#' — число).
 *  Меняется только с патчем — кэшируем как RePoE. */
export async function fetchTradeStats(): Promise<TradeStatEntry[]> {
  const { data } = await cachedJson<{ result?: Array<{ entries?: TradeStatEntry[] }> }>(
    `${TRADE_API}/data/stats`,
    { ttlMs: DEFAULT_TTLS.repoe },
  );
  return (data.result ?? []).flatMap((g) => g.entries ?? []);
}

export interface TradeStatFilter {
  id: string;
  /** Нижняя граница значения стата (если из текста вытащено число). */
  min?: number;
  /** Исходный текст мода (отладка). */
  text?: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeStatText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Сопоставить текст explicit-мода с шаблоном каталога статов ('#' → число).
 *  Возвращает фильтр для trade2 или null, если шаблон не найден. */
export function matchStatFilter(
  modText: string,
  entries: TradeStatEntry[],
): TradeStatFilter | null {
  const norm = normalizeStatText(modText);
  let best: TradeStatFilter | null = null;
  for (const e of entries) {
    if (!e.text?.includes('#')) continue;
    const pattern =
      '^' +
      escapeRegExp(normalizeStatText(e.text)).replace(/#/g, '([+-]?\\d+(?:\\.\\d+)?)') +
      '$';
    let m: RegExpExecArray | null;
    try {
      m = new RegExp(pattern).exec(norm);
    } catch {
      continue;
    }
    if (!m) continue;
    const values = m.slice(1).map(Number).filter((v) => Number.isFinite(v));
    const f: TradeStatFilter = { id: e.id, text: modText };
    if (values.length) {
      // Нижняя граница — максимум из чисел мода («Adds # to #» → верхний ролл)
      // с запасом 10% вниз: допускаем чуть худший ролл.
      f.min = Math.max(...values) * 0.9;
    }
    // При совпадении нескольких шаблонов берём самый пространный
    if (!best || e.text.length > (best.text?.length ?? 0)) best = f;
  }
  return best;
}

/** explicit-моды предмета → stat-фильтры trade2 по живому каталогу статов
 *  (trade2/data/stats; отличается от tradeQuery.modsToStatFilters — тот sync
 *  и знает только популярные pseudo-статы). + список нераспознанных. */
export async function matchModsToStatFilters(
  modTexts: string[],
): Promise<{ filters: TradeStatFilter[]; unmatched: string[] }> {
  let entries: TradeStatEntry[] = [];
  try {
    entries = await fetchTradeStats();
  } catch (e) {
    // живой каталог статов недоступен (патч сменил схему / сеть) —
    // выручает библиотека выученных статов (stale-but-known)
    entries = getLearnedStatTemplates() as TradeStatEntry[];
    debugLog(
      'fetchTradeStats failed, using learned stat library:',
      `${entries.length} learned entries`,
      e instanceof Error ? e.message : String(e),
    );
  }
  const filters: TradeStatFilter[] = [];
  let unmatched: string[] = [];
  for (const t of modTexts) {
    const f = matchStatFilter(t, entries);
    if (f) filters.push(f);
    else unmatched.push(t);
  }
  // Второй проход: моды, не найденные в живом каталоге, пробуем по
  // библиотеке выученных статов (патч ещё не отразился в /data/stats или
  // живой каталог неполон). Библиотека — только дополнение, не замена.
  if (unmatched.length && entries.length) {
    const learned = getLearnedStatTemplates() as TradeStatEntry[];
    if (learned.length) {
      const stillUnmatched: string[] = [];
      for (const t of unmatched) {
        const f = matchStatFilter(t, learned);
        if (f) filters.push(f);
        else stillUnmatched.push(t);
      }
      unmatched = stillUnmatched;
    }
  }
  return { filters, unmatched };
}

/** Поиск по trade2: базовый тип + stat-фильтры (прайс-чек раров по аффиксам).
 *  opts.group позволяет искать «и» (and) или «не менее value из» (count). */
export async function searchTradeByStats(
  query: {
    type?: string;
    filters: TradeStatFilter[];
    /** Группа статов: and/count. Для count значение — минимум совпавших статов. */
    group?: { type: 'and' | 'count'; value?: number };
  },
  opts: { limit?: number; league?: string } = {},
): Promise<TradeListing[]> {
  const filters = query.filters.map((f) => ({
    disabled: false,
    id: f.id,
    ...(f.min != null
      ? { value: { min: Math.round(f.min * 10) / 10 } }
      : {}),
  }));
  const group = query.group ?? { type: 'and' as const };
  return postTradeSearch(
    {
      query: {
        status: { option: 'online' },
        ...(query.type ? { type: { option: query.type } } : {}),
        stats: [
          group.type === 'count'
            ? { type: 'count', value: group.value ?? filters.length, filters }
            : { type: 'and', filters },
        ],
      },
      sort: { price: 'asc' },
    },
    opts,
  );
}

/** POST /search + /fetch: общая механика запроса официального trade API. */

// Троттлинг POST /search: trade2 жёстко лимитирует запросы (429 → временный
// бан IP). Глобальный интервал между поисками — минимум ~1.1 с, при 429 —
// дополнительно выдерживаем окно бана.
let lastSearchAt = 0;
let tradeBanUntil = 0;
const SEARCH_MIN_INTERVAL_MS = 1100;

async function throttleTradeSearch(): Promise<void> {
  const banWait = tradeBanUntil - Date.now();
  if (banWait > 0) await new Promise((r) => setTimeout(r, banWait));
  const wait = lastSearchAt + SEARCH_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastSearchAt = Date.now();
}

// Кэш POST-поисков в памяти (TTL 10 мин): повторный прайс-чек того же билда
// не должен заново долбить trade2 (жёсткие лимиты, 429 → бан IP).
const tradeSearchCache = new Map<string, { at: number; listings: TradeListing[] }>();
const TRADE_SEARCH_CACHE_TTL = 10 * 60 * 1000;

async function postTradeSearch(
  searchQuery: Record<string, unknown>,
  opts: { limit?: number; league?: string; searchTypes?: boolean } = {},
): Promise<TradeListing[]> {
  const league = opts.league ?? getLeague() ?? 'Runes of Aldur';
  const key = league + '\u0000' + JSON.stringify(searchQuery);
  const hit = tradeSearchCache.get(key);
  if (hit && Date.now() - hit.at < TRADE_SEARCH_CACHE_TTL) return hit.listings;
  const listings = await postTradeSearchUncached(searchQuery, opts);
  // Пустые результаты НЕ кэшируем (повторы добирают пустые слоты).
  // Валидационные sentinel-ы ([{price:0}]) тоже не кэшируем: их ключ запроса
  // совпадает с обычным поиском searchTrade и «засорял» бы его фейковым листингом
  // (для повторных валидаций есть отдельный кэш tradeTypeValidation).
  if (listings.length && !opts.searchTypes) {
    tradeSearchCache.set(key, { at: Date.now(), listings });
  }
  return listings;
}

async function postTradeSearchUncached(
  searchQuery: Record<string, unknown>,
  opts: { limit?: number; league?: string; searchTypes?: boolean },
): Promise<TradeListing[]> {
  const limit = opts.limit ?? 10;
  const rawLeague = opts.league && opts.league !== '' ? opts.league : (getLeague() ?? 'Runes of Aldur');
  // trade2 принимает league-ID («Forbidden Rites»), а НЕ shortCode
  // («forbiddenrites»): с shortCode API отвечает 400 «Invalid query»
  // на любой запрос, включая без фильтров. Резолвим через живой список лиг.
  const league = (await resolveLeague(rawLeague))?.id ?? rawLeague;
  try {
    await throttleTradeSearch();
    // POST-поиск и fetch листингов кэшируем на диск (30 мин): повторный
    // прайс-чек того же набора не расходует жёсткую квоту trade2.
    // Пустые результаты НЕ кэшируем — повторы добирают пустые слоты.
    const TRADE_CACHE_TTL = 30 * 60 * 1000;
    const { data: search } = await cachedPostJson<{ id?: string; result?: string[] }>(
      `${TRADE_API}/search/poe2/${encodeURIComponent(league)}`,
      searchQuery,
      { ttlMs: TRADE_CACHE_TTL, skipCache: (d) => !d?.id || !d.result?.length },
    );
    if (!search?.id || !search.result?.length) return [];
    // Валидация типа (searchTypes) не требует цен — пропускаем fetch (экономит
    // отдельную жёсткую квоту fetch; на fetch trade2 отдаёт 429 при concurrency).
    if (opts.searchTypes) return [{ price: 0, currency: 'chaos' }];
    // fetch принимает ХЭШИ результатов (не id поиска): берём первые limit хэшей.
    const hashes = search.result.slice(0, Math.min(limit, 10)).join(',');
    const { data: fetchRes } = await cachedJson<{
      result?: Array<{
        listing?: { price?: { amount?: number; currency?: string; type?: string } };
      } | null>;
    }>(`${TRADE_API}/fetch/${hashes}?query=${search.id}`, { ttlMs: 30 * 60 * 1000 });
    const listings: TradeListing[] = [];
    for (const entry of fetchRes?.result ?? []) {
      if (!entry) continue;
      const p = entry?.listing?.price;
      if (p && typeof p.amount === 'number') {
        // p.currency = валюта ('exalted'/'divine'/'chaos'...), p.type = вид цены ('~price'/'~b/o')
        listings.push({ price: p.amount, currency: p.currency ?? p.type ?? 'chaos' });
      }
    }
    return listings;
  } catch (e) {
    // Ошибка trade2 раньше глоталась молча (return []) — прайс-чек раров
    // «не работал» без единого признака. Логируем причину: HTTP 400
    // «Invalid query»/«Unknown item base type», 429 и т.д.
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(
        '[poe2-kit] trade2 search failed:',
        e instanceof Error ? e.message : String(e),
      );
    }
    // 429 от trade2 → выставляем окно бана, чтобы следующие поиски не долбили
    if (e instanceof Error && /HTTP 429/.test(e.message)) {
      tradeBanUntil = Date.now() + 60_000;
    }
    // 429/500 trade2 — временные сбои. В priceCheck/searchTradeByStats
    // глотаем (ниже, после warn → return []): fallback-этап продолжит работу.
    // В resolveTradeBaseType (searchTypes) — re-throw, чтобы НЕ кэшировать
    // ложное «тип невалиден» и чтобы transient-ошибка была видна.
    if (isTransientTradeError(e) && opts.searchTypes) {
      throw e;
    }
    return [];
  }
}

/** 429 (rate limit) / 500 (внутренняя ошибка trade2) — временные сбои,
 *  которые НЕ доказывают невалидность запроса/типа. */
function isTransientTradeError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return /HTTP 429|HTTP 500|Rate limit|Internal error/i.test(e.message);
}

/** Листинги в разных валютах → цены в Chaos Orb (по курсам лиги). */
async function listingsToChaosPrices(
  listings: TradeListing[],
  league?: string,
): Promise<number[]> {
  const out: number[] = [];
  const others: TradeListing[] = [];
  for (const l of listings) {
    const cur = (l.currency ?? '').toLowerCase();
    if (cur === 'chaos' || cur === 'chaos orb') out.push(l.price);
    else others.push(l);
  }
  if (others.length) {
    try {
      const rates = await fetchBestCurrencyRates(league);
      const rateById = new Map<string, number | null>();
      for (const r of rates) {
        const key = r.name.toLowerCase();
        rateById.set(key, r.chaosValue);
        rateById.set(key.replace(/\s*orb$/, ''), r.chaosValue);
      }
      for (const l of others) {
        const cv = rateById.get((l.currency ?? '').toLowerCase());
        if (cv != null) out.push(l.price * cv);
      }
    } catch {
      // нет курсов — учитываем только chaos-листинги
    }
  }
  return out;
}

/** Медианная оценка из массива цен (в Chaos). Нужно > 2 валидных цен. */
/** Медианная оценка из массива цен (в Chaos). Нужно >= 3 валидных цен —
 *  меньше считаем недостоверным (шум единичных листингов) и помечаем low. */
function estimateFromPrices(prices: number[]): PriceEstimate | null {
  const np = prices.filter((p) => Number.isFinite(p) && p > 0);
  if (np.length < 3) return null;
  np.sort((a, b) => a - b);
  return {
    min: np[0]!,
    max: np[np.length - 1]!,
    median: np[Math.floor(np.length / 2)]!,
    confidence: np.length >= 5 ? 'approx' : 'low',
  };
}

// ────────────────────────────────────────────────
// Прайс-чек
// ────────────────────────────────────────────────

/** Отладочный лог priceCheck: включается переменной окружения POE2K_DEBUG
 *  (любой непустой значение). Помогает разбираться, почему предмет не
 *  оценивается: парсинг, сопоставление модов со статами, ответы trade2. */
function debugLog(...args: unknown[]): void {
  if (typeof process !== 'undefined' && process.env && process.env.POE2K_DEBUG) {
    console.log('[poe2-kit:priceCheck]', ...args);
  }
}

/**
 * Выполнить прайс-чек предмета.
 *  - уникальные — poe2scout (точная цена по имени, в актуальной лиге)
 *  - валюта     — poe2scout/poe.ninja (курс)
 *  - прочее     — официальный trade API (медиана первых листингов)
 */
export async function priceCheck(
  itemText: string,
  opts: {
    league?: string;
    /** Переопределить имя предмета после парсинга (например, ru→en перевод). */
    nameOverride?: string;
    /** Переопределить базовый тип после парсинга (например, ru→en перевод словарём poe2db). */
    baseTypeOverride?: string;
  } = {},
): Promise<PriceCheckResult> {
  const league = opts.league ?? currentLeague ?? undefined;
  const parsed = parseItemText(itemText);
  // Русский клиент: trade2/poe2scout понимают только английские имена/базы.
  if (opts.nameOverride != null) parsed.name = opts.nameOverride;
  if (opts.baseTypeOverride != null) parsed.baseType = opts.baseTypeOverride;
  debugLog(
    'parse:',
    JSON.stringify({
      rarity: parsed.rarity,
      name: parsed.name,
      baseType: parsed.baseType,
      mods: parsed.mods.map((m) => `[${m.type}] ${m.text}`),
      league: league ?? '(active)',
    }),
  );
  let estimate: PriceEstimate | null = null;
  let listings: TradeListing[] = [];
  let note: string | undefined;
  // stat-id, сматченные по explicit-модам (для журнала обучения — см. learnlog.ts)
  let learnedStatIds: string[] = [];

  if (parsed.rarity === 'Unique' && (parsed.name ?? parsed.baseType)) {
    const v = await priceUniqueWithTimeout(
      parsed.name ?? parsed.baseType,
      league,
      parsed.itemClass || undefined,
      parsed.baseType || undefined,
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

  // Рары не ищутся по имени: строим stat-фильтры из explicit-модов
  // (прайс-чек «предмета с такими-то аффиксами» по официальному trade API).
  const explicitMods = parsed.mods
    .filter((m) => m.type === 'explicit')
    .map((m) => m.text)
    .filter((t) => t && t !== parsed.name && t !== parsed.baseType);

  if (
    !estimate &&
    parsed.rarity === 'Rare' &&
    explicitMods.length &&
    parsed.baseType
  ) {
    try {
      const { filters, unmatched } = await matchModsToStatFilters(explicitMods);
      learnedStatIds = filters.map((f) => f.id);
      debugLog(
        'matchModsToStatFilters:',
        `${filters.length} filters, ${unmatched.length} unmatched`,
        filters.map((f) => `${f.id}${f.min != null ? ` min=${f.min}` : ''}`),
        unmatched,
      );
      // ищем по статам, если распознано больше половины модов
      if (filters.length && unmatched.length <= Math.ceil(explicitMods.length / 2)) {
        // trade2-имя базового типа (валидация + маппинг через RePoE)
        const resolvedType = await resolveTradeBaseType(parsed.baseType!, { league });
        if (!resolvedType) {
          debugLog('resolveTradeBaseType: no valid type for', parsed.baseType);
        } else {
          const searchOpts = { league, limit: 10 };
          const pause = () => new Promise((r) => setTimeout(r, 300));
          // Лестница ослабления: точное попадание всех целевых аффиксов редко,
          // ищем ближайшие аналоги.
          // 1) все статы с минимумами («роллы не хуже ×0.9»)
          listings = await searchTradeByStats({ type: resolvedType, filters }, searchOpts);
          debugLog('searchTradeByStats and:', `${listings.length} listings`);
          // 2) «не менее 2/3 целевых статов» с минимумами
          if (!listings.length && filters.length >= 3) {
            await pause();
            listings = await searchTradeByStats(
              {
                type: resolvedType,
                filters,
                group: { type: 'count', value: Math.max(2, Math.ceil((filters.length * 2) / 3)) },
              },
              searchOpts,
            );
            debugLog('searchTradeByStats count:', `${listings.length} listings`);
          }
          estimate = estimateFromPrices(await listingsToChaosPrices(listings, league));
        }
      } else {
        debugLog('skip byStats: too few matched filters');
      }
    } catch (e) {
      // каталог статов недоступен — ниже фолбэк по базовому типу
      debugLog('byStats error:', e instanceof Error ? e.message : String(e));
    }
  }

  // Fallback по базовому типу: нужен, когда по статам листингов недостаточно
  // для оценки (0-2 шт.) — 1-2 листинга дают нулевую медиану/мин/макс.
  if (!estimate && listings.length < 3) {
    if (parsed.rarity === 'Rare' && parsed.baseType) {
      const resolvedType = await resolveTradeBaseType(parsed.baseType, { league });
      if (resolvedType) {
        listings = await searchTrade({ type: resolvedType }, { league });
        debugLog('fallback by base type:', `${listings.length} listings`);
        if (listings.length) note = 'Оценка по базовому типу без учёта аффиксов';
      } else {
        debugLog('fallback: no valid base type for', parsed.baseType);
      }
    } else if (parsed.name || parsed.baseType) {
      const resolvedType = parsed.baseType
        ? await resolveTradeBaseType(parsed.baseType, { league })
        : null;
      listings = await searchTrade(
        { name: parsed.name ?? undefined, type: resolvedType ?? undefined },
        { league },
      );
      debugLog('fallback by name/type:', `${listings.length} listings`);
    }
  }
  if (!estimate && listings.length) {
    // медиана по листингам с конвертацией валют в Chaos
    estimate = estimateFromPrices(await listingsToChaosPrices(listings, league));
    if (estimate && !note && parsed.rarity === 'Rare') {
      note = 'Оценка по листингам базового типа';
    }
  }
  if (estimate?.confidence === 'low') {
    note = note ? `${note}; мало листингов (low)` : 'Мало листингов (low)';
  }
  // note без estimate не осмыслен (оценивать нечего) — не вешаем ложную пометку.
  if (!estimate) note = undefined;

  // Журнал обучения (opt-in, PRIVACY: только структура предмета — см. learnlog.ts)
  recordLearnedItem({
    at: new Date().toISOString(),
    league: league ?? null,
    source: process.env['POE2K_LEARN_SOURCE'] ?? undefined,
    rarity: String(parsed.rarity ?? 'Unknown'),
    name: parsed.name,
    baseType: parsed.baseType ?? 'Unknown',
    itemClass: parsed.itemClass ?? null,
    itemLevel: parsed.itemLevel,
    reqLevel: parsed.requirements?.level ?? null,
    mods: explicitMods,
    statIds: learnedStatIds,
  });

  debugLog(
    'result:',
    JSON.stringify({ estimate, listings: listings.length, note, sources: null }),
  );

  return {
    itemName: itemDisplayName(parsed) || 'Неизвестный предмет',
    rarity: parsed.rarity.toLowerCase(),
    estimate,
    listings,
    note,
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

interface PriceBuildOpts {
  /** Лига (по умолчанию — текущая активная). */
  league?: string;
  /** Максимум одновременных запросов цены (защита от перебора категорий). По умолчанию 4. */
  concurrency?: number;
}

/** Прогнать priceCheck по всему снаряжению билда (share-код / XML / ссылка). */
export async function priceBuild(
  input: string,
  opts: PriceBuildOpts = {},
): Promise<BuildPriceReport> {
  const started = Date.now();
  const league = opts.league ?? currentLeague ?? null;
  const gear = await buildCodeToGear(input);
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, gear.length || 1));

  const results = new Array<BuildPricedItem>(gear.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= gear.length) return;
      const item = gear[i]!;
      try {
        const res = await priceCheck(item.itemText, { league: league ?? undefined });
        results[i] = {
          slot: item.slot,
          name: res.itemName,
          rarity: res.rarity,
          estimate: res.estimate,
          sources: res.sources,
          listingsCount: res.listings.length,
          ...(res.note ? { note: res.note } : {}),
        };
      } catch {
        results[i] = {
          slot: item.slot,
          name: item.name,
          rarity: 'other',
          estimate: null,
          sources: [],
          listingsCount: 0,
          note: 'Ошибка при прайс-чеке',
        };
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const priced = (results as BuildPricedItem[]).filter(
    (r) => r.estimate?.median != null,
  );
  const totalMin = priced.reduce((sum, r) => sum + (r.estimate!.min ?? 0), 0);
  const totalMax = priced.reduce((sum, r) => sum + (r.estimate!.max ?? 0), 0);
  const totalMedian = priced.reduce((sum, r) => sum + (r.estimate!.median ?? 0), 0);

  return {
    league,
    items: results.map((r) => r ?? ({
      slot: '', name: '—', rarity: 'other', estimate: null, sources: [], listingsCount: 0,
    })) as BuildPricedItem[],
    totalMin,
    totalMax,
    totalMedian,
    totalCurrency: 'chaos',
    pricedCount: priced.length,
    totalItems: gear.length,
    elapsedMs: Date.now() - started,
  };
}