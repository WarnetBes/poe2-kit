/**
 * Дисковый кэш HTTP-ответов (COVERAGE приоритет 11, по мотивам hivemind
 * data/update_manager.py и poe2-build-mcp check_data_version).
 *
 * Проблема: лиги poe2scout и RePoE-датасеты тянутся «живьём» при каждом
 * старте; после патча/сбойного API это ломает инструменты. Решение:
 *   - кэш на диск (кэш-каталог: env POE2_KIT_CACHE_DIR, иначе
 *     <.tmp>/poe2-kit-cache);
 *   - TTL на каждый источник (лиги 6ч, RePoE 7 дней, словари poe.ninja —
 *     бессрочно: помечены хэшем версии);
 *   - stale-if-error: если протухший источник недоступен — отдаём старый
 *     снимок с пометкой stale (после патча или офлайна данные всё равно
 *     осмысленнее, чем ничего).
 *
 * Данные хранит только http-слой core; версионирование ответов MCP см.
 * httpCacheInfo() и MCP-инструмент poe2_data_freshness.
 */

import { httpBytes, httpJson, type HttpOptions } from './http.js';
import { HAS_DISK, cryptoMod, fsMod, osMod, pathMod } from './nodeenv.js';

export interface CacheEnvelope {
  url: string;
  fetchedAt: number;
  /** base64 — для бинарных protobuf-словарей. */
  dataB64?: string;
  data?: unknown;
}

const TTL_FOREVER = Number.POSITIVE_INFINITY;

/** TTL по умолчанию для «патчевых» источников: лиги/датасеты между патчами почти не меняются. */
export const DEFAULT_TTLS = {
  /** Лиги poe2scout: меняются при старте лиги/ивента — 6 часов. */
  leagueList: 6 * 60 * 60 * 1000,
  /** RePoE base_items/mods: меняются только с патчем — 7 дней. */
  repoe: 7 * 24 * 60 * 60 * 1000,
  /** Словари poe.ninja: версионированы своим sha1 в URL — можно навсегда. */
  ninjaDictionary: TTL_FOREVER,
  /** Список снапшотов poe.ninja: обновляется с их сайтом — 1 час. */
  ninjaSnapshots: 60 * 60 * 1000,
} as const;

function cacheDir(): string {
  if (!HAS_DISK) return '';
  const fs = fsMod!;
  const dir = process.env['POE2_KIT_CACHE_DIR'] ?? pathMod!.join(osMod!.tmpdir(), 'poe2-kit-cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cachePath(url: string): string {
  const hash = cryptoMod!.createHash('sha1').update(url).digest('hex');
  return pathMod!.join(cacheDir(), hash + '.json');
}

/**
 * Ключ для кэша POST-запросов. В Node — sha1; в браузере cryptoMod === null,
 * поэтому fallback — cyrb53 (pure JS). Ключ живёт только в памяти одного вызова:
 * при HAS_DISK=false диск всё равно не используется, коллизии не критичны.
 */
function postKeyHash(s: string): string {
  if (cryptoMod) return cryptoMod.createHash('sha1').update(s).digest('hex');
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export interface CachedResult<T> {
  data: T;
  /** Время получения из сети (ms epoch). */
  fetchedAt: number;
  /** Ответ протух, но сеть недоступна — отдан старый снимок. */
  stale: boolean;
}

function loadEnvelope(url: string): CacheEnvelope | null {
  if (!HAS_DISK) return null;
  const fs = fsMod!;
  const p = cachePath(url);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const env = JSON.parse(raw) as CacheEnvelope;
    if (env.url !== url) return null;
    return env;
  } catch {
    return null;
  }
}

/**
 * GET JSON через дисковый кэш. При живом экспире — перезагружает; при неудаче
 * — отдаёт протухший снимок (stale). TTL по умолчанию — DEFAULT_TTLS.repoe.
 */
export async function cachedJson<T = unknown>(
  url: string,
  opts: HttpOptions & { ttlMs?: number } = {},
): Promise<CachedResult<T>> {
  const ttl = opts.ttlMs ?? DEFAULT_TTLS.repoe;
  const cached = loadEnvelope(url);
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return { data: cached.data as T, fetchedAt: cached.fetchedAt, stale: false };
  }
  try {
    const data = await httpJson<T>(url, opts);
    if (HAS_DISK) fsMod!.writeFileSync(cachePath(url), JSON.stringify({ url, fetchedAt: Date.now(), data } satisfies CacheEnvelope));
    return { data, fetchedAt: Date.now(), stale: false };
  } catch (error) {
    if (cached) return { data: cached.data as T, fetchedAt: cached.fetchedAt, stale: true };
    throw error;
  }
}

/**
 * POST JSON через дисковый кэш (ключ учитывает тело запроса — для trade2 search,
 * где один и тот же URL несёт разные запросы). TTL по умолчанию — DEFAULT_TTLS.repoe.
 */
export async function cachedPostJson<T = unknown>(
  url: string,
  body: unknown,
  opts: HttpOptions & { ttlMs?: number; skipCache?: (data: T) => boolean } = {},
): Promise<CachedResult<T>> {
  const ttl = opts.ttlMs ?? DEFAULT_TTLS.repoe;
  const key = url + '#post-' + postKeyHash(JSON.stringify(body)).slice(0, 20);
  const cached = loadEnvelope(key);
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return { data: cached.data as T, fetchedAt: cached.fetchedAt, stale: false };
  }
  try {
    const data = await httpJson<T>(url, { ...opts, method: 'POST', body });
    // пустые результаты не кэшируем (skipCache): прайс-чек билда добирает
    // пустые слоты повторами, negative-кэш ломал эту механику
    if (!(opts.skipCache && opts.skipCache(data)) && HAS_DISK) {
      fsMod!.writeFileSync(
        cachePath(key),
        JSON.stringify({ url: key, fetchedAt: Date.now(), data } satisfies CacheEnvelope),
      );
    }
    return { data, fetchedAt: Date.now(), stale: false };
  } catch (error) {
    if (cached) return { data: cached.data as T, fetchedAt: cached.fetchedAt, stale: true };
    throw error;
  }
}

/**
 * GET бинарных данных (protobuf-словари poe.ninja) через дисковый кэш.
 * Словари версионированы хэшем в URL — по умолчанию TTL бесконечный.
 */
export async function cachedBytes(
  url: string,
  opts: HttpOptions & { ttlMs?: number } = {},
): Promise<CachedResult<Uint8Array>> {
  const ttl = opts.ttlMs ?? DEFAULT_TTLS.ninjaDictionary;
  const cached = loadEnvelope(url);
  if (cached?.dataB64 && (TTL_FOREVER === ttl || Date.now() - cached.fetchedAt < ttl)) {
    return { data: Buffer.from(cached.dataB64, 'base64'), fetchedAt: cached.fetchedAt, stale: false };
  }
  try {
    const data = await httpBytes(url, opts);
    if (HAS_DISK) {
      fsMod!.writeFileSync(
        cachePath(url),
        JSON.stringify({
          url,
          fetchedAt: Date.now(),
          dataB64: Buffer.from(data).toString('base64'),
        } satisfies CacheEnvelope),
      );
    }
    return { data, fetchedAt: Date.now(), stale: false };
  } catch (error) {
    if (cached?.dataB64) {
      return { data: Buffer.from(cached.dataB64, 'base64'), fetchedAt: cached.fetchedAt, stale: true };
    }
    throw error;
  }
}

export interface CacheEntryInfo {
  file: string;
  url: string;
  fetchedAt: number;
  ageHours: number;
}

/** Сводка кэша: чем и когда питаемся (для версионирования ответов MCP). */
export function httpCacheInfo(): CacheEntryInfo[] {
  if (!HAS_DISK) return [];
  const fs = fsMod!;
  const dir = cacheDir();
  const out: CacheEntryInfo[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const env = JSON.parse(fs.readFileSync(pathMod!.join(dir, f), 'utf8')) as CacheEnvelope;
      out.push({
        file: f,
        url: env.url,
        fetchedAt: env.fetchedAt,
        ageHours: Math.max(0, (Date.now() - env.fetchedAt) / 3_600_000),
      });
    } catch {
      // редкая битая запись — не ломаем сводку
    }
  }
  return out.sort((a, b) => a.fetchedAt - b.fetchedAt);
}

/** Полностью очистить дисковый кэш (после патча, вручную). */
export function clearHttpCache(): number {
  if (!HAS_DISK) return 0;
  const fs = fsMod!;
  const dir = cacheDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  let n = 0;
  for (const f of files) {
    try {
      fs.rmSync(pathMod!.join(dir, f));
      n++;
    } catch {
      // занят/нет прав — пропускаем
    }
  }
  return n;
}
