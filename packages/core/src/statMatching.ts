/**
 * Stat-id матчинг по тексту мода — конкурентное лечение патч-болей S7 (№183).
 *
 * Боль: каждый патч GGG меняет stat-id (и иногда тексты) в catalog
 * /api/trade2/data/stats — матчинг «текст мода рара → stat_id» ломался и
 * держался на ручном learn-журнале до выпуска фикса.
 *
 * Лечение — три контура (синтез Exiled-Exchange-2 + Sidekick, оба MIT;
 * приёмы reimplement, не copy — см. отчеты КУБ-3):
 *   1. Оффлайн-дамп живого API: data/game/trade/trade_stats.json — свежий
 *      слепок официального каталога (refresh: scripts/fetch-trade-stats.mjs).
 *      Instant-lookup по нормализованному тексту, без сети.
 *   2. Live-fallback (ExE2 TradeData.ts:52-95): при промахе в дампе — ОДИН
 *      живой запрос GET /api/trade2/data/stats (кэш + rate-limit our-http,
 *      результат мемоизируется). Чинит свежий патч без релиза.
 *   3. Learn-библиотека (learnedStats.ts) — последний офлайн-слой уверенности.
 *
 * Placeholder-матчер (ExE2 stat-translations.ts:76-224, минимальный набор):
 *   - нормализация: trim, lower, collapse пробелов;
 *   - числа → '#': кандидаты «все числа → #» + «одно число оставить, rest → #»
 *     (перебор комбинаций ограничен: k ≤ 4 чисел, k+1 кандидатов — не весь
 *     зоопарк ExE2 с 2/4-слойными скобочными баундсами — нашим потребителем
 *     (клир-текст игры) скобочные баунды не встречаются);
 *   - negate-варианты: «reduced» → «increased» (каталог хранит reduced-роллы
 *     как increased с отрицательным значением), знак числа срезается в '#';
 *   - legacy-скобки: суффикс «(legacy)» вырезается с обеих сторон матча.
 *
 * Unknown-handling (Sidekick StatParser.cs:96-175, HasTradeSupport):
 *   каждый стат размечается trade-ready | text-only; полный промах —
 *   Result-совместимый err(parse) с payload.unknown (список нераспознанных).
 *
 * Слой аддитивный: публичный API trade.ts (matchStatFilter и др.) не меняется.
 */

import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';
import { cachedJson, DEFAULT_TTLS } from './cache.js';
import { getLearnedStatTemplates } from './learnedStats.js';
import { err, ok, type Result } from './result.js';

/** Копия константы trade2 (без импорта trade.js — тот зависит от нас). */
const TRADE_API = 'https://www.pathofexile.com/api/trade2';

// ────────────────────────────────────────────────
// Типы
// ────────────────────────────────────────────────

/** Запись каталога статов (та же форма, что TradeStatEntry из trade.ts). */
export interface StatCatalogEntry {
  id: string;
  text: string;
  /** Группа каталога: explicit / implicit / pseudo / crafted / … */
  type?: string;
}

/** Откуда сматчился stat-id. */
export type StatMatchSource = 'offline' | 'live' | 'unknown';

/** Результат матчинга одного стата; id === null → не распознан нигде. */
export interface StatMatch {
  id: string | null;
  source: StatMatchSource;
  /** Исходный текст мода (echo для UI/журналов). */
  text: string;
  /** Нижняя граница значения (max × 0.9 — паритет с matchStatFilter в trade.ts).
   *  undefined: стат без чисел или negate-вариант (semantics negative-ролла). */
  min?: number;
  /** Шаблон каталога, с которым сматчились (отладка/diff). */
  matchedText?: string;
}

/** per-stat разметка HasTradeSupport (Sidekick-паттерн): trade-ready | text-only. */
export interface StatMatchBulkItem {
  text: string;
  match: StatMatch;
  /** true = stat-id найден, фильтр trade2 строится (trade-ready). */
  tradeReady: boolean;
}

