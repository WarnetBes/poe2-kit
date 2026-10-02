/**
 * S9 (аудит №175): Result-тип + классификация null-неоднозначности
 * «сеть упала» vs «не найдено». Офлайн: глобальный fetch мокается, сети нет.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fsSync from 'node:fs';
import * as osSync from 'node:os';
import * as pathSync from 'node:path';
import {
  ok,
  err,
  classifyError,
  selectWorstError,
  isOk,
  type Result,
  type ResultError,
} from '../src/result.js';
import { httpErrorsSince, clearHttpErrorTape, resetHttpState, httpJson } from '../src/http.js';
import {
  fetchLeaguesResult,
  searchTradeResult,
  fetchBestCurrencyRatesResult,
  invalidateLeagues,
  clearScoutCache,
  clearRatesCache,
} from '../src/trade.js';

// ─── Чистые хелперы/классификация ───────────────────────────────────────────

describe('result: ok()/err() и форма типа', () => {
  it('ok() несёт данные, ok:true; isOk() — type-guard', () => {
    const r = ok([1, 2]);
    expect(r.ok).toBe(true);
    expect(isOk(r)).toBe(true);
    if (r.ok) expect(r.data).toEqual([1, 2]);
    const bad: Result<number> = err<number>('network', 'x');
    expect(isOk(bad)).toBe(false);
  });

  it('err(): retryable выводится из kind (ratelimit/network/timeout true, notfound/parse false)', () => {
    expect(err('ratelimit', 'x')).toEqual({ ok: false, error: { kind: 'ratelimit', message: 'x', retryable: true } });
    expect(err('notfound', 'x')).toEqual({ ok: false, error: { kind: 'notfound', message: 'x', retryable: false } });
    expect(err('network', 'x')).toEqual({ ok: false, error: { kind: 'network', message: 'x', retryable: true } });
    expect(err('timeout', 'x')).toEqual({ ok: false, error: { kind: 'timeout', message: 'x', retryable: true } });
    expect(err('parse', 'x')).toEqual({ ok: false, error: { kind: 'parse', message: 'x', retryable: false } });
  });
});

describe('result: classifyError — сигналы http.ts/fetch', () => {
  it('HTTP 404 → notfound, не ретраится', () => {
    const c = classifyError(new Error('HTTP 404 from https://x: not found'));
    expect(c.kind).toBe('notfound');
    expect(c.retryable).toBe(false);
  });

  it('HTTP 429 → ratelimit, ретрается', () => {
    const c = classifyError(new Error('HTTP 429 from https://x: rate limited'));
    expect(c.kind).toBe('ratelimit');
    expect(c.retryable).toBe(true);
  });

  it('таймаут (AbortError) → timeout, ретрается', () => {
    const e = new Error('This operation was aborted');
    e.name = 'AbortError';
    const c = classifyError(e);
    expect(c.kind).toBe('timeout');
    expect(c.retryable).toBe(true);
  });

  it('fetch failed (TypeError — обрыв сети/DNS) → network, ретраится', () => {
    const c = classifyError(new TypeError('fetch failed'));
    expect(c).toEqual({ kind: 'network', message: 'fetch failed', retryable: true });
  });

  it('HTTP 500/503 (апстрим лежит) → network, ретраится', () => {
    expect(classifyError(new Error('HTTP 500 from https://www.pathofexile.com: oops')).kind).toBe('network');
    expect(classifyError(new Error('HTTP 503 from https://x: maintenance')).kind).toBe('network');
  });

  it('JSON-мусор → parse, не ретрается', () => {
    const c = classifyError(new Error('Unexpected token < in JSON at position 0'));
    expect(c.kind).toBe('parse');
    expect(c.retryable).toBe(false);
  });
});

describe('result: selectWorstError — приоритет для пользователя', () => {
  const r = (kind: ResultError['kind']): ResultError => ({ kind, message: kind, retryable: true });

  it('ratelimit важнее timeout/network/notfound', () => {
    expect(selectWorstError([r('network'), r('ratelimit'), r('notfound')])!.kind).toBe('ratelimit');
  });

  it('timeout важнее network; пустой набор → null', () => {
    expect(selectWorstError([r('network'), r('timeout')])!.kind).toBe('timeout');
    expect(selectWorstError([])).toBeNull();
  });
});

// ─── Мок fetch ───────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Установить глобальный fetch-мок; обработчик получает URL. */
function stubFetch(handler: (url: string) => Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    ((input: RequestInfo | URL) => handler(String(input))) as typeof fetch,
  );
}

function restoreFetch(): void {
  vi.unstubAllGlobals();
}

/** Свежий дисковый кэш-каталог на тест (изоляция cachedJson от прошлых прогонов). */
function mkTmpCacheDir(): string {
  return fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'poe2kit-result-test-'));
}

// ─── Лента ошибок http-слоя ──────────────────────────────────────────────────

