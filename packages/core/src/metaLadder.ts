/**
 * Meta-ladder poe.ninja PoE2: доли ascendancy-классов по ладдеру из
 * build-index-state (P7, W1).
 *
 * Эндпоинт подтверждён живым (GET, без auth): donor Tincture scripts/distill.py
 * (MIT © 2026 Ryan Duke): BUILD_INDEX_URL (distill.py:61), index_by_url
 * (:225-242), normalize_one (:245-293), largest-remainder apportionment
 * (:296-330). Порт идей на TS с адаптацией под наши типы; честность донора
 * сохранена: счётчики РЕКОНСТРУИРОВАНЫ из доли×total (est), undefined-ы и
 * мусорные total пропускаются, дубли leagueUrl не перезаписывают первый.
 *
 * Чего в источнике НЕТ (осознанное ограничение): доминирующего скилла
 * (distill.py:285) — только ascendancy; eternal-лиги без statistics.
 */

import { httpJson } from './http.js';

const BUILD_INDEX_URL = 'https://poe.ninja/poe2/api/data/build-index-state';

/** TTL кэша сырого ответа: poe.ninja обновляет данные ~раз в час. */
const INDEX_TTL_MS = 15 * 60 * 1000;

// ─── Типы источника (форма записей из distill.py:249-256) ──────────────────

interface RawStatistic {
  class?: unknown;
  percentage?: unknown;
  trend?: unknown;
}

interface RawLeagueBuild {
  leagueName?: unknown;
  leagueUrl?: unknown;
  total?: unknown;
  statistics?: unknown;
}

interface RawBuildIndex {
  leagueBuilds?: unknown;
}

// ─── Публичные типы ───────────────────────────────────────────────────────

/** Один ascendancy в ладдере лиги. */
export interface MetaLadderTop {
  /** Ascendancy-имя (poe.ninja ранжирует именно его в поле "class"). */
  asc: string;
  /** Базовый класс ('' — если новый/неизвестный ascendancy вне ASC_TO_CLASS). */
  className: string;
  /** Доля ладдера, % (округлено до 0.1). */
  sharePct: number;
  /** Тренд poe.ninja: -1 падение / 0 стабильно / 1 рост. */
  trend: number;
  /** РЕКОНСТРУИРОВАННЫЙ счётчик (largest-remainder от share×total) — оценка,
   *  не измеренное poe.ninja число. Сумма по лиге ≤ total (честность донора). */
  estCount: number;
}

/** Лига из build-index-state. */
export interface MetaLeague {
  /** url-слаг лиги (напр. 'forbiddenrites', 'forbiddenriteshc'). */
  url: string;
  /** DISPLAY-имя лиги. */
  name: string;
  /** Число персонажей в ладдере (0 — если upstream дал мусор). */
  total: number;
  /** Ascendancy-топы (пусто у permanent-лиг — poe.ninja их не публикует). */
  tops: MetaLadderTop[];
}

/** Человекочитаемый тренд. */
export function trendLabel(trend: number): string {
  if (trend > 0) return 'растёт';
  if (trend < 0) return 'падает';
  return 'стабильно';
}

/**
 * Базовый класс по ascendancy (Tincture ASC_TO_CLASS, distill.py:121-130).
 * Новые ascendancy после патча остаются видны, но без класса.
 */
export const ASC_TO_CLASS: Record<string, string> = {
  Titan: 'Warrior',
  Warbringer: 'Warrior',
  'Smith of Kitava': 'Warrior',
  Infernalist: 'Witch',
  'Blood Mage': 'Witch',
  Lich: 'Witch',
  'Abyssal Lich': 'Witch',
  Deadeye: 'Ranger',
  Pathfinder: 'Ranger',
  Invoker: 'Monk',
  'Acolyte of Chayula': 'Monk',
  'Martial Artist': 'Monk',
  Witchhunter: 'Mercenary',
  'Gemling Legionnaire': 'Mercenary',
  Tactician: 'Mercenary',
  Stormweaver: 'Sorceress',
  Chronomancer: 'Sorceress',
  'Disciple of Varashta': 'Sorceress',
  'Spirit Walker': 'Huntress',
  Amazon: 'Huntress',
  Ritualist: 'Huntress',
  Oracle: 'Druid',
  Shaman: 'Druid',
};

// ─── Чистая нормализация (тестируемая без сети) ───────────────────────────

/** {url: raw} raw-пейлоада; фальшивые url пропущены, дубли не перезаписывают. */
function indexByUrl(raw: RawBuildIndex): Map<string, RawLeagueBuild> {
  const out = new Map<string, RawLeagueBuild>();
  if (!raw || typeof raw !== 'object') return out;
  const builds = Array.isArray(raw.leagueBuilds) ? (raw.leagueBuilds as unknown[]) : [];
  for (const item of builds) {
    if (!item || typeof item !== 'object') continue;
    const l = item as RawLeagueBuild;
    const url = typeof l.leagueUrl === 'string' ? l.leagueUrl : '';
    if (!url) continue;
    if (out.has(url)) continue; // distill.py:239 — дубли не затирают первый
    out.set(url, l);
  }
  return out;
}

