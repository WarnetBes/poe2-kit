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

export async function httpJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const host = new URL(url).host;
  const finalUrl = toProxyUrl(url);
  // Весь запрос к хостим через очередь + рейт-лимитер: лимит ждёт окно,
  // очередь сериализует пики массовых запросов (прайс-чек пачки предметов).
  return queueFor(host).enqueue(async () => {
    await limiterFor(host).wait();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(finalUrl, {
        method: opts.method ?? 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          // GGG требует описательный User-Agent с контактом (политика API).
          // Node fetch без UA получает 403 от Cloudflare.
          'User-Agent': 'poe2-kit/0.1 (open-source toolkit; github.com/poe2-kit)',
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
      const res = await fetch(finalUrl, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'text/html,application/xhtml+xml,*/*',
          'User-Agent': 'poe2-kit/0.1 (open-source toolkit; github.com/poe2-kit)',
          ...opts.headers,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} from ${finalUrl}: ${body.slice(0, 200)}`);
      }
      return res.text();
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
      const res = await fetch(finalUrl, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'application/octet-stream,*/*',
          'User-Agent': 'poe2-kit/0.1 (open-source toolkit; github.com/poe2-kit)',
          ...opts.headers,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} from ${finalUrl}: ${body.slice(0, 200)}`);
      }
      return new Uint8Array(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  });
}