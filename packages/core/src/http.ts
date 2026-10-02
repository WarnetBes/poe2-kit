/**
 * Лёгкий HTTP-клиент с учётом рейт-лимитов GGG/poe.ninja/poe2scout.
 * В браузере используется fetch, в Node — глобальный fetch (>=18).
 *
 * Рейт-лимит построен по принципу из лучших PoE2-MCP (sergeyklay/poe2-mcp-server):
 * окно "N запросов за windowMs", отдельное на каждый хост. Это правильнее, чем
 * фиксированный интервал, т.к. у разных API разные лимиты.
 *
 * Дополнительно реализована ОЧЕРЕДЬ запросов (приём из xiletrade): при пробитии
 * лимита запрос НЕ падает, а встаёт в очередь и выполняется, когда окно освободится.
 * Это важно для массовых прайс-чеков — не сыпем ошибки, а мягко растасовываем во времени.
 */

import { classifyError, type ResultError } from './result.js';

// ── Лента сетевых ошибок (S9, аудит №175) ───────────────────────────────────
// httpJson/httpText/httpBytes глотают ничего, но ВЫШЕ по стеку ошибки часто
// проглатываются (cache stale-if-error, trade searchTrade → return []). Эта
// лента — единственный честный сигнал «сеть падала» для ...Result-обёрток:
// каждая ФИНАЛЬНО упавшая сетевая ошибка (после ретраев) попадает сюда.
// Transient-5xx, которые вылечил ретрай №145, в ленту НЕ пишутся.

export interface HttpErrorRecord extends ResultError {
  /** Хост, на котором упал запрос. */
  host: string;
  /** Epoch-ms момента ошибки. */
  at: number;
}

const HTTP_ERROR_TAPE_MAX = 64;
const httpErrorTape: HttpErrorRecord[] = [];

/** Записать финальную сетевую ошибку хоста в ленту (защищено: лог не бросает). */
function recordHttpError(host: string, e: unknown): void {
  try {
    const c = classifyError(e);
    httpErrorTape.push({ host, at: Date.now(), kind: c.kind, message: c.message, retryable: c.retryable });
    while (httpErrorTape.length > HTTP_ERROR_TAPE_MAX) httpErrorTape.shift();
  } catch {
    /* никогда не ломаем запрос из-за телеметрии */
  }
}

/**
 * Ошибки хостов с момента `since` (epoch-ms). Необязательный фильтр —
 * подстрока хоста (как в HOST_LIMITS: 'poe2scout.com' ловит 'api.poe2scout.com').
 * Служебный read-only API для ...Result-обёрток и диагностики; экспортирован
 * наружу (overlay/web) для самопроверки сети.
 */
export function httpErrorsSince(since: number, hostSub?: string): HttpErrorRecord[] {
  return httpErrorTape.filter(
    (r) => r.at >= since && (!hostSub || r.host.includes(hostSub)),
  );
}

/** Очистить ленту (только для тестов/самодиагностики). */
export function clearHttpErrorTape(): void {
  httpErrorTape.length = 0;
}

/** Полный сброс http-состояния: лимитеры, очереди хостов, лента ошибок.
 *  Для юнит-тестов (изоляция прогонов) и самодиагностики; в рантайме приложения
 *  НЕ вызывать — очередь хостов защищает живые запросы от пиковой нагрузки. */
export function resetHttpState(): void {
  limiters.clear();
  queues.clear();
  clearHttpErrorTape();
}

/** Reйт-лимитер: не более `maxRequests` запросов за `windowMs`.
 * Если лимит исчерпан — ждём до освобождения окна.
 */
export class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    private maxRequests: number,
    private windowMs: number,
  ) {}

  async wait(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    if (this.timestamps.length >= this.maxRequests) {
      const oldest = this.timestamps[0]!;
      const delay = this.windowMs - (now - oldest) + 50;
      await new Promise((r) => setTimeout(r, delay));
    }
    this.timestamps.push(Date.now());
  }
}

/**
 * Очередь запросов на хост (приём из xiletrade): если лимитер wаit'ит, а подоспевшие
 * вызовы — все одновременно, они гонят много параллельных fetch. Очередь сериализует
 * запросы на хост, чтобы не перегружать API пиками.
 */
class HostQueue {
  private tail: Promise<void> = Promise.resolve();

