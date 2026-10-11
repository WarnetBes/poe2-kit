/**
 * OAuth 2.1 (PKCE) клиент GGG — доступ к аккаунтным данным PoE2.
 *
 * Что доступно для PoE2 через официальный API (developer docs GGG, 2026):
 *   - GET /character/poe2            — список персонажей аккаунта
 *   - GET /character/poe2/<name>      — персонаж: экипировка, инвентарь, пассивки
 *   - GET /profile                    — профиль аккаунта
 * Стэш-API для PoE2 НЕТ («Account Stashes — PoE1 only»), это не наша ошибка.
 *
 * Режим public client (десктоп, без client_secret):
 *   - только grant Authorization Code + PKCE (S256);
 *   - redirect URI обязан быть локальным: http://127.0.0.1:<port>/callback;
 *   - токены: access 10 часов, refresh 7 дней (каждый refresh выдаёт НОВЫЙ
 *     refresh-токен и убивает старый — хранить только последний);
 *   - public-клиенты делят ОБЩИЙ рейт-лимит со всеми public-клиентами,
 *     поэтому на api.pathofexile.com распространяется консервативный
 *     статический лимит http.ts (8/мин) + динамический бэкоф по заголовкам
 *     X-Rate-Limit* (gggFetch) — оба слоя применяются автоматически.
 *
 * Клиент_id: GGG регистрирует OAuth-приложения вручную (pathofexile.com/developer
 * или oauth@grindinggear.com). Пока его нет, задаётся env POE2K_GGG_CLIENT_ID —
 * весь код и тесты работают офлайн, live-вход требует только этого env.
 *
 * Хранилище токенов: env POE2K_OAUTH_FILE, иначе ~/.poe2-kit/ggg-oauth.json
 * (режим 0600, best-effort). Токены — персональные: файл не публиковать.
 *
 * Node-only части (callback-сервер) — динамические импорты, чтобы
 * браузерная сборка web не тянула node:http.
 */

import { HAS_DISK, IS_NODE, fsMod, osMod, pathMod, cryptoMod } from './nodeenv.js';
import { httpJson } from './http.js';

const AUTH_BASE = 'https://www.pathofexile.com/oauth/authorize';
const TOKEN_URL = 'https://www.pathofexile.com/oauth/token';
const API_BASE = 'https://api.pathofexile.com';

/** Scopes запрашиваем у пользователя: минимум для задач кита.
 * account:item_filter — Item Filters API (upload лут-фильтра в аккаунт, P3-E).
 * Токены, полученные ДО добавления scope, upload не проходят: GGG ответит
 * 403/401 — лечится повторным входом poe2_oauth_login. */
export const GGG_OAUTH_SCOPES = 'account:profile account:characters account:item_filter';

/** Порт локального redirect (должен совпадать с зарегистрированным URI). */
export const GGG_OAUTH_CALLBACK_PORT = 8080;

// ===== Токены: хранилище =====

export interface GggOAuthToken {
  access_token: string;
  /** Может отсутствовать, если GGG отключила refresh для приложения. */
  refresh_token?: string;
  /** Epoch-ms, когда access-токен истекает. */
  expires_at: number;
  token_type: string;
  scope: string;
  /** UUID субъекта (аккаунта). */
  sub?: string;
  username?: string;
  /** Когда получен (ISO). */
  obtainedAt: string;
}

function tokenFile(): string | null {
  if (!HAS_DISK) return null;
  return (
    process.env['POE2K_OAUTH_FILE'] ??
    pathMod!.join(osMod!.homedir(), '.poe2-kit', 'ggg-oauth.json')
  );
}

