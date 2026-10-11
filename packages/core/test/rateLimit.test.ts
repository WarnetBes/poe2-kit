import { describe, expect, it } from 'vitest';
import {
  BUDGET_SHARES,
  Bucket,
  DEFAULT_BUDGET_SHARE,
  RateLimiter,
  createTradeRateState,
  getUserReserve,
  parsePolicy,
  setBudgetShare,
} from '../src/rateLimit.js';

/** Заголовки живого замера 11.10.2026 (№280-сессия, curl + node-fetch). */
function liveSearchHeaders(): Headers {
  return new Headers({
    'x-rate-limit-policy': 'trade-search-request-limit',
    'x-rate-limit-rules': 'Ip',
    'x-rate-limit-ip': '5:10:60,15:60:300,30:300:1800,600:21600:3600',
    'x-rate-limit-ip-state': '1:10:0,1:60:0,1:300:0,1:21600:0',
  });
}

function liveFetchHeaders(): Headers {
  return new Headers({
    'x-rate-limit-policy': 'trade-fetch-request-limit',
    'x-rate-limit-rules': 'Ip',
    'x-rate-limit-ip': '12:4:10,16:12:300,50:300:300,1000:21600:1800',
    'x-rate-limit-ip-state': '1:4:0,1:12:0,1:300:0,1:21600:0',
  });
}

describe('parsePolicy', () => {
  it('разбирает живые search-заголовки в 4 окна Ip', () => {
    const parsed = parsePolicy(liveSearchHeaders())!;
    expect(parsed.policy).toBe('trade-search-request-limit');
    expect(parsed.specs).toHaveLength(4);
    expect(parsed.specs[0]).toEqual({ max: 5, window: 10, rule: 'ip' });
    expect(parsed.specs[3]).toEqual({ max: 600, window: 21600, rule: 'ip' });
    expect(parsed.used).toEqual([1, 1, 1, 1]);
  });

  it('разбирает живые fetch-заголовки (12:4:10 — самый щедрый первый бакет)', () => {
    const parsed = parsePolicy(liveFetchHeaders())!;
    expect(parsed.specs[0]).toEqual({ max: 12, window: 4, rule: 'ip' });
    expect(parsed.policy).toBe('trade-fetch-request-limit');
  });

  it('мусор/отсутствие правил → null', () => {
    expect(parsePolicy(new Headers())).toBeNull();
    expect(parsePolicy(new Headers({ 'x-rate-limit-rules': 'Nobody' }))).toBeNull();
  });
});

describe('Bucket', () => {
  it('usable: резерв держит ≥1 слот даже на мелких окнах; fast/balanced/gentle меняют долю', () => {
    const b5 = new Bucket(5, 10);
    // balanced (1/6): ceil(5/6)=1 → usable 4
    expect(b5.usable).toBe(4);
    setBudgetShare('gentle'); // 1/3: ceil(5/3)=2 → usable 3
    expect(b5.usable).toBe(3);
    setBudgetShare('fast'); // 1/12: ceil(5/12)=1 → usable 4
    expect(b5.usable).toBe(4);
    setBudgetShare(DEFAULT_BUDGET_SHARE); // обратно balanced
    // max=1: хотя бы один слот всегда остаётся человеку → usable не может быть 0
    expect(new Bucket(1, 5).usable).toBe(1);
  });

  it('окно: prune/freeAt/consume — слот освобождается по истечении windowSeconds+pad', () => {
    const b = new Bucket(3, 10); // окно (10+1)s = 11_000 мс; balanced usable = 3-1 = 2
    const t0 = 1_000_000;
    b.consume(t0 - 1000);
    b.consume(t0 - 500);
    b.prune(t0);
    expect(b.hits).toHaveLength(2); // оба внутри окна
    expect(b.freeAt(t0)).toBe(t0 - 1000 + 11_000); // full: ждать хвост первого хита
    // Через 10с первый хит протух (cutoff = t0+10_000-11_000): место освободилось.
    expect(b.freeAt(t0 + 10_000)).toBe(t0 + 10_000);
  });

  it('syncTo: сервер видел 12, мы — 2 → чужие хиты дописаны как наши', () => {
    const b = new Bucket(30, 300);
    const now = Date.now();
    b.consume(now);
    b.consume(now);
    b.syncTo(12, now);
    expect(b.hits.length).toBe(12);
  });
});

