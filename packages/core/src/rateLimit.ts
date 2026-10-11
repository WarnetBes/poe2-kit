/**
 * Порт poe-ninja-build-cost (MIT © 2026 Yared) src/lib/rate-limit.js —
 * адаптивный rate-limit на заголовках GGG X-Rate-Limit-*.
 * Ported from poe-ninja-build-cost (MIT) src/lib/rate-limit.js
 * (по образцу порта priceAnalysis.ts из poe2scout-mcp-main).
 *
 * GGG отвечает на каждый trade-запрос своей политикой и фактической тратой:
 *
 *   x-rate-limit-rules:    Ip
 *   x-rate-limit-ip:       5:10:60,15:60:300,30:300:1800,600:21600:3600
 *   x-rate-limit-ip-state: 1:10:0,2:60:0,12:300:0,163:21600:0
 *
 * Каждый тройник — `hits:period:penalty`. Penalty игнорируем сознательно:
 * он важен только при пробитии, а весь смысл этого файла — не пробивать
 * (так же делает Awkened PoE Trade). Живой замер 11.10.2026 (curl, №280-сессия):
 *   search: 5:10:60,15:60:300,30:300:1800,600:21600:3600 (policy trade-search-request-limit)
 *   fetch:  12:4:10,16:12:300,50:300:300,1000:21600:1800 (policy trade-fetch-request-limit)
 */

/** Пока сервер не сказал своего мнения — предполагаем худшее. */
const PESSIMISTIC: Array<{ max: number; window: number }> = [{ max: 1, window: 5 }];

/**
 * Паддинг к каждому окну, секунды. Наши часы и GGG не тикают синхронно,
 * запрос идёт по сети: без паддинга слот может выглядеть свободным локально
 * и занятым на сервере.
 */
export const DESYNC_PAD = 1;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Доля каждого корыта, которую мы НЕ занимаем под свои запросы. */
const USER_RESERVE = 1 / 6;

/**
 * Три профиля на выбор владельца. `balanced` — настроенная 1/6, дефолт;
 * ничего не меняет для того, кто в настройки не полез.
 */
export const BUDGET_SHARES = [
  { id: 'fast', label: 'Fastest pass', reserve: 1 / 12 },
  { id: 'balanced', label: 'Balanced', reserve: USER_RESERVE },
  { id: 'gentle', label: 'Leave room for my own searches', reserve: 1 / 3 },
] as const;

export type BudgetShareId = (typeof BUDGET_SHARES)[number]['id'];
export const DEFAULT_BUDGET_SHARE: BudgetShareId = 'balanced';

let userReserve = USER_RESERVE;

/** Выбрать профиль бюджета (fast/balanced/gentle); мусорный id = дефолт. */
export function setBudgetShare(id: string): void {
  const share =
    BUDGET_SHARES.find((s) => s.id === id) ??
    BUDGET_SHARES.find((s) => s.id === DEFAULT_BUDGET_SHARE)!;
  userReserve = share.reserve;
}

/** Текущая доля резерва (0..1) — для отладки/отчётов. */
export function getUserReserve(): number {
  return userReserve;
}

/** Одно окно «hits за period». */
export class Bucket {
  readonly max: number;
  readonly windowSeconds: number;
  readonly windowMs: number;
  /** Правило GGG (ip/account/client): дважды опубликованные одинаковые окна
   *  из разных правил — НЕ один и тот же бакет, иначе двойной заряд. */
  readonly rule: string;
  hits: number[] = [];

  constructor(max: number, windowSeconds: number, rule = 'ip') {
    this.max = max;
    this.windowSeconds = windowSeconds;
    this.windowMs = (windowSeconds + DESYNC_PAD) * 1000;
    this.rule = rule;
  }

  /**
   * Никогда не занимаем бакет целиком: хотя бы один слот остаётся человеку
   * даже на мелких окнах, где доля округлилась бы в ноль. Читаем свежо, а не
   * запоминаем при создании: бакеты переживают смену настроек (перестраиваются
   * только при смене политики GGG).
   */
  get usable(): number {
    return Math.max(1, this.max - Math.max(1, Math.ceil(this.max * userReserve)));
  }

  matches(spec: { max: number; window: number; rule: string }): boolean {
    return this.max === spec.max && this.windowSeconds === spec.window && this.rule === spec.rule;
  }

  prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.hits.length && this.hits[0]! <= cutoff) this.hits.shift();
  }

  /** Когда освободится слот; `now` — если место есть уже сейчас. */
  freeAt(now: number): number {
    this.prune(now);
    return this.hits.length < this.usable ? now : this.hits[0]! + this.windowMs;
  }

  consume(now: number): void {
    this.hits.push(now);
  }

  /**
   * Выравнивание локального счётчика с серверным. Если GGG насчитал больше,
   * чем мы (кто-то ещё на этом IP тратил квоту — например, открытая вкладка
   * торговой площадки), лишние хиты дописываем как свои — не маршируем в 429.
   */
  syncTo(serverCount: number, now: number): void {
    this.prune(now);
    for (let i = this.hits.length; i < serverCount; i++) this.hits.push(now);
  }
}

export interface ParsedPolicy {
  specs: Array<{ max: number; window: number; rule: string }>;
  used: number[];
  rules: Array<{ rule: string; limit: string; state: string }>;
  policy: string | null;
}

/**
 * Разбор пары заголовков в спеки `{max, window, rule}` + серверные счётчики.
 * Несколько правил действуют одновременно и с разными числами (ip/account/
 * client) — «единого» rate limit не существует, сырые строки храним для отчёта.
 */