/** Итог матчинга списка статов. unknown = то, что неparsed нигде. */
export interface StatMatchingPayload {
  matches: StatMatchBulkItem[];
  unknown: string[];
  offlineMatches: number;
  liveMatches: number;
}

/** Result-совместимый исход с payload В ЛЮБОМ случае (ok и err). */
export type StatMatchingResult = Result<StatMatchingPayload> & { payload: StatMatchingPayload };

export interface StatMatchOptions {
  /** Полная подмена оффлайн-каталога (тесты; заменяет дамп + learned). */
  offlineEntries?: StatCatalogEntry[];
  /** Дополнительные офлайн-шаблоны поверх датасета (learn-журнал — trade.ts). */
  extraOfflineEntries?: StatCatalogEntry[];
  /** Injectable живой fetch каталога (тесты: без реальной сети). */
  fetchLive?: () => Promise<StatCatalogEntry[]>;
  /** Запретить live-фолбэк (оффлайн-_only контекст/тесты). */
  noLive?: boolean;
  /** Предпочтительная группа при множественном совпадении (explicit). */
  preferredType?: string;
}

// ────────────────────────────────────────────────
// Нормализация и кандидаты (ExE2-минимум)
// ────────────────────────────────────────────────

function normalizeStatText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Вырезать «(legacy)»-суффикс — запасной вариант матчинга (ExE2 legacy-роллы). */
function stripLegacy(s: string): string {
  return s.replace(/\s*\(legacy\)\s*$/i, '').trim();
}

/** Число с опциональным знаком (знак срезается при замене на '#'). */
const NUM_RE = /[-+]?\d+(?:\.\d+)?/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Candidate {
  key: string;
  /** Кандидат получен swap-ом «reduced»→«increased» (semantics отриц. ролла). */
  negated: boolean;
}

/**
 * Кандидаты-ключи для lookup текста стата в индексе каталога, по приоритету:
 *   1. нормализованный текст как есть (точный матч, включая числа);
 *   2. все числа → '#';
 *   3. «одно число оставить, остальные → '#'» (комбинации, k ≤ 4);
 *   4. то же с swap-ом reduced→increased и/или вырезанным «(legacy)».
 * Порядок гарантирует, что родной шаблон каталога бьёт swap-вариант.
 */
function makeCandidates(text: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const push = (key: string, negated: boolean): void => {
    const k = key.trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ key: k, negated });
  };

  for (const base of new Set([normalizeStatText(text), stripLegacy(normalizeStatText(text))])) {
    for (const negated of [false, true]) {
      const s = negated ? base.replace(/\breduced\b/g, 'increased') : base;
      if (negated && s === base) continue; // swap нечего менять — дубль варианта
      push(s, negated);
      // Все числа → '#' (знак срезается: «-15% …» и «+15% …» → «#% …»)
      push(s.replace(NUM_RE, '#'), negated);
      // Комбинации «оставить одно число»: шаблоны каталога с литеральными числами
      const nums = [...s.matchAll(new RegExp(NUM_RE.source, 'g'))];
      if (nums.length >= 2 && nums.length <= 4) {
        for (let i = 0; i < nums.length; i++) {
          let variant = '';
          let last = 0;
          for (let j = 0; j < nums.length; j++) {
            const m = nums[j]!;
            variant += s.slice(last, m.index);
            variant += i === j ? m[0] : '#';
            last = (m.index ?? 0) + m[0].length;
          }
          variant += s.slice(last);
          push(variant, negated);
        }
      }
    }
  }
  return out;
}

/** Индекс каталога: нормализованный шаблон ('#' внутри) → записи каталога. */
type CatalogIndex = Map<string, StatCatalogEntry[]>;

function buildIndex(entries: StatCatalogEntry[]): CatalogIndex {
  const index: CatalogIndex = new Map();
  for (const e of entries) {
    if (!e || typeof e.id !== 'string' || typeof e.text !== 'string' || !e.text) continue;
    const n = normalizeStatText(e.text);
    if (!n) continue;
    for (const key of new Set([n, stripLegacy(n)])) {
      const bucket = index.get(key);
      if (bucket) bucket.push(e);
      else index.set(key, [e]);
    }
  }
  return index;
}

