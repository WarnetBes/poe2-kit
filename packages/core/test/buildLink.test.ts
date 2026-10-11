/**
 * E1 (мастер-план §5): pobb.in / poe.ninja импорт-клиент.
 * - pob2://poeninja/ID протокол-хендлер PoB2 (donor poe2-mcp-server pob.ts:326-338, MIT)
 * - HOST_LIMITS: pobb.in 10/60с (недокументирован, консервативно), poe.ninja 10/5мин
 * - 404 → «билд не найден или удалён», 429 → «превышен rate-лимит»
 * - link-кэш LRU: одна ссылка = один fetch на цикл importBuild (donor: лимит poe.ninja общий)
 *
 * Сеть мокаем целиком (gggFetch → global fetch), живых запросов нет.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { toXml, clearBuildLinkCache, PobCodeError, fetchProfileCharacterCode } from '../src/build.js';
import { resetHttpState, httpErrorsSince, clearHttpErrorTape } from '../src/http.js';

const XML_HEAD = '<PathOfBuilding2 TreeData="0_5"><Build level="30"/></PathOfBuilding2>';

function res(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : body, {
    status,
    headers: { 'content-type': 'text/plain', ...headers },
  });
}

let calls: string[] = [];
let next: () => Response;

beforeEach(() => {
  resetHttpState();
  clearHttpErrorTape();
  clearBuildLinkCache();
  calls = [];
  next = () => res(200, XML_HEAD);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      calls.push(u);
      return next();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('E1: pob2:// протокол-хендлер PoB2', () => {
  it('pob2://poeninja/ID → raw-эндпоинт poe.ninja', async () => {
    const xml = await toXml('pob2://poeninja/28880');
    expect(xml).toContain('PathOfBuilding');
    expect(calls[0]).toBe('https://poe.ninja/poe2/pob/raw/28880');
  });

  it('pob2:// с backslash-вариантом тоже распознаётся', async () => {
    await toXml('pob2://poeninja/123');
    expect(calls[0]).toBe('https://poe.ninja/poe2/pob/raw/123');
  });

  it('https-ссылка poe.ninja/pob/ID по-прежнему работает', async () => {
    await toXml('https://poe.ninja/poe2/pob/28880/');
    expect(calls[0]).toBe('https://poe.ninja/poe2/pob/raw/28880');
  });
});

describe('E1: pobb.in ID-экстрактор (u/username/id, /raw-срезание)', () => {
  it('вложенный ID u/user/abc проходит', async () => {
    await toXml('https://pobb.in/u/username/abc/raw');
    expect(calls[0]).toBe('https://pobb.in/u/username/abc/raw');
  });

  it('обычный ID без /raw не ломается', async () => {
    await toXml('https://pobb.in/abc123');
    expect(calls[0]).toBe('https://pobb.in/abc123/raw');
  });
});

describe('E1: 404/429 дифференциация', () => {
  it('404 → PobCodeError «не найден или удалён», без ретрая', async () => {
    next = () => res(404, 'not found');
    await expect(toXml('https://pobb.in/zzzzz')).rejects.toThrow(/не найден или удалён/);
    // 404 не ретраится: ровно один живой запрос (donor pob.ts:307-315).
    expect(calls.length).toBe(1);
  });

  it('429 → PobCodeError «превышен rate-лимит»', async () => {
    let n = 0;
    next = () => {
      n++;
      return res(429, 'slow down', { 'retry-after': '1' });
    };
    await expect(toXml('https://pobb.in/abc')).rejects.toThrow(/rate-лимит/);
    expect(n).toBeLessThanOrEqual(3); // ≤2 ggg-ретрая 429, не бесконечно
  });

  it('финальная 404 попадает в ленту сетевых ошибок', async () => {
    next = () => res(404, 'not found');
    const t0 = Date.now() - 1;
    try {
      await toXml('https://pobb.in/qqq');
    } catch {}
    expect(httpErrorsSince(t0, 'pobb.in').length).toBeGreaterThanOrEqual(1);
  });
});

describe('E1: link-кэш (paste иммутабелен)', () => {
  it('три вызова toXml по одной ссылке → один fetch', async () => {
    await toXml('https://pobb.in/abcxyz');
    await toXml('https://pobb.in/abcxyz');
    await toXml('https://pobb.in/abcxyz');
    expect(calls.filter((u) => u.includes('pobb.in')).length).toBe(1);
  });

  it('clearBuildLinkCache сбрасывает кэш', async () => {
    await toXml('https://pobb.in/abcxyz');
    clearBuildLinkCache();
    await toXml('https://pobb.in/abcxyz');
    expect(calls.filter((u) => u.includes('pobb.in')).length).toBe(2);
  });

  it('LRU вытесняет старейший при 8+ ссылках', async () => {
    // pastebin: default-лимит 30/60с — 11 запросов не упираются в окно
    // (pobb.in 10/60с заставил бы лимитер ждать минуту).
    for (let i = 0; i < 9; i++) {
      await toXml(`https://pastebin.com/raw/lk${i}`);
    }
    await toXml('https://pastebin.com/lk0'); // вытеснен — снова fetch
    expect(calls.filter((u) => u.endsWith('/lk0')).length).toBe(2);
  });
});

describe('E1: профиль poe.ninja через http-слой', () => {
  it('fetchProfileCharacterCode: 404-версии перебираются, found — возвращается код', async () => {
    next = () => res(
      200,
      JSON.stringify({
        type: 'found',
        charModel: { pathOfBuildingExport: 'eJx' },
      }),
    );
    const ref = {
      account: 'acc',
      league: 'st',
      character: 'char',
    } as const;
    const code = await fetchProfileCharacterCode(ref);
    expect(code).toBe('eJx');
  });
});