function configDir(): string | null {
  if (!HAS_DISK) return null;
  const dir = pathMod!.join(osMod!.homedir(), '.poe2-kit');
  try {
    if (!fsMod!.existsSync(dir)) fsMod!.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

/** Загрузить сохранённые токены (null — вход не выполнен). */
export function loadOAuthToken(): GggOAuthToken | null {
  const file = tokenFile();
  if (!file) return null;
  try {
    const raw = fsMod!.readFileSync(file, 'utf8');
    const t = JSON.parse(raw) as GggOAuthToken;
    if (typeof t.access_token !== 'string' || !t.access_token) return null;
    if (typeof t.expires_at !== 'number') return null;
    return t;
  } catch {
    return null;
  }
}

/** Сохранить токены на диск (0600, best-effort). */
export function saveOAuthToken(token: GggOAuthToken): void {
  const file = tokenFile();
  if (!file || !configDir()) return;
  fsMod!.writeFileSync(file, JSON.stringify(token, null, 2), 'utf8');
  try {
    fsMod!.chmodSync(file, 0o600);
  } catch {
    // Windows ACL — chmod best-effort
  }
}

/** Забыть локальные токены (локальный logout; серверный revoke требует scope oauth:revoke). */
export function clearOAuthToken(): void {
  const file = tokenFile();
  if (!file) return;
  try {
    fsMod!.unlinkSync(file);
  } catch {
    // файла нет — уже чисто
  }
}

/** client_id приложения (env POE2K_GGG_CLIENT_ID; null — не зарегистрировано). */
export function getOAuthClientId(): string | null {
  const v = process.env['POE2K_GGG_CLIENT_ID'];
  return v && v.trim() ? v.trim() : null;
}

/** Состояние OAuth для диагностики (без секретов). */
export function oauthStatus(): {
  clientIdConfigured: boolean;
  authorized: boolean;
  accessTokenValid: boolean;
  refreshable: boolean;
  expiresAt: number | null;
  username: string | null;
  scope: string | null;
} {
  const t = loadOAuthToken();
  return {
    clientIdConfigured: getOAuthClientId() !== null,
    authorized: !!t,
    accessTokenValid: !!t && t.expires_at > Date.now(),
    refreshable: !!t?.refresh_token,
    expiresAt: t?.expires_at ?? null,
    username: t?.username ?? null,
    scope: t?.scope ?? null,
  };
}

// ===== PKCE и URL авторизации =====

/** PKCE-пара по RFC 7636: верифаер 32 байта, challenge = S256(verifier). */
export function generatePkce(): { verifier: string; challenge: string } {
  if (!cryptoMod) throw new Error('PKCE требует Node (node:crypto недоступен)');
  const verifier = cryptoMod.randomBytes(32).toString('base64url');
  const challenge = cryptoMod
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
  return { verifier, challenge };
}

/** Случайный state (защита от CSRF подмены callback). */
export function generateState(): string {
  if (!cryptoMod) throw new Error('state требует Node');
  return cryptoMod.randomBytes(16).toString('hex');
}

/** Собрать URL страницы авторизации (пользователь открывает его в браузере). */
export function buildAuthorizeUrl(params: {
  clientId: string;
  codeChallenge: string;
  state: string;
  port?: number;
  scopes?: string;
}): string {
  const url = new URL(AUTH_BASE);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scopes ?? GGG_OAUTH_SCOPES);
  url.searchParams.set('state', params.state);
  url.searchParams.set(
    'redirect_uri',
    `http://127.0.0.1:${params.port ?? GGG_OAUTH_CALLBACK_PORT}/callback`,
  );
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** Разобрать query локального callback (`?code=…&state=…` или `?error=…`). */
export function parseCallbackQuery(query: string): {
  code: string | null;
  state: string | null;
  error: string | null;
} {
  const q = new URLSearchParams(query);
  return {
    code: q.get('code'),
    state: q.get('state'),
    error: q.get('error'),
  };
}

// ===== Токенный endpoint (form-urlencoded, не JSON) =====

async function tokenEndpoint(form: Record<string, string>): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  sub?: string;
  username?: string;
}> {
  const body = new URLSearchParams(form).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': 'poe2-kit/0.1 (open-source toolkit; github.com/poe2-kit)',
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GGG OAuth token endpoint: HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as never;
  } finally {
    clearTimeout(timer);
  }
}

// ===== Вход: локальный callback-сервер =====

export interface OAuthLoginHandle {
  /** URL, который нужно открыть в браузере. */
  authorizeUrl: string;
  /** Ждёт завершения входа (код авторизации живёт 30 секунд). Резолвится токенами. */
  complete: Promise<{ username?: string; scope: string }>;
  /** Отменить ожидание и закрыть сервер (например, повторный вход). */
  cancel: (reason: string) => void;
}

/**
 * Начать вход: поднимает одноразовый локальный сервер на 127.0.0.1:<port>,
 * возвращает authorizeUrl сразу; резолв `complete` случится, когда GGG
 * перенаправит браузер на /callback с кодом (после согласия пользователя).
 *
 * Таймаут ожидания — 10 минут; отмена — `cancel()`.
 */