  /** Занимает место в очереди; выполнение fn начнётся не раньше предыдущих на этом хосте. */
  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    // Хвост ждёт завершения предыдущего, но не глотает ошибки пользователя.
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

// Очереди на каждый хост (статические, живут всё время работы ядра).
const queues = new Map<string, HostQueue>();

function queueFor(host: string): HostQueue {
  let q = queues.get(host);
  if (!q) {
    q = new HostQueue();
    queues.set(host, q);
  }
  return q;
}

export interface HttpOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  /** Таймаут, мс */
  timeoutMs?: number;
}

// Известные лимиты публичных API (окно "N за W мс").
const HOST_LIMITS: Record<string, [number, number]> = {
  'poe.ninja': [10, 5 * 60 * 1000], // 10 запросов / 5 минут
  'poe2scout.com': [10, 60 * 1000], // консервативно, документированного лимита нет
  'repoe-fork.github.io': [5, 60 * 1000],
  // trade2 (pathofexile.com): при пробитии — 429 и временный бан по IP,
  // поэтому уходим в консервативные 8 запросов/мин (search+fetch суммарно).
  'pathofexile.com': [8, 60 * 1000],
};

const limiters = new Map<string, RateLimiter>();

function limiterFor(host: string): RateLimiter {
  let limiter = limiters.get(host);
  if (!limiter) {
    const key = Object.keys(HOST_LIMITS).find((k) => host.includes(k));
    const [max, window] = key ? HOST_LIMITS[key] : [30, 60 * 1000];
    limiter = new RateLimiter(max, window);
    limiters.set(host, limiter);
  }
  return limiter;
}

/**
 * Опциональный CORS-прокси.
 *
 * Браузер блокирует прямые запросы к poe.ninja/poe2scout/trade из-за CORS.
 * Для веб-приложения настраиваем реверс-прокси (Vite dev/preview или Node-сервер),
 * который отвечает на те же пути. В этом случае URL переписывается на такой же
 * относительный путь (этот же хост), избегая CORS.
 *
 * Использование: core.http.setProxyBaseMap({ 'poe.ninja': '/proxy/poeninja', 'poe2scout.com': '/proxy/scout', ... })
 * В Node (MCP, overlay) прокси не нужен — мапа не задаётся, запросы идут напрямую.
 */
let proxyBaseMap: Record<string, string> | null = null;

/** Настроить карту "хост → префикс пути" для CORS-прокси. null отключает проксирование. */
export function setProxyBaseMap(map: Record<string, string> | null): void {
  proxyBaseMap = map;
}

export function getProxyBaseMap(): Record<string, string> | null {
  return proxyBaseMap;
}

/** Переписать абсолютный URL на такой же относительный путь через прокси. */
function toProxyUrl(url: string): string {
  if (!proxyBaseMap) return url;
  let u = url;
  try {
    u = new URL(url).toString();
  } catch {
    return url;
  }
  const host = new URL(u).host;
  for (const [key, prefix] of Object.entries(proxyBaseMap)) {
    if (host.includes(key)) {
      return prefix + new URL(u).pathname + new URL(u).search;
    }
  }
  return url;
}

// ===== Динамический rate-limit GGG (trade2): уважение заголовков X-Rate-Limit* =====
//
// Механика заголовков GGG (polished по образцу ExileOracle/api-client.ts, но
// исправлены его дефекты: учёт ВСЕХ правил ip+account, лимит ретраев, бан-окно):
//
//   X-Rate-Limit-Ip:        5:10,10:60,15:300      — правила "hits:period"
//   X-Rate-Limit-Ip-State:  2:10:0,4:60:0,3:300:0  — "current:period:banCounter"
//   X-Rate-Limit-Account / -Account-State          — то же для квоты аккаунта
//   X-Rate-Limit-Rules:     Ip                     — при 429: какие правила пробиты
//   Retry-After:            60                     — при 429: сколько секунд ждать
//
// Правила перечисляются через запятую; правило из limit и state спаривается
// по полю period (порядок в живых ответах совпадает, но полагаемся на period —
// надёжнее). Третье поле state — счётчик текущего бана (секунды действующего
// бана правила); при 429 берём cap бана из Retry-After, иначе из счётчика.
//
// Слой работает ПОВЕРХ статического лимитера HOST_LIMITS: статики — защита от
// пиков на неизвестных лимитах, динамика — реальная квота trade2 без слепых
// 60-секундных пауз там, где хватает 2 секунд.