/** Лучший кандидат из совпавших по одному ключу: длиннейший текст, затем
 *  предпочтительная группа (explicit перед pseudo/implicit при равном тексте —
 *  для trade-фильтров explicit-модов это правильный id). */
function pickBest(entries: StatCatalogEntry[], preferredType?: string): StatCatalogEntry {
  let best = entries[0]!;
  for (const e of entries) {
    const bl = normalizeStatText(best.text).length;
    const el = normalizeStatText(e.text).length;
    if (el > bl) {
      best = e;
    } else if (el === bl) {
      const bestPrefers = preferredType && best.type === preferredType;
      const ePrefers = preferredType && e.type === preferredType;
      if (ePrefers && !bestPrefers) best = e;
    }
  }
  return best;
}

/** Ролл из шаблона: числа в позициях '#' → { min } (max × 0.9, паритет trade.ts). */
function extractMin(entryText: string, normText: string): number | undefined {
  const template = normalizeStatText(entryText);
  if (!template.includes('#')) return undefined;
  const pattern = '^' + escapeRegExp(template).replace(/#/g, '([+-]?\\d+(?:\\.\\d+)?)') + '$';
  let m: RegExpExecArray | null = null;
  try {
    m = new RegExp(pattern).exec(normText) ?? new RegExp(pattern).exec(stripLegacy(normText));
  } catch {
    return undefined;
  }
  if (!m) return undefined;
  const values = m.slice(1).map(Number).filter((v) => Number.isFinite(v));
  if (!values.length) return undefined;
  return Math.max(...values) * 0.9;
}

interface FoundEntry {
  entry: StatCatalogEntry;
  negated: boolean;
}

function findInIndex(
  index: CatalogIndex,
  text: string,
  preferredType?: string,
): FoundEntry | null {
  const candidates = makeCandidates(text);
  for (const c of candidates) {
    const bucket = index.get(c.key);
    if (bucket && bucket.length) {
      return { entry: pickBest(bucket, preferredType), negated: c.negated };
    }
  }
  return null;
}

// ────────────────────────────────────────────────
// Оффлайн-слой: свежий дамп каталога + learn-библиотека
// ────────────────────────────────────────────────

interface TradeStatsFile {
  _meta?: { source?: string; fetchedAt?: string; entries?: number };
  result?: Array<{ id?: string; label?: string; entries?: Array<{ id?: string; text?: string; type?: string }> }>;
}

function tradeStatsPath(): string {
  return pathMod!.join(
    pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)),
    '..',
    'data',
    'game',
    'trade',
    'trade_stats.json',
  );
}

/** Свежесть дампа → live-first после этого порога (протухший дамп не
 *  должен затирать правду живого каталога). */
const STALE_AFTER_MS = 45 * 24 * 60 * 60 * 1000;

let offlineCache: { index: CatalogIndex; entries: number; fetchedAt: number | null } | null = null;

function getOfflineIndex(): { index: CatalogIndex; entries: number; fetchedAt: number | null } {
  if (offlineCache) return offlineCache;
  let entries: StatCatalogEntry[] = [];
  let fetchedAt: number | null = null;
  if (HAS_DISK) {
    try {
      const raw = JSON.parse(fsMod!.readFileSync(tradeStatsPath(), 'utf8')) as TradeStatsFile;
      for (const group of raw.result ?? []) {
        for (const e of group.entries ?? []) {
          if (typeof e.id === 'string' && typeof e.text === 'string') {
            entries.push({ id: e.id, text: e.text, type: group.id ?? e.type });
          }
        }
      }
      fetchedAt = raw._meta?.fetchedAt ? Date.parse(raw._meta.fetchedAt) : null;
      if (!Number.isFinite(fetchedAt as number)) fetchedAt = null;
    } catch {
      entries = [];
    }
  }
  // Learn-библиотека — последний офлайн-слой уверенности (см. learnedStats.ts)
  entries = entries.concat(getLearnedStatTemplates() as StatCatalogEntry[]);
  offlineCache = { index: buildIndex(entries), entries: entries.length, fetchedAt };
  return offlineCache;
}