export function beginOAuthLogin(port: number = GGG_OAUTH_CALLBACK_PORT): OAuthLoginHandle {
  const clientId = getOAuthClientId();
  if (!clientId) {
    throw new Error(
      'POE2K_GGG_CLIENT_ID не задан: OAuth-приложение GGG ещё не зарегистрировано ' +
        '(pathofexile.com/developer → oauth@grindinggear.com). Пока env не задан, live-вход невозможен.',
    );
  }
  if (!IS_NODE) throw new Error('beginOAuthLogin работает только под Node (нужен node:http)');
  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const authorizeUrl = buildAuthorizeUrl({ clientId, codeChallenge: challenge, state, port });

  const handle: OAuthLoginHandle = {} as OAuthLoginHandle;
  handle.authorizeUrl = authorizeUrl;
  handle.cancel = () => {};
  handle.complete = (async () => {
    const httpMod = await import('node:http');
    return await new Promise<{ username?: string; scope: string }>((resolve, reject) => {
      const server = httpMod.createServer((req, res) => {
        const u = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        if (u.pathname !== '/callback') {
          res.writeHead(404).end('Not found. Waiting for /callback …');
          return;
        }
        const { code, state: cbState, error } = parseCallbackQuery(u.search);
        // Страница-ответилка: работает и как подтверждение в браузере.
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<meta charset="utf-8"><title>poe2-kit</title>' +
            '<h3>poe2-kit: вход выполнен — это окно можно закрыть.</h3>',
        );
        server.close();
        clearTimeout(deadline);
        if (error) {
          reject(new Error(`GGG вернул ошибку авторизации: ${error}`));
          return;
        }
        if (!code || cbState !== state) {
          reject(new Error('callback без кода или с неверным state — вход прерван'));
          return;
        }
        // Код живёт 30 секунд — меняем на токены немедленно.
        tokenEndpoint({
          client_id: clientId,
          grant_type: 'authorization_code',
          code,
          redirect_uri: `http://127.0.0.1:${port}/callback`,
          scope: GGG_OAUTH_SCOPES,
          code_verifier: verifier,
        })
          .then((r) => {
            const token: GggOAuthToken = {
              access_token: r.access_token,
              refresh_token: r.refresh_token,
              expires_at: Date.now() + r.expires_in * 1000,
              token_type: r.token_type,
              scope: r.scope,
              sub: r.sub,
              username: r.username,
              obtainedAt: new Date().toISOString(),
            };
            saveOAuthToken(token);
            resolve({ username: r.username, scope: r.scope });
          })
          .catch(reject);
      });
      // Одноразовый сервер: порт занят — говорим человеческим текстом.
      server.on('error', (e: NodeJS.ErrnoException) => {
        clearTimeout(deadline);
        reject(
          new Error(
            e.code === 'EADDRINUSE'
              ? `порт ${port} занят (другой клиент или прошлый запуск); закройте и повторите`
              : `callback-сервер: ${e.message}`,
          ),
        );
      });
      server.listen(port, '127.0.0.1');
      // Общий таймаут на весь вход (10 минут), не только на обмен кода.
      const deadline = setTimeout(() => {
        server.close();
        reject(new Error('ожидание входа истекло (10 минут) — вызовите poe2_oauth_login снова'));
      }, 10 * 60 * 1000);
      handle.cancel = (reason: string) => {
        clearTimeout(deadline);
        server.close();
        reject(new Error(`вход отменён: ${reason}`));
      };
    });
  })();
  return handle;
}

// ===== Обновление и использование токенов =====

/** Обновить access-токен по refresh-токену (старый refresh умирает — перезаписываем). */
export async function refreshOAuthToken(t?: GggOAuthToken): Promise<GggOAuthToken> {
  const cur = t ?? loadOAuthToken();
  if (!cur) throw new Error('нет сохранённых токенов — сначала выполните вход');
  if (!cur.refresh_token) throw new Error('обновление недоступно: у приложения отключён refresh (перевойдите)');
  const clientId = getOAuthClientId();
  if (!clientId) throw new Error('POE2K_GGG_CLIENT_ID не задан — обновление невозможно');
  const r = await tokenEndpoint({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: cur.refresh_token,
  });
  const token: GggOAuthToken = {
    access_token: r.access_token,
    // новый refresh наследует срок старого; старый мёртв — храним только последний
    refresh_token: r.refresh_token ?? cur.refresh_token,
    expires_at: Date.now() + r.expires_in * 1000,
    token_type: r.token_type,
    scope: r.scope,
    sub: r.sub ?? cur.sub,
    username: r.username ?? cur.username,
    obtainedAt: new Date().toISOString(),
  };
  saveOAuthToken(token);
  return token;
}

/** Действующий access-токен: из кэша, а при истечении — refresh (и refresh, и вход падают внятно). */
export async function requireAccessToken(): Promise<GggOAuthToken> {
  const t = loadOAuthToken();
  if (!t) throw new Error('вход в GGG не выполнен: вызовите poe2_oauth_login');
  if (t.expires_at - 60_000 > Date.now()) return t;
  return refreshOAuthToken(t);
}

