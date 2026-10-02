/**
 * Result-тип (S9, аудит №175): устранение null-неоднозначности
 * «сеть упала» vs «не найдено» в ценовых функциях ядра.
 *
 * Проблема: core-функции (priceCheck, searchTrade, fetchLeagues, курсы)
 * глотают сетевые ошибки и возвращают пустой результат/null — потребитель
 * (overlay UI) не может отличить «нет листингов на рынке» от «запрос
 * не удался» и рисует пользователям «нет цены» при мёртвой сети.
 *
 * Решение: явный discriminated union Result<T>. Существующий публичный
 * API НЕ меняется — новые варианты с суффиксом `...Result` классифицируют
 * исход (в том числе по «ленте ошибок» http-слоя, куда http.ts пишет каждую
 * финально упавшую сетевую ошибку — см. httpErrorsSince).
 */

export type ResultErrorKind = 'network' | 'notfound' | 'ratelimit' | 'parse' | 'timeout';

export interface ResultError {
  kind: ResultErrorKind;
  message: string;
  /** Повтор запроса имеет смысл (сеть/таймаут/лимит). Для notfound/parse — false. */
  retryable: boolean;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ResultError };

/** Какие kind стоит ретраить. */
const RETRYABLE_KINDS: ReadonlySet<ResultErrorKind> = new Set(['network', 'ratelimit', 'timeout']);

/** Успешный результат. */
export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

/** Ошибочный результат; retryable выводится из kind, если не задан явно. */
export function err<T = never>(
  kind: ResultErrorKind,
  message: string,
  retryable: boolean = RETRYABLE_KINDS.has(kind),
): Result<T> {
  return { ok: false, error: { kind, message, retryable } };
}

/** Сообщение произвольного thrown-значения (Error/DOMException/строка). */
function thrownMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

/**
 * Классифицировать исключение в ResultError. Правила (по тому, что реально
 * бросает http.ts и глобальный fetch):
 *   - HTTP 404            → notfound  (не ретраится)
 *   - HTTP 429 / rate limit→ ratelimit (ретраится, оверлей показывает «жду»)
 *   - AbortError/ETIMEDOUT→ timeout   (ретраится)
 *   - TypeError fetch     → network   (обрыв соединения, DNS; ретраится)
 *   - HTTP 5xx            → network   (апстрим лежит; ретраится)
 *   - JSON/parse-ошибки   → parse     (не ретраится)
 *   - прочее              → network   (консервативно: повтор не вредит)
 */
export function classifyError(e: unknown): ResultError {
  const message = thrownMessage(e);
  const name =
    e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';

  if (/HTTP 429\b/i.test(message) || /\brate limit\b/i.test(message) || /\btoo many requests\b/i.test(message)) {
    return { kind: 'ratelimit', message, retryable: true };
  }
  if (/HTTP 404\b/i.test(message)) {
    return { kind: 'notfound', message, retryable: false };
  }
  if (name === 'AbortError' || /abort/i.test(name) || /\b(abort|ABORT_ERR|ETIMEDOUT|timed? ?out)\b/i.test(message)) {
    return { kind: 'timeout', message, retryable: true };
  }
  if (e instanceof TypeError) {
    // Node/undici fetch: обрыв сети = TypeError "fetch failed"
    return { kind: 'network', message, retryable: true };
  }
  if (/HTTP 5\d\d\b/i.test(message)) {
    return { kind: 'network', message, retryable: true };
  }
  if (/JSON|parse|unexpected token|unexpected end of input/i.test(message) || (!e && message === 'undefined')) {
    return { kind: 'parse', message, retryable: false };
  }
  return { kind: 'network', message, retryable: true };
}

/** Приоритет «худшей» ошибки для пользователя: ratelimit > timeout > network > parse > notfound. */
const KIND_PRIORITY: Record<ResultErrorKind, number> = {
  ratelimit: 4,
  timeout: 3,
  network: 2,
  parse: 1,
  notfound: 0,
};

/**
 * Из набора записанных ошибок выбрать главную (самую важную пользователю).
 * Пустой набор → null («сеть не виновата — действительно пусто»).
 */
export function selectWorstError(errors: Array<{ kind: ResultErrorKind; message: string; retryable: boolean }>): ResultError | null {
  let worst: ResultError | null = null;
  for (const e of errors) {
    if (!worst || KIND_PRIORITY[e.kind] > KIND_PRIORITY[worst.kind]) worst = e;
  }
  return worst;
}

/** Type-guard: успешный Result. */
export function isOk<T>(r: Result<T>): r is { ok: true; data: T } {
  return r.ok;
}