/** total с защитой от мусора («124,248»/строки → 0, не ValidationError). */
function coerceTotal(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, ''));
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return 0;
}

/** Largest-remainder: estCount суммарно ≤ total (порт distill.py:296-330). */
export function apportionEstCounts(shares: number[], total: number): number[] {
  const n = shares.length;
  if (!n) return [];
  if (!total) return new Array(n).fill(0);
  let exacts = shares.map((s) => (total * s) / 100);
  const rawSum = exacts.reduce((a, b) => a + b, 0);
  if (rawSum > total) {
    // доли top-N могут суммарно >100% (пересечения/округления) — пропорц. вниз
    const scale = total / rawSum;
    exacts = exacts.map((e) => e * scale);
  }
  const floors = exacts.map((e) => Math.floor(e));
  const target = Math.min(total, Math.round(exacts.reduce((a, b) => a + b, 0)));
  const deficit = Math.max(0, target - floors.reduce((a, b) => a + b, 0));
  const order = exacts.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac);
  const ns = [...floors];
  for (const { i } of order.slice(0, deficit)) ns[i] += 1;
  return ns;
}

/** Одна raw-лига → MetaLeague (порт normalize_one, distill.py:245-293). */
export function normalizeMetaLeague(raw: RawLeagueBuild): MetaLeague | null {
  const url = typeof raw.leagueUrl === 'string' ? raw.leagueUrl : '';
  if (!url) return null;
  const name = typeof raw.leagueName === 'string' ? raw.leagueName : url;
  const total = coerceTotal(raw.total);
  const stats = Array.isArray(raw.statistics) ? (raw.statistics as unknown[]) : [];

  const shares: number[] = [];
  const rows: Array<{ asc: string; className: string; sharePct: number; trend: number }> = [];
  for (const s of stats) {
    if (!s || typeof s !== 'object') continue;
    const st = s as RawStatistic;
    const asc = typeof st.class === 'string' ? st.class : '';
    const pop = Number(st.percentage);
    if (!asc || !Number.isFinite(pop)) continue;
    const trend = typeof st.trend === 'number' && Number.isFinite(st.trend) ? st.trend : 0;
    rows.push({
      asc,
      className: ASC_TO_CLASS[asc] ?? '',
      sharePct: Math.round(pop * 10) / 10,
      trend,
    });
    shares.push(pop); // неокругленная доля — в апортион
  }
  // Сортировка по доле до апортиона — порядок выдачи = топов.
  const idx = rows.map((_, i) => i).sort((a, b) => shares[b] - shares[a]);
  const ordered = idx.map((i) => rows[i]!);
  const orderedShares = idx.map((i) => shares[i]!);
  const counts = apportionEstCounts(orderedShares, total);
  const tops: MetaLadderTop[] = ordered.map((r, i) => ({ ...r, estCount: counts[i] ?? 0 }));
  return { url, name, total, tops };
}

/** Полный raw-пейлоад → лиги (порядок = порядок feed). */
export function normalizeBuildIndexState(raw: unknown): MetaLeague[] {
  const byUrl = indexByUrl(raw as RawBuildIndex);
  const out: MetaLeague[] = [];
  for (const l of byUrl.values()) {
    const norm = normalizeMetaLeague(l);
    if (norm) out.push(norm);
  }
  return out;
}

// ─── Сеть (кэш в памяти) ───────────────────────────────────────────────────

let indexCache: { at: number; leagues: MetaLeague[] } | null = null;

/** Сброс кэша meta-ladder (юнит-тесты). */
export function resetMetaLadderCache(): void {
  indexCache = null;
}

/**
 * Живой meta-ladder poe.ninja: все лиги и их ascendancy-топы.
 * Сеть — только первый вызов в TTL-окно (15 мин), далее кэш.
 */
export async function fetchMetaLadder(): Promise<MetaLeague[]> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.leagues;
  const raw = await httpJson<RawBuildIndex>(BUILD_INDEX_URL);
  const leagues = normalizeBuildIndexState(raw);
  indexCache = { at: Date.now(), leagues };
  return leagues;
}

/**
 * Meta-ladder одной лиги: матчинг по slug (url), display-имени или подстроке —
 * без учёта регистра/пробелов. null — лига не найдена в feed.
 */
export async function fetchMetaLadderLeague(league?: string): Promise<MetaLeague | null> {
  const leagues = await fetchMetaLadder();
  if (!league) return leagues[0] ?? null; // первая = текущая challenge-лига
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const exact = leagues.find(
    (l) => norm(l.url) === norm(league) || norm(l.name) === norm(league),
  );
  if (exact) return exact;
  return leagues.find((l) => norm(l.name).includes(norm(league))) ?? null;
}
