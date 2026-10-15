/**
 * Витрина poeshop.ru как офлайн-датасет рыночных цен (волна poeshop-интеграции).
 *
 * Источник: data/game/market/poeshop_market.json, генератор
 * scripts/gen-poeshop-market.mjs (скрап каталога poeshop.ru, Next.js flight-чанки).
 *
 * ЗАЧЕМ: каталог уников кита (uniques.ts) не знает цен; scout-канал слаб по уникам
 * (особенно дорогие/редкие). poeshop закрывает пробел: divine/exalt/chaos — рыночный
 * агрегат по лигам, rub — цена витрины услуг (RMT, НЕ рыночная стоимость гира).
 * Главный сценарий: Ctrl+C уника (вкл. RU-клиент) → вердикт «ценный — не выкидывай».
 *
 * Caveats честные: срез Standard устаревает (см. fetchedAt каждой лиги), у дешёвых
 * предметов rub имеет floor ≈50₽ (минимальная цена витрины).
 */

import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';

/** Цены одного предмета в одной лиге (компактный формат генератора). */
export interface PoeshopLeaguePrices {
  divine: number | null;
  exalt: number | null;
  chaos: number | null;
  rub: number | null;
  change7d: number | null;
  fetchedAt: string | null;
}

/** Одна запись датасета poeshop (ключ = norm полного имени EN). */
export interface PoeshopMarketEntry {
  en: string;
  ru: string | null;
  /** Каноническое имя уника (из каталога кита, если смэтчилось). */
  name: string;
  base: string | null;
  sub: string;
  leagues: Record<string, PoeshopLeaguePrices>;
}

/** Коды лиг poeshop (ключи leagues в датасете). */
export type PoeshopLeagueCode =
  | 'standard'
  | 'hardcore'
  | 'new-league'
  | 'hardcore-new-league'
  | 'forbidden-rites'
  | 'hardcore-forbidden-rites';

interface DatasetShape {
  _meta?: { provenance?: string; generatedAt?: string; caveats?: string[]; leagueTitles?: Record<string, string>; counts?: Record<string, number> };
  items?: Record<string, PoeshopMarketEntry>;
  ruIndex?: Record<string, string>;
  aliasIndex?: Record<string, string[]>;
}

/** Вердикт ценности уника по порогам в divine. */
export type PoeshopValueTier = 'jackpot' | 'valuable' | 'keep' | 'sellable' | 'trash';

export interface PoeshopVerdict {
  tier: PoeshopValueTier;
  /** Человекочитаемый вердикт («🔴 не выкидывай — очень ценный»). */
  text: string;
  /** Оценка в divine (по которой взят порог). */
  divine: number;
}

export interface PoeshopMarketLookup {
  /** Запись датасета (или null, если предмет не найден). */
  entry: PoeshopMarketEntry | null;
  /** Запрошенная лига; null, если предмет в ней не торгуется. */
  league: PoeshopLeagueCode | null;
  prices: PoeshopLeaguePrices | null;
  verdict: PoeshopVerdict | null;
  /** Свежесть среза лиги (дата-код YYYY-MM-DD или null). */
  freshness: string | null;
  /** Метадата датасета (provenance/caveats) для дисклеймера в tuлах. */
  caveats: string[];
  provenance: string;
  /** Если запрос был RU-именем или каноническим именем с вариантами баз. */
  matchedBy: 'en' | 'ru' | 'alias' | null;
  /** Варианты баз (Runeforged/Runemastered и т.п.), если по имени >1 запись. */
  variants: PoeshopMarketEntry[];
}

let dsCache: DatasetShape | null = null;
let byEnCache: Map<string, PoeshopMarketEntry> | null = null;
let byRuCache: Map<string, PoeshopMarketEntry> | null = null;

function dataFile(): string {
  return pathMod!.join(
    pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)),
    '..',
    'data',
    'game',
    'market',
    'poeshop_market.json',
  );
}

function loadDataset(): DatasetShape {
  if (dsCache) return dsCache;
  if (!HAS_DISK) throw new Error('Офлайн-датасет poeshop недоступен в браузере');
  dsCache = JSON.parse(fsMod!.readFileSync(dataFile(), 'utf8')) as DatasetShape;
  if (dsCache) {
    byEnCache = new Map(Object.entries(dsCache.items ?? {}));
    byRuCache = new Map(
      Object.entries(dsCache.ruIndex ?? {})
        .map(([k, v]) => [k, byEnCache!.get(v)] as const)
        .filter((p): p is readonly [string, PoeshopMarketEntry] => p[1] != null)
        .map(([k, e]) => [k, e]),
    );
  }
  return dsCache;
}

/** Метадата датасета (provenance, caveats, counts) для дисклеймеров. */
export function poeshopMarketMeta(): { provenance: string; generatedAt: string | null; caveats: string[]; counts: Record<string, number> } {
  const m = loadDataset()._meta ?? {};
  return {
    provenance: m.provenance ?? 'poeshop.ru',
    generatedAt: m.generatedAt ?? null,
    caveats: m.caveats ?? [],
    counts: m.counts ?? {},
  };
}