// ────────────────────────────────────────────────
// Live-fallback: один живой запрос, мемоизация, negative-memo
// ────────────────────────────────────────────────

const LIVE_FAIL_RETRY_MS = 5 * 60 * 1000;

const liveState: {
  fetcher: (() => Promise<StatCatalogEntry[]>) | null;
  ok: CatalogIndex | null;
  failedAt: number;
} = { fetcher: null, ok: null, failedAt: 0 };

/** Дефолтный живой fetch: кэш-disk our-http (TTL репо-класса, stale-if-error),
 *  rate-limit хоста — как у fetchTradeStats() в trade.ts. */
async function defaultFetchLive(): Promise<StatCatalogEntry[]> {
  const { data } = await cachedJson<{ result?: Array<{ id?: string; entries?: Array<{ id?: string; text?: string }> }> }>(
    `${TRADE_API}/data/stats`,
    { ttlMs: DEFAULT_TTLS.repoe },
  );
  const out: StatCatalogEntry[] = [];
  for (const group of data.result ?? []) {
    for (const e of group.entries ?? []) {
      if (typeof e.id === 'string' && typeof e.text === 'string') {
        out.push({ id: e.id, text: e.text, type: group.id });
      }
    }
  }
  if (!out.length) throw new Error('trade2/data/stats: empty catalog');
  return out;
}

/**
 * Живой каталог с мемоизацией: success кэшится навсегда (до reset), fail — на
 * 5 минут (negative-memo: прайс-чек не должен долбить лежащий API на каждый стат).
 * Мемоизация привязана к функции-fetcher: подмена fetcher (тесты) сбрасывает её.
 */
async function getLiveIndex(opts: StatMatchOptions): Promise<CatalogIndex | null> {
  if (opts.noLive) return null;
  const fetcher = opts.fetchLive ?? defaultFetchLive;
  if (liveState.fetcher === fetcher) {
    if (liveState.ok) return liveState.ok;
    if (Date.now() - liveState.failedAt < LIVE_FAIL_RETRY_MS) return null;
  }
  liveState.fetcher = fetcher;
  try {
    const entries = await fetcher();
    liveState.ok = buildIndex(entries);
    liveState.failedAt = 0;
    return liveState.ok;
  } catch {
    liveState.ok = null;
    liveState.failedAt = Date.now();
    return null;
  }
}

/** Сброс кэшей слоя (тесты/самодиагностика). */
export function resetStatMatchingCaches(): void {
  offlineCache = null;
  liveState.fetcher = null;
  liveState.ok = null;
  liveState.failedAt = 0;
}

// ────────────────────────────────────────────────
// Публичный API
// ────────────────────────────────────────────────

function toStatMatch(
  found: FoundEntry | null,
  text: string,
  source: StatMatchSource,
  preferredType?: string,
): StatMatch {
  if (!found) return { id: null, source: 'unknown', text };
  const normText = normalizeStatText(text);
  const min = found.negated ? undefined : extractMin(found.entry.text, normText);
  return {
    id: found.entry.id,
    source,
    text,
    ...(min !== undefined ? { min } : {}),
    matchedText: found.entry.text,
  };
}

/**
 * Матчинг ОДНОГО стата: текст мода → { id, source }.
 * Порядок слоёв: свежий оффлайн-дамп → живой fallback → unknown;
 * протухший дамп (>45 дней) → сначала живой, дамп как фолбэк.
 */
export async function matchStat(text: string, opts: StatMatchOptions = {}): Promise<StatMatch> {
  const { matches } = await matchStatsBulk([text], opts);
  return matches[0]?.match ?? { id: null, source: 'unknown', text };
}

/**
 * Bulk-матчинг: список текстов статов → per-stat разметка HasTradeSupport
 * (Sidekick-паттерн): каждый стат trade-ready | text-only. Живой каталог
 * тянется максимум ОДИН раз на вызов (и мемоизируется между вызовами).
 */