interface GggRuleState {
  /** Остаток квоты правила (hits), может быть отрицательным при пробитии. */
  remaining: number;
  /** Epoch-ms, когда окно правила сбрасывается. */
  resetAt: number;
  /** Epoch-ms, до которого правило заблокировано баном (0 — бана нет).
   * По семантике GGG бан ЗАМЕНЯЕТ ожидание окна: ждать надо до blockedUntil,
   * а не до resetAt (иначе исчерпанное правило глухо висит всё окно). */
  blockedUntil: number;
}

// key: `${host}#${ruleName}` → состояния правил (по индексу = порядку в ответе).
const gggStates = new Map<string, GggRuleState[]>();

const GGG_RULE_NAMES = ['Ip', 'Account'] as const;

/** "5:10,10:60" → [[5,10],[10,60]] (fail-safe: мусорные строки отбрасываются). */
function parseGggFields(header: string): number[][] {
  return header
    .split(',')
    .map((part) => part.split(':').map((n) => Number(n)))
    .filter((nums) => nums.every((n) => Number.isFinite(n)) && nums.length >= 2);
}

/** Обновляет состояния правил хоста из заголовков ответа. */
function updateGggStates(host: string, headers: Headers): void {
  for (const rule of GGG_RULE_NAMES) {
    const limit = headers.get(`x-rate-limit-${rule.toLowerCase()}`);
    const state = headers.get(`x-rate-limit-${rule.toLowerCase()}-state`);
    // -State может прийти без -Limit (уже пробитое правило) — состояние всё равно ценно.
    if (!limit && !state) continue;
    const limits = limit ? parseGggFields(limit) : [];
    const states = state ? parseGggFields(state) : [];
    const now = Date.now();
    const key = `${host}#${rule}`;
    const merged: GggRuleState[] = [];
    const periods = new Set<number>([
      ...limits.map((l) => l[1]!),
      ...states.map((s) => s[1]!),
    ]);
    for (const period of periods) {
      const lr = limits.find((l) => l[1] === period);
      const sr = states.find((s) => s[1] === period);
      const maxHits = lr?.[0];
      const current = sr?.[0];
      const banCounter = sr?.[2] ?? 0;
      // Если квота неизвестна — считаем исчерпанной при current>0 (better safe).
      const remaining =
        maxHits != null && current != null ? maxHits - current : current == null ? Infinity : 0;
      merged.push({
        remaining,
        resetAt: now + period * 1000,
        blockedUntil: banCounter > 0 ? now + banCounter * 1000 : 0,
      });
    }
    if (merged.length) gggStates.set(key, merged);
    else gggStates.delete(key);
  }
}

/** Ждёт (async), пока у хоста есть исчерпанное/забаненное правило. */
async function waitGggQuota(host: string): Promise<void> {
  const waitMs = gggWaitMs(host);
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
}

/** Сколько мс ждать до освобождения квоты хоста (по заголовкам GGG). */
function gggWaitMs(host: string): number {
  let max = 0;
  for (const [key, rules] of gggStates) {
    if (!key.startsWith(`${host}#`)) continue;
    for (const r of rules) {
      if (r.remaining > 0) continue;
      // Действующий бан заменяет ожидание окна: до blockedUntil, иначе до resetAt.
      const target = r.blockedUntil > Date.now() ? r.blockedUntil : r.resetAt;
      const wait = target - Date.now();
      max = Math.max(max, wait);
    }
  }
  return max;
}

/** fetch с динамическим GGG-бекофом: ждёт квоту до запроса, на 429 — ждёт и ретраит (≤MAX). */
const GGG_MAX_429_RETRIES = 2;