export function parsePolicy(headers: Headers): ParsedPolicy | null {
  const rawRules = headers.get('x-rate-limit-rules');
  if (!rawRules) return null;

  const specs: ParsedPolicy['specs'] = [];
  const used: number[] = [];
  const seen: ParsedPolicy['rules'] = [];
  for (const rule of rawRules.split(',')) {
    const name = rule.trim().toLowerCase();
    const limit = headers.get(`x-rate-limit-${name}`);
    if (!limit) continue;
    const state = headers.get(`x-rate-limit-${name}-state`) || '';
    const stateParts = state.split(',');
    seen.push({ rule: name, limit, state });

    limit.split(',').forEach((triplet, i) => {
      const [max, window] = triplet.split(':').map(Number) as [number, number];
      if (!Number.isFinite(max) || !Number.isFinite(window)) return;
      specs.push({ max, window, rule: name });
      used.push(Number(stateParts[i]?.split(':')[0]) || 0);
    });
  }
  return specs.length
    ? { specs, used, rules: seen, policy: headers.get('x-rate-limit-policy') || null }
    : null;
}

export interface BucketState {
  rule: string;
  max: number;
  usable: number;
  windowSeconds: number;
  spent: number;
}

/**
 * Один лимитер = одна политика GGG (`trade-search-request-limit`,
 * `trade-fetch-request-limit`): у fetch квота щедрее, поэтому эндпоинты
 * получают по собственному лимитеру.
 */
export class RateLimiter {
  readonly name: string;
  private buckets: Bucket[] = PESSIMISTIC.map((s) => new Bucket(s.max, s.window));
  private blockedUntil = 0;
  /** Сколько мс вызывающие ждали внутри take() — «наши задержки vs GGG-медленность». */
  waitedMs = 0;
  /** Последняя политика GGG дословно — какие правила действовали, решать не нам. */
  policy: string | null = null;
  rules: ParsedPolicy['rules'] = [];
  /** Сериализация: без неё два Concurrent take() увидят один свободный слот дважды. */
  private chain: Promise<void> = Promise.resolve();

  constructor(name: string) {
    this.name = name;
  }

  take(): Promise<void> {
    const result = this.chain.then(() => this.doTake());
    this.chain = result.catch(() => undefined);
    return result;
  }

  private async doTake(): Promise<void> {
    const enteredAt = Date.now();
    for (;;) {
      const now = Date.now();
      const readyAt = Math.max(this.blockedUntil, ...this.buckets.map((b) => b.freeAt(now)));
      if (readyAt <= now) {
        for (const bucket of this.buckets) bucket.consume(now);
        this.waitedMs += now - enteredAt;
        return;
      }
      await sleep(Math.min(readyAt - now, 30_000));
    }
  }

  /** Что лимитер думает сейчас — для отладочного отчёта. */
  state(): BucketState[] {
    const now = Date.now();
    return this.buckets.map((b) => {
      b.prune(now);
      return {
        rule: b.rule,
        max: b.max,
        usable: b.usable,
        windowSeconds: b.windowSeconds,
        spent: b.hits.length,
      };
    });
  }

  /** Перестройка бакетов из заголовков ответа. */
  sync(headers: Headers): void {
    const parsed = parsePolicy(headers);
    if (!parsed) return;
    const now = Date.now();
    this.policy = parsed.policy;
    this.rules = parsed.rules;
    this.buckets = parsed.specs.map((spec, i) => {
      const bucket = this.buckets.find((b) => b.matches(spec)) || new Bucket(spec.max, spec.window, spec.rule);
      bucket.syncTo(parsed.used[i] ?? 0, now);
      return bucket;
    });
  }

  /** 429: отойти на столько, сколько просит сервер (Retry-After — сек или null). */
  penalise(retryAfterSeconds: number | string | null): void {
    const seconds = Number(retryAfterSeconds) || 60;
    this.blockedUntil = Date.now() + seconds * 1000;
  }

  /** Грубая оценка секунд на `count` запросов — для UI («поиск займёт ~40 с»). */
  estimate(count: number): number {
    const now = Date.now();
    const sim = this.buckets.map((b) => {
      b.prune(now);
      return { usable: b.usable, windowMs: b.windowMs, hits: [...b.hits] };
    });

    let clock = now;
    for (let i = 0; i < count; i++) {
      let readyAt = clock;
      for (const b of sim) {
        const live = b.hits.filter((h) => h > clock - b.windowMs);
        if (live.length >= b.usable) readyAt = Math.max(readyAt, live[0]! + b.windowMs);
      }
      clock = readyAt;
      for (const b of sim) b.hits.push(clock);
    }
    return Math.round((clock - now) / 1000);
  }
}

export interface TradeRateState {
  /** Лимитер POST /api/trade2/search (policy trade-search-request-limit). */
  search: RateLimiter;
  /** Лимитер GET /api/trade2/fetch (policy trade-fetch-request-limit). */
  fetch: RateLimiter;
  /** Профиль бюджета: fast/balanced/gentle (доля квоты IP, оставляемая человеку). */
  setBudget: (id: string) => void;
}

/**
 * Пара лимитеров trade2 (search/fetch)
 * — контракт мастер-плана P1 (W1).
 */
export function createTradeRateState(): TradeRateState {
  return {
    search: new RateLimiter('trade-search-request-limit'),
    fetch: new RateLimiter('trade-fetch-request-limit'),
    setBudget: (id: string) => setBudgetShare(id),
  };
}