describe('http: лента ошибок httpErrorsSince', () => {
  beforeEach(() => {
    resetHttpState();
    process.env['POE2_KIT_CACHE_DIR'] = mkTmpCacheDir();
  });
  afterEach(restoreFetch);

  it('успешный запрос не попадает в ленту', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, { ok: 1 })));
    await httpJson('https://api.poe2scout.com/poe2/Leagues');
    expect(httpErrorsSince(0)).toHaveLength(0);
  });

  it('HTTP 404 записывается kind:notfound с хостом', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(404, { error: 'nope' })));
    const since = Date.now();
    await expect(httpJson('https://www.pathofexile.com/api/trade2/data/stats')).rejects.toThrow();
    const tape = httpErrorsSince(since, 'pathofexile.com');
    expect(tape).toHaveLength(1);
    expect(tape[0]!.kind).toBe('notfound');
    expect(tape[0]!.host).toContain('pathofexile.com');
    expect(tape[0]!.retryable).toBe(false);
  });

  it('обрыв сети (TypeError fetch failed) записывается kind:network', async () => {
    stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    const since = Date.now();
    await expect(httpJson('https://api.poe2scout.com/poe2/Leagues')).rejects.toThrow();
    expect(httpErrorsSince(since, 'poe2scout.com')[0]!.kind).toBe('network');
  });
});

// ─── ...Result-обёртки (офлайн-моки) ──────────────────────────────────────────

describe('trade: ...Result — «сеть упала» отличается от «не найдено»', () => {
  beforeEach(() => {
    resetHttpState(); // изоляция rate-лимитов/очередей от предыдущих кейсов
    invalidateLeagues();
    clearScoutCache();
    clearRatesCache();
    process.env['POE2_KIT_CACHE_DIR'] = mkTmpCacheDir();
  });
  afterEach(restoreFetch);

  it('fetchLeaguesResult: живой poe2scout → ok с лигами', async () => {
    stubFetch(() =>
      Promise.resolve(jsonResponse(200, [
        { Value: 'Forbidden Rites', ShortName: 'forbiddenrites', IsCurrent: true },
      ])),
    );
    const r = await fetchLeaguesResult();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.length).toBeGreaterThan(0);
      expect(r.data[0]!.name).toBe('Forbidden Rites');
    }
  });

  it('fetchLeaguesResult: сеть вниз → err kind:network (а не тихий fallback-список)', async () => {
    stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    const r = await fetchLeaguesResult();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('network');
      expect(r.error.retryable).toBe(true);
    }
  });

  it('searchTradeResult: листинги есть → ok', async () => {
    stubFetch((url) => {
      if (url.includes('/api/trade2/search/')) {
        return Promise.resolve(jsonResponse(200, { id: 'abc', result: ['h1', 'h2'] }));
      }
      if (url.includes('/api/trade2/fetch/')) {
        return Promise.resolve(jsonResponse(200, {
          result: [
            { listing: { price: { amount: 5, currency: 'chaos' } } },
            { listing: { price: { amount: 7, currency: 'chaos' } } },
          ],
        }));
      }
      // /Leagues poe2scout
      return Promise.resolve(jsonResponse(200, [
        { Value: 'Forbidden Rites', ShortName: 'forbiddenrites', IsCurrent: true },
      ]));
    });
    const r = await searchTradeResult({ type: 'Gold Ring' }, { league: 'Forbidden Rites' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toHaveLength(2);
      expect(r.data[0]!.price).toBe(5);
    }
  });

  it('searchTradeResult: сеть к trade2 вниз → err kind:network (раньше это был «просто пустой []»)', async () => {
    stubFetch((url) => {
      if (url.includes('pathofexile.com')) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve(jsonResponse(200, [
        { Value: 'Forbidden Rites', ShortName: 'forbiddenrites', IsCurrent: true },
      ]));
    });
    const r = await searchTradeResult({ type: 'Iron Ring' }, { league: 'Forbidden Rites' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(['network', 'timeout']).toContain(r.error.kind);
      expect(r.error.retryable).toBe(true);
    }
  });

  it('fetchBestCurrencyRatesResult: курсы есть → ok, цены в Chaos', async () => {
    stubFetch((url) => {
      if (url.includes('/Currencies/')) {
        return Promise.resolve(jsonResponse(200, {
          Items: [{ ApiId: 'divine', Text: 'Divine Orb', CurrentPrice: 150 }],
        }));
      }
      // /Leagues (для конвертации в Chaos) и poe.ninja
      return Promise.resolve(jsonResponse(200, [
        { Value: 'Runes of Aldur', ShortName: 'runesofaldur', IsCurrent: true, DivinePrice: 100, ChaosDivinePrice: 300 },
      ]));
    });
    const r = await fetchBestCurrencyRatesResult('Runes of Aldur');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.length).toBeGreaterThan(0);
  });

  it('fetchBestCurrencyRatesResult: пустой список без сетевых ошибок → ok (молодая лига)', async () => {
    stubFetch((url) => {
      if (url.includes('/Currencies/')) return Promise.resolve(jsonResponse(200, { Items: [] }));
      if (url.includes('poe.ninja')) return Promise.resolve(jsonResponse(200, { lines: [], core: { items: [], rates: {} } }));
      return Promise.resolve(jsonResponse(200, [
        { Value: 'Empty League', ShortName: 'empty', IsCurrent: false, DivinePrice: 100, ChaosDivinePrice: 300 },
      ]));
    });
    const r = await fetchBestCurrencyRatesResult('Empty League');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual([]);
  });

  it('fetchBestCurrencyRatesResult: оба источника вниз → err kind:network', async () => {
    stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    const r = await fetchBestCurrencyRatesResult('Runes of Aldur');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('network');
  });
});