export async function matchStatsBulk(
  mods: string[],
  opts: StatMatchOptions = {},
): Promise<StatMatchingPayload> {
  const preferredType = opts.preferredType ?? 'explicit';
  let offline: CatalogIndex;
  let offlineFresh = true;
  if (opts.offlineEntries !== undefined) {
    offline = buildIndex([...opts.offlineEntries, ...(opts.extraOfflineEntries ?? [])]);
  } else {
    const o = getOfflineIndex();
    offline = opts.extraOfflineEntries
      ? buildIndex([...flattenIndex(o.index), ...opts.extraOfflineEntries])
      : o.index;
    // Протухший дамп (>45 дней): живой каталог правдивее — live-first.
    offlineFresh = !(o.fetchedAt && Date.now() - o.fetchedAt > STALE_AFTER_MS);
  }

  const liveNeeded = async (): Promise<CatalogIndex | null> => getLiveIndex(opts);

  const matches: StatMatchBulkItem[] = [];
  const unknown: string[] = [];
  let offlineMatches = 0;
  let liveMatches = 0;

  // Кэш индексов на вызов: live тянем лениво и не больше одного раза.
  let live: CatalogIndex | null | undefined;

  for (const text of mods) {
    const item = async (): Promise<StatMatchBulkItem> => {
      // Порядок: fresh dump → live; stale dump → live → dump.
      const order: Array<'offline' | 'live'> = offlineFresh
        ? ['offline', 'live']
        : ['live', 'offline'];
      for (const layer of order) {
        if (layer === 'offline') {
          const found = findInIndex(offline, text, preferredType);
          if (found) {
            return { text, match: toStatMatch(found, text, 'offline', preferredType), tradeReady: true };
          }
        } else {
          if (live === undefined) live = await liveNeeded();
          if (live) {
            const found = findInIndex(live, text, preferredType);
            if (found) {
              return { text, match: toStatMatch(found, text, 'live', preferredType), tradeReady: true };
            }
          }
        }
      }
      return { text, match: { id: null, source: 'unknown', text }, tradeReady: false };
    };
    const r = await item();
    matches.push(r);
    if (r.tradeReady) {
      if (r.match.source === 'offline') offlineMatches++;
      else if (r.match.source === 'live') liveMatches++;
    } else {
      unknown.push(text);
    }
  }

  return { matches, unknown, offlineMatches, liveMatches };
}

function flattenIndex(index: CatalogIndex): StatCatalogEntry[] {
  const out: StatCatalogEntry[] = [];
  for (const bucket of index.values()) out.push(...bucket);
  return out;
}

/**
 * Result-обёртка unknown-handling: полный промах всех статов — Result-совместимый
 * err(parse) (не ретраится: текст не belongs каталогу), список неизвестных — в
 * payload.unknown (материал для будущего UX «Not recognized → Reload»). Частичный
 * матч — ok с payload.unknown.
 */
export async function matchStatsBulkResult(
  mods: string[],
  opts: StatMatchOptions = {},
): Promise<StatMatchingResult> {
  const payload = await matchStatsBulk(mods, opts);
  const anyReady = payload.matches.some((m) => m.tradeReady);
  if (!anyReady) {
    const base = err('parse', `stat matching failed: unknown mods [${payload.unknown.join(' | ')}]`);
    return { ...base, payload };
  }
  return { ...ok(payload), payload };
}

/** Само-отчёт слоя (диагностика/тулы info): размеры и свежесть контуров. */
export function statMatchingInfo(): {
  offlineEntries: number;
  dumpFetchedAt: string | null;
  dumpStale: boolean;
  liveMemoized: boolean;
} {
  const o = getOfflineIndex();
  return {
    offlineEntries: o.entries,
    dumpFetchedAt: o.fetchedAt ? new Date(o.fetchedAt).toISOString() : null,
    dumpStale: !!(o.fetchedAt && Date.now() - o.fetchedAt > STALE_AFTER_MS),
    liveMemoized: liveState.ok !== null,
  };
}
