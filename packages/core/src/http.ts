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

const DEFAULT_UA = 'poe2-kit/0.1.0 (+poe2scout & poe.ninja & RePoE public APIs)';

/**
 * Рейт-лимитер: не более `maxRequests` запросов за `windowMs`.
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

export async function httpJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const host = new URL(url).host;
  // Весь запрос к хостим через очередь + рейт-лимитер: лимит ждёт окно,
  // очередь сериализует пики массовых запросов (прайс-чек пачки предметов).
  return queueFor(host).enqueue(async () => {
    await limiterFor(host).wait();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          'User-Agent': DEFAULT_UA,
          Accept: 'application/json',
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} from ${url}: ${body.slice(0, 200)}`);
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