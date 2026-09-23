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

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Не экспортируем наружу httpJson/httpBytes — кэш применяется поверх. */
import { httpBytes, httpJson, type HttpOptions } from './http.js';

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
  const dir = process.env['POE2_KIT_CACHE_DIR'] ?? path.join(tmpdir(), 'poe2-kit-cache');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function cachePath(url: string): string {
  const hash = createHash('sha1').update(url).digest('hex');
  return path.join(cacheDir(), hash + '.json');
}

export interface CachedResult<T> {
  data: T;
  /** Время получения из сети (ms epoch). */
  fetchedAt: number;
  /** Ответ протух, но сеть недоступна — отдан старый снимок. */
  stale: boolean;
}

function loadEnvelope(url: string): CacheEnvelope | null {
  const p = cachePath(url);
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, 'utf8');
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
    writeFileSync(cachePath(url), JSON.stringify({ url, fetchedAt: Date.now(), data } satisfies CacheEnvelope));
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
    writeFileSync(
      cachePath(url),
      JSON.stringify({
        url,
        fetchedAt: Date.now(),
        dataB64: Buffer.from(data).toString('base64'),
      } satisfies CacheEnvelope),
    );
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
  const dir = cacheDir();
  const out: CacheEntryInfo[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const env = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as CacheEnvelope;
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
  const dir = cacheDir();
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  let n = 0;
  for (const f of files) {
    try {
      rmSync(path.join(dir, f));
      n++;
    } catch {
      // занят/нет прав — пропускаем
    }
  }
  return n;
}