/** Маппинг привычных названий лиг → код poeshop. */
const LEAGUE_ALIASES: Array<[RegExp, PoeshopLeagueCode]> = [
  [/^(the )?runes of aldur$|^new[- ]?league$/i, 'new-league'],
  [/^hc runes of aldur$|^hardcore new[- ]?league$|^hardcore[- ]runes/i, 'hardcore-new-league'],
  [/^(the )?forbidden (rites|rite)$/i, 'forbidden-rites'],
  [/^hc (the )?forbidden|hardcore[- ]forbidden/i, 'hardcore-forbidden-rites'],
  [/^hc standard$|^hardcore standard$/i, 'hardcore'],
  [/^(softcore )?(standard|default)$/i, 'standard'],
  [/^hc$|^hardcore$/i, 'hardcore'],
];

/** Резолв названия лиги в код poeshop; null = не признали. */
export function resolvePoeshopLeague(league: string | null | undefined): PoeshopLeagueCode | null {
  if (!league) return null;
  const q = league.trim().toLowerCase();
  for (const [re, code] of LEAGUE_ALIASES) {
    if (re.test(q)) return code;
  }
  // Код poeshop передали напрямую
  const ds = loadDataset();
  const first = ds.items ? Object.values(ds.items)[0] : null;
  if (!first) return null;
  if (league in first.leagues) return league as PoeshopLeagueCode;
  return null;
}

/** Приоритет лиг, если лигу не указали: свежие челлендж-лиги > Standard. */
const LEAGUE_PRIORITY: PoeshopLeagueCode[] = [
  'forbidden-rites',
  'new-league',
  'hardcore-forbidden-rites',
  'hardcore-new-league',
  'standard',
  'hardcore',
];

/** Вердикт ценности: пороги в divine (0.01/0.1/1/10). */
export function poeshopVerdict(div: number | null): PoeshopVerdict | null {
  if (div == null || !(div > 0)) return null;
  if (div >= 10) return { tier: 'jackpot', text: '🔴 очень ценный — НЕ выкидывай, проверь ролл и продавай', divine: div };
  if (div >= 1) return { tier: 'valuable', text: '🟠 ценный — не выкидывай, стоит продажи', divine: div };
  if (div >= 0.1) return { tier: 'keep', text: '🟡 можно продать, но дёшево', divine: div };
  if (div >= 0.01) return { tier: 'sellable', text: '🟢 почти мусор — продавать только пачкой/поставить на 1 ex', divine: div };
  return { tier: 'trash', text: '⚪ мусор — можно не подбирать', divine: div };
}

/**
 * Поиск записи poeshop по имени (EN полное «Temporalis Silk Robe», каноническое
 * «Temporalis» или RU «Темпоралис»), опционально с лигой. Офлайн, без сети.
 */
export function lookupPoeshopMarket(
  name: string,
  league?: string | null,
): PoeshopMarketLookup {
  const ds = loadDataset();
  const meta = poeshopMarketMeta();
  const empty: PoeshopMarketLookup = {
    entry: null, league: null, prices: null, verdict: null, freshness: null,
    caveats: meta.caveats, provenance: meta.provenance, matchedBy: null, variants: [],
  };
  const q = (name ?? '').trim().toLowerCase();
  if (!q) return empty;

  let entry: PoeshopMarketEntry | undefined;
  let matchedBy: PoeshopMarketLookup['matchedBy'] = null;
  if (byEnCache!.has(q)) {
    entry = byEnCache!.get(q)!;
    matchedBy = 'en';
  } else if (byRuCache!.has(q)) {
    entry = byRuCache!.get(q)!;
    matchedBy = 'ru';
  } else {
    // Каноническое имя уника («Temporalis») → варианты баз (Runeforged и т.п.)
    const variants = (ds.aliasIndex?.[q] ?? []).map((k) => byEnCache!.get(k)).filter((e): e is PoeshopMarketEntry => e != null);
    if (variants.length) return { ...empty, matchedBy: 'alias', variants, entry: null };
    return empty;
  }

  const leagueCode: PoeshopLeagueCode | null = resolvePoeshopLeague(league);
  let prices: PoeshopLeaguePrices | null = null;
  let usedLeague: PoeshopLeagueCode | null = null;
  if (leagueCode && entry.leagues[leagueCode]?.divine != null) {
    prices = entry.leagues[leagueCode];
    usedLeague = leagueCode;
  } else {
    // Без лиги (или в запрошенной нет цен) — первая по приоритету с ценой.
    for (const lg of LEAGUE_PRIORITY) {
      const p = entry.leagues[lg];
      if (p?.divine != null) {
        prices = p;
        usedLeague = lg;
        break;
      }
    }
  }

  const verdict = poeshopVerdict(prices?.divine ?? null);
  return {
    entry,
    league: usedLeague,
    prices,
    verdict,
    freshness: prices?.fetchedAt ?? null,
    caveats: meta.caveats,
    provenance: meta.provenance,
    matchedBy,
    variants: [entry],
  };
}

/** Подсказка:market-записи по подстроке EN/RU имени, limit по умолчанию 10. */
export function searchPoeshopMarket(query: string, limit = 10): PoeshopMarketEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = [...byEnCache!.values()];
  return all
    .filter((e) => e.en.toLowerCase().includes(q) || (e.ru && e.ru.toLowerCase().includes(q)))
    .sort((a, b) => a.en.length - b.en.length)
    .slice(0, limit);
}