async function gggFetch(host: string, url: string, init: RequestInit): Promise<Response> {
    let attempt = 0;
  for (;;) {
    await waitGggQuota(host);
    const res = await fetch(url, init);
    updateGggStates(host, res.headers);
    if (res.status !== 429 || attempt >= GGG_MAX_429_RETRIES) return res;
    // 429: уважаем Retry-After (секунды), иначе — максимальный ban-счётчик правил, иначе 60с.
    const retryAfter = Number(res.headers.get('retry-after'));
    const rulesBan = gggWaitMs(host);
    let waitMs = Math.max(Number.isFinite(retryAfter) ? retryAfter * 1000 : 0, rulesBan);
    if (!waitMs) waitMs = 60_000;
    // Блокируем пробитые правила на вычисленное окно (ban заменяет reset):
    // следующая итерация дождётся истечения и повторит запрос.
    const blockedUntil = Date.now() + waitMs;
    for (const [key, rules] of gggStates) {
      if (!key.startsWith(`${host}#`)) continue;
      for (const r of rules) {
        if (r.remaining <= 0) r.blockedUntil = Math.max(r.blockedUntil, blockedUntil);
      }
    }
    attempt++;
  }
}

/** №145: transient 5xx от апстрима (лог-факт: trade2 «HTTP 500» на Ruby Ring)?
 *  Один повторный заход через ту же очередь/лимитер после паузы.
 *  Финальные 4xx и таймауты НЕ ретраятся — там повтор бессмыслен. */
function isTransient5xx(err: unknown): boolean {
  return err instanceof Error && /\bHTTP 5\d\d\b/.test(err.message);
}

export async function httpJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const host = new URL(url).host;
  const finalUrl = toProxyUrl(url);
  // Весь запрос к хостим через очередь + рейт-лимитер: лимит ждёт окно,
  // очередь сериализует пики массовых запросов (прайс-чек пачки предметов).
  const once = (): Promise<T> =>
    queueFor(host).enqueue(async () => {
      await limiterFor(host).wait();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await gggFetch(host, finalUrl, {
        method: opts.method ?? 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          // GGG требует описательный User-Agent с контактом (политика API).
          // Node fetch без UA получает 403 от Cloudflare.
          'User-Agent': 'poe2-kit/1.0 (open-source toolkit; contact: https://git.sourcecraft.dev/volkovpartilaholin/poe2-kit)',
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} from ${finalUrl}: ${body.slice(0, 200)}`);
      }
      const text = await res.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    } finally {
      clearTimeout(timer);
    }
    });

  // №145: один ретрай transient-5xx с паузой (повтор через ту же очередь/лимитер).
  // Вылеченный ретраем в ленту НЕ пишем — сеть в итоге ответила.
  try {
    return await once();
  } catch (err) {
    if (!isTransient5xx(err)) {
      recordHttpError(host, err);
      throw err;
    }
    await new Promise((r) => setTimeout(r, 1500));
    try {
      return await once();
    } catch (err2) {
      recordHttpError(host, err2);
      throw err2;
    }
  }
}

/**
 * Текстовый (HTML) GET с той же очередью/лимитами, что httpJson.
 * Для скрапинга страниц (poe2db.tw, pathofexile.com и т.п.).
 */
export async function httpText(url: string, opts: HttpOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const host = new URL(url).host;
  const finalUrl = toProxyUrl(url);
  return queueFor(host).enqueue(async () => {
    await limiterFor(host).wait();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await gggFetch(host, finalUrl, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'text/html,application/xhtml+xml,*/*',
          'User-Agent': 'poe2-kit/1.0 (open-source toolkit; contact: https://git.sourcecraft.dev/volkovpartilaholin/poe2-kit)',
          ...opts.headers,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} from ${finalUrl}: ${body.slice(0, 200)}`);
      }
      return res.text();
    } catch (e) {
      recordHttpError(host, e);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  });
}

/**
 * Бинарный GET (ArrayBuffer) с той же очередью/лимитами.
 * Для protobuf-ответов (poe.ninja builds/ladder).
 */
export async function httpBytes(url: string, opts: HttpOptions = {}): Promise<Uint8Array> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const host = new URL(url).host;
  const finalUrl = toProxyUrl(url);
  return queueFor(host).enqueue(async () => {
    await limiterFor(host).wait();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await gggFetch(host, finalUrl, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'application/octet-stream,*/*',
          'User-Agent': 'poe2-kit/1.0 (open-source toolkit; contact: https://git.sourcecraft.dev/volkovpartilaholin/poe2-kit)',
          ...opts.headers,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} from ${finalUrl}: ${body.slice(0, 200)}`);
      }
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      recordHttpError(host, e);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  });
}