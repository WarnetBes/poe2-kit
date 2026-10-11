/**
 * Тесты Item Filters API (oauth.ts, P3-E): list/get/upsert против мока fetch.
 *
 * Полный реальный код-путь (Bearer, 401→refresh, лимит http.ts) — поэтому
 * мокаем только глобальный fetch; токен положен во временный файл через
 * POE2K_OAUTH_FILE,имальный refresh-токен, чтобы 401-ветка не сработала.
 * Канон ответов: GGG developer docs #itemfilters (object ItemFilter).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearHttpErrorTape, resetHttpState } from '../src/http.js';
import {
  getAccountItemFilter,
  listAccountItemFilters,
  upsertAccountItemFilter,
  type GggOAuthToken,
} from '../src/oauth.js';

const TOKEN_FILE = path.join(os.tmpdir(), `poe2kit-oauth-test-${process.pid}.json`);

function writeToken(): void {
  const t: GggOAuthToken = {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_at: Date.now() + 3600_000,
    token_type: 'Bearer',
    scope: 'account:profile account:characters account:item_filter',
    obtainedAt: new Date().toISOString(),
  };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(t), 'utf8');
}

/** Ответ, достаточный для httpJson/gggFetch: ok/status/text/headers.get. */
function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  const h = new Map(Object.entries(headers));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null },
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

interface Route {
  method: string;
  url: string;
  status?: number;
  body?: unknown;
  /** Счётчик вызовов этого маршрута. */
  hits?: number;
}

function installFetch(routes: Route[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).split('?')[0];
      const method = (init?.method ?? 'GET').toUpperCase();
      const r = routes.find((x) => x.method === method && x.url === url);
      if (!r) return reply(404, { error: `no mock route for ${method} ${url}` });
      r.hits = (r.hits ?? 0) + 1;
      return reply(r.status ?? 200, r.body);
    }),
  );
}

const FILTER_A = { id: 'abc123', filter_name: 'poe2kit_live', realm: 'poe2', version: '0.1.0', type: 'Normal' };
const CONTENT = ['Show', '    BaseType "Exalted Orb"', '    SetTextColor 255 0 0'].join('\n');

describe('oauth item filters api', () => {
  beforeEach(() => {
    process.env['POE2K_OAUTH_FILE'] = TOKEN_FILE;
    writeToken();
    resetHttpState();
    clearHttpErrorTape();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['POE2K_OAUTH_FILE'];
    try {
      fs.unlinkSync(TOKEN_FILE);
    } catch {
      /* уже нет */
    }
  });

  it('list: {filters} из GET /item-filter, Bearer из токен-файла', async () => {
    let authHeader = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        authHeader = String((init?.headers as Record<string, string>)?.['Authorization'] ?? '');
        return reply(200, { filters: [FILTER_A] });
      }),
    );
    const list = await listAccountItemFilters();
    expect(list).toHaveLength(1);
    expect(list[0]?.filter_name).toBe('poe2kit_live');
    expect(authHeader).toBe('Bearer test-access-token');
  });

  it('upsert создаёт фильтр, если на аккаунте нет совпадения по имени+realm', async () => {
    const postRoute: Route = {
      method: 'POST',
      url: 'https://api.pathofexile.com/item-filter',
      body: { filter: { ...FILTER_A, filter: CONTENT } },
    };
    installFetch([
      { method: 'GET', url: 'https://api.pathofexile.com/item-filter', body: { filters: [] } },
      postRoute,
    ]);
    const r = await upsertAccountItemFilter({ filterName: 'poe2kit_live', content: CONTENT });
    expect(r.action).toBe('created');
    expect(postRoute.hits).toBe(1);
    expect(r.filter.filter).toBe(CONTENT);
  });

  it('upsert не перезаписывает при байт-в-байт совпадении тела (unchanged)', async () => {
    const postRoute: Route = {
      method: 'POST',
      url: 'https://api.pathofexile.com/item-filter/abc123',
      body: { filter: FILTER_A },
    };
    installFetch([
      { method: 'GET', url: 'https://api.pathofexile.com/item-filter', body: { filters: [FILTER_A] } },
      {
        method: 'GET',
        url: 'https://api.pathofexile.com/item-filter/abc123',
        body: { filter: { ...FILTER_A, filter: CONTENT } },
      },
      postRoute,
    ]);
    const r = await upsertAccountItemFilter({ filterName: 'poe2kit_live', content: CONTENT });
    expect(r.action).toBe('unchanged');
    expect(postRoute.hits).toBeUndefined();
  });

  it('upsert обновляет существующий фильтр через POST /item-filter/<id>', async () => {
    const newContent = CONTENT + '\n# tuned';
    const postRoute: Route = {
      method: 'POST',
      url: 'https://api.pathofexile.com/item-filter/abc123',
      body: { filter: { ...FILTER_A, filter: newContent } },
    };
    installFetch([
      { method: 'GET', url: 'https://api.pathofexile.com/item-filter', body: { filters: [FILTER_A] } },
      {
        method: 'GET',
        url: 'https://api.pathofexile.com/item-filter/abc123',
        body: { filter: { ...FILTER_A, filter: CONTENT } },
      },
      postRoute,
    ]);
    const r = await upsertAccountItemFilter({ filterName: 'poe2kit_live', content: newContent });
    expect(r.action).toBe('updated');
    expect(postRoute.hits).toBe(1);
    expect(r.filter.filter).toBe(newContent);
    expect(r.acceptedWithErrors).toBeUndefined();
  });

  it('upsert честно отдаёт 202-ошибки валидации (validated, with errors)', async () => {
    const gggError = { error: { message: 'Line 2: Unknown key "BogusKey"' } };
    installFetch([
      { method: 'GET', url: 'https://api.pathofexile.com/item-filter', body: { filters: [FILTER_A] } },
      {
        method: 'GET',
        url: 'https://api.pathofexile.com/item-filter/abc123',
        body: { filter: { ...FILTER_A, filter: 'old' } },
      },
      {
        method: 'POST',
        url: 'https://api.pathofexile.com/item-filter/abc123',
        status: 202,
        body: { filter: { ...FILTER_A, filter: CONTENT }, ...gggError },
      },
    ]);
    const r = await upsertAccountItemFilter({ filterName: 'poe2kit_live', content: CONTENT, validate: true });
    expect(r.action).toBe('updated');
    expect(r.acceptedWithErrors).toBe(true);
    expect(r.validationError).toEqual(gggError.error);
  });

  it('bad id отклоняется на границе (path traversal невозможен)', async () => {
    installFetch([]);
    await expect(getAccountItemFilter('../item-filter/other')).rejects.toThrow(/недопустимый id фильтра/);
    await expect(getAccountItemFilter('abc/def')).rejects.toThrow(/недопустимый id/);
  });

  it('bad realm отклоняется на границе до первого запроса', async () => {
    installFetch([]);
    await expect(
      upsertAccountItemFilter({ filterName: 'x', content: CONTENT, realm: 'poe1' }),
    ).rejects.toThrow(/недопустимый realm/);
  });

  it('без токена внятная ошибка входа, fetch не вызывается', async () => {
    delete process.env['POE2K_OAUTH_FILE'];
    process.env['POE2K_OAUTH_FILE'] = path.join(os.tmpdir(), `poe2kit-no-such-${Date.now()}.json`);
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(getAccountItemFilter('abc123')).rejects.toThrow(/вход в GGG не выполнен/);
    expect(f).not.toHaveBeenCalled();
  });
});