// ===== Аккаунтные данные PoE2 (api.pathofexile.com) =====

/** Персонаж из списка (докам GGG известны эти поля; остальное — unknown). */
export interface GggCharacter {
  id?: string;
  name: string;
  realm?: string;
  class?: string;
  league?: string | null;
  level?: number;
  experience?: number;
  [key: string]: unknown;
}

const AUTH_HEADER_PREFIX = 'Bearer ';

/** GET к api.pathofexile.com с Bearer. 401 → один refresh → повтор. */
async function apiGetJson<T>(path: string): Promise<T> {
  return apiCallJson<T>(path);
}

/**
 * Запрос к api.pathofexile.com с Bearer: GET (без body) или POST c JSON-body.
 * 401 → один refresh → повтор: отклонённый до обработки запрос безопасно ретраить.
 */
async function apiCallJson<T>(
  path: string,
  opts: { body?: unknown; query?: string } = {},
): Promise<T> {
  const token = await requireAccessToken();
  const url = `${API_BASE}${path}${opts.query ? `?${opts.query}` : ''}`;
  const call = (t: GggOAuthToken) =>
    httpJson<T>(url, {
      method: opts.body !== undefined ? 'POST' : 'GET',
      body: opts.body,
      headers: { Authorization: AUTH_HEADER_PREFIX + t.access_token },
      timeoutMs: 20000,
    });
  try {
    return await call(token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // httpJson сворачивает HTTP-ошибки в текст «HTTP 401 from …»: это истёкший
    // токен — рефрешим и пробуем ещё раз (ровно один, без цикла).
    if (/^HTTP 401 /.test(msg)) {
      const fresh = await refreshOAuthToken(token);
      return await call(fresh);
    }
    throw e;
  }
}

/** Список персонажей аккаунта (realm poe2). */
export async function listPoe2Characters(): Promise<GggCharacter[]> {
  const r = await apiGetJson<{ characters?: GggCharacter[] }>('/character/poe2');
  return r.characters ?? [];
}

/** Персонаж целиком: экипировка, инвентарь, пассивки (сырой ответ GGG). */
export async function getPoe2Character(name: string): Promise<{ character: GggCharacter | null }> {
  const safe = encodeURIComponent(name);
  // имя в path — GGG не допускает слэшей и прочего; reject нагло-опасное на границе
  if (name.includes('/') || name.includes('\\') || name.length > 64) {
    throw new Error(`недопустимое имя персонажа: ${JSON.stringify(name)}`);
  }
  const r = await apiGetJson<{ character?: GggCharacter | null }>(`/character/poe2/${safe}`);
  return { character: r.character ?? null };
}

/** Профиль аккаунта (uuid, имя, twitch-привязка). */
export async function getAccountProfile(): Promise<{
  uuid?: string;
  name?: string;
  locale?: string | null;
  [key: string]: unknown;
}> {
  return apiGetJson<Record<string, unknown>>('/profile');
}

// ===== Item Filters API (аккаунтные онлайн-фильтры, GGG developer docs) =====
// Канон: https://www.pathofexile.com/developer/docs/reference#itemfilters
//   GET  /item-filter        → { filters: ItemFilter[] } (без body и validation)
//   GET  /item-filter/<id>   → { filter: ItemFilter }    (с body и validation)
//   POST /item-filter        (create, body JSON, Content-Type обязателен)
//   POST /item-filter/<id>   (partial update; 202 = сохранено, но есть ошибки)
// Realm enum: pc | xbox | sony | poe2. Scope: account:item_filter. P3-E.

/** Аккаунтный онлайн-фильтр GGG (object ItemFilter из developer docs). */
export interface GggItemFilter {
  id?: string;
  filter_name: string;
  realm: string;
  description?: string;
  version?: string;
  /** Normal | Ruthless. */
  type?: string;
  /** Всегда true, если присутствует. */
  public?: boolean;
  /** Тело фильтра; отсутствует в list-запросах. */
  filter?: string;
  validation?: { valid: boolean; version?: string | null; validated?: string | null };
  [key: string]: unknown;
}

/** Результат upsert: что реально произошло на аккаунте GGG. */
export interface GggItemFilterUpsertResult {
  action: 'created' | 'updated' | 'unchanged';
  /** Свежий объект ItemFilter (для unchanged — прочитанный с аккаунта). */
  filter: GggItemFilter;
  /**
   * true — GGG ответил 202 Accepted: фильтр сохранён, но требуются доработки
   * (validate нашёл ошибки). Сам error-объект — в validationError.
   */
  acceptedWithErrors?: boolean;
  /** Сырой error-объект из ответа 202. */
  validationError?: unknown;
}

/** Список онлайн-фильтров аккаунта (без тел фильтров). */
export async function listAccountItemFilters(): Promise<GggItemFilter[]> {
  const r = await apiGetJson<{ filters?: GggItemFilter[] }>('/item-filter');
  return r.filters ?? [];
}

/** Один фильтр целиком: тело + validation. */
export async function getAccountItemFilter(id: string): Promise<GggItemFilter | null> {
  const safe = requireSafeFilterId(id);
  const r = await apiGetJson<{ filter?: GggItemFilter | null }>(`/item-filter/${safe}`);
  return r.filter ?? null;
}

/** Идентификатор фильтра в path: только URL-safe, без слэшей (граница API). */
function requireSafeFilterId(id: string): string {
  if (
    !id ||
    id.length > 128 ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('?') ||
    id.includes('#') ||
    !/^[A-Za-z0-9_-]+$/.test(id)
  ) {
    throw new Error(`недопустимый id фильтра: ${JSON.stringify(id)}`);
  }
  return id;
}

/** Валидны ли параметры type/realm по канону developer docs. */
function assertItemFilterEnum(name: string, value: string, allowed: readonly string[]): void {
  if (!allowed.includes(value)) {
    throw new Error(`недопустимый ${name} фильтра: ${JSON.stringify(value)} (можно: ${allowed.join(', ')})`);
  }
}

/**
 * Idempotent-загрузка фильтра на аккаунт GGG (P3-E):
 * ищем по filter_name+realm → тело совпадает ⇒ unchanged;
 * нашли ⇒ POST /item-filter/<id> (partial update); нет ⇒ POST /item-filter (create).
 * validate=true — попросить GGG провалидировать против текущей версии игры.
 */
export async function upsertAccountItemFilter(opts: {
  filterName: string;
  content: string;
  realm?: string;
  description?: string;
  version?: string;
  type?: string;
  validate?: boolean;
}): Promise<GggItemFilterUpsertResult> {
  const realm = opts.realm ?? 'poe2';
  if (!opts.filterName || opts.filterName.length > 64 || opts.filterName.includes('\n')) {
    throw new Error(`недопустимое имя фильтра: ${JSON.stringify(opts.filterName)}`);
  }
  assertItemFilterEnum('realm', realm, ['pc', 'xbox', 'sony', 'poe2']);
  if (opts.type !== undefined) assertItemFilterEnum('type', opts.type, ['Normal', 'Ruthless']);
  if (!opts.content.trim()) throw new Error('пустое тело фильтра: GGG отклонит загрузку');
  const validateQuery = opts.validate ? 'validate=true' : undefined;

  const existing = (await listAccountItemFilters()).find(
    (f) => f.filter_name === opts.filterName && f.realm === realm,
  );

  if (existing?.id) {
    const current = await getAccountItemFilter(existing.id);
    if (current && current.filter === opts.content) {
      return { action: 'unchanged', filter: current };
    }
    const body: Record<string, unknown> = { filter: opts.content };
    if (opts.description !== undefined) body['description'] = opts.description;
    if (opts.version !== undefined) body['version'] = opts.version;
    if (opts.type !== undefined) body['type'] = opts.type;
    const r = await apiCallJson<{ filter?: GggItemFilter; error?: unknown }>(
      `/item-filter/${existing.id}`,
      { body, query: validateQuery },
    );
    if (!r.filter) throw new Error(`GGG не вернул объект фильтра после обновления: ${JSON.stringify(r).slice(0, 200)}`);
    return {
      action: 'updated',
      filter: r.filter,
      ...(r.error !== undefined ? { acceptedWithErrors: true, validationError: r.error } : {}),
    };
  }

  const body: Record<string, unknown> = {
    filter_name: opts.filterName,
    realm,
    filter: opts.content,
  };
  if (opts.description !== undefined) body['description'] = opts.description;
  if (opts.version !== undefined) body['version'] = opts.version;
  if (opts.type !== undefined) body['type'] = opts.type;
  const r = await apiCallJson<{ filter?: GggItemFilter; error?: unknown }>('/item-filter', {
    body,
    query: validateQuery,
  });
  if (!r.filter) throw new Error(`GGG не вернул объект фильтра после создания: ${JSON.stringify(r).slice(0, 200)}`);
  return {
    action: 'created',
    filter: r.filter,
    ...(r.error !== undefined ? { acceptedWithErrors: true, validationError: r.error } : {}),
  };
}