describe('RateLimiter (порт poe-ninja-build-cost)', () => {
  it('pessimistic-дефолт до первого sync: 1 запрос / 5 с', () => {
    const rl = new RateLimiter('test');
    expect(rl.policy).toBeNull();
    expect(rl.state()).toEqual([
      expect.objectContaining({ max: 1, windowSeconds: 5, rule: 'ip' }),
    ]);
  });

  it('sync пересобирает бакеты по правилу и серверному счётчику', () => {
    const rl = new RateLimiter('search');
    rl.sync(liveSearchHeaders());
    expect(rl.policy).toBe('trade-search-request-limit');
    const st = rl.state();
    expect(st).toHaveLength(4);
    // state 1:10 → syncTo(1) → spent 1
    expect(st[0]).toMatchObject({ max: 5, spent: 1 });
  });

  it('sync вместе с 429(Retry-After) + penalise блокируют take на запрошенное время', async () => {
    const rl = new RateLimiter('search');
    rl.penalise(0.2); // 200 мс «отойти» — как Retry-After: 0.2 (сек)
    const t0 = Date.now();
    await rl.take();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150); // ждали бан, а не 0
  });

  it('estimate: после syncusable-1 запросов без задержки, дальше — по окну', () => {
    const rl = new RateLimiter('search');
    rl.sync(liveSearchHeaders());
    // сервер уже потратил 1 хит каждого окна → свободно usable-1 = 3 слота 10с-бакета
    const usableFirst = rl.state()[0]!.usable - 1; // 3 при balanced
    expect(rl.estimate(usableFirst)).toBe(0);
    expect(rl.estimate(usableFirst + 1)).toBe(10 + 1); // хвост окна + DESYNC_PAD
    expect(rl.estimate(usableFirst + 5)).toBeGreaterThanOrEqual(10);
  });

  it('take() через promise-цепь: 5 параллельных take() на щедром бакете — ровно 5 зарядов, без двойных', async () => {
    const rl = new RateLimiter('serial');
    rl.sync(
      new Headers({
        'x-rate-limit-rules': 'Ip',
        'x-rate-limit-ip': '100:3600',
        'x-rate-limit-ip-state': '0:3600:0',
      }),
    );
    await Promise.all(Array.from({ length: 5 }, () => rl.take()));
    const spent = rl.state().map((b) => b.spent);
    // Двойное потребление одного слота невозможно: цепь атомаризирует doTake
    expect(spent).toEqual([5]);
    expect(rl.waitedMs).toBeLessThan(1000); // все вошли мгновенно — слотов хватало
  });
});

describe('budget + createTradeRateState', () => {
  it('BUDGET_SHARES: fast < balanced < gentle', () => {
    const [fast, balanced, gentle] = BUDGET_SHARES.map((s) => s.reserve);
    expect(fast).toBeLessThan(balanced);
    expect(balanced).toBeLessThan(gentle);
  });

  it('мусорный id бюджета = дефолт balanced', () => {
    setBudgetShare('nonsense');
    expect(getUserReserve()).toBeCloseTo(1 / 6, 5);
  });

  it('createTradeRateState: search/fetch — отдельные лимитеры + setBudget', () => {
    const s = createTradeRateState();
    expect(s.search).not.toBe(s.fetch);
    expect(s.search.name).toBe('trade-search-request-limit');
    expect(s.fetch.name).toBe('trade-fetch-request-limit');
    s.setBudget('gentle');
    expect(getUserReserve()).toBeCloseTo(1 / 3, 5);
    s.setBudget(DEFAULT_BUDGET_SHARE);
  });
});
