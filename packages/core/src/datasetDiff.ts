/**
 * Контрольный diff датасета до/после refresh (Этап 4, №248).
 *
 * Философия: обновление НИКОГДА не молчит. refresh-data.mjs перед каждым
 * шагом снимает снапшот целевого JSON-файла, после шага — снимает снова и
 * печатает сравнительный отчёт: число записей, размер, изменился ли контент
 * (fingerprint). Это НЕ полный дифф — только счётчики и сам факт разницы;
 * изменение фактов всегда проходит через явное принятие человеком (никаких
 * автокоммитов).
 *
 * Чистые функции без диска — файлы читает вызывающий (скрипт/тест).
 */

export interface DatasetSnapshot {
  /** Число «записей» (эвристика countRecords), null — структура не распознана. */
  records: number | null;
  /** Размер JSON-строки (символов). */
  chars: number;
  /** Перманентный отпечаток контента (sha256-подобный, стабильный). */
  fingerprint: string;
  /** Дата из меты, если есть (для верхней строки отчёта). */
  metaDate: string | null;
}

export interface DatasetDiffReport {
  /** Снапшот до (null — файл не существовал). */
  before: DatasetSnapshot | null;
  /** Снапшот после (null — файл исчез после refresh — тревожный случай). */
  after: DatasetSnapshot | null;
  /** Разница записей (after − before); null — не считалась. */
  recordsDelta: number | null;
  /** Контент изменился (fingerprint разный). */
  contentChanged: boolean;
}

/**
 * Эвристика подсчёта «записей» датасета по структуре:
 *  - массив → длина;
 *  - { result: [...] }, { entries: [...] }, { patches: [...] }, { maps: [...] }
 *    и т.п. — длина первого массивоподобного топ-ключа;
 *  - { result: [ { entries: [...] } ] } (trade_stats) — сумма entries групп;
 *  - прочий объект — число собственных ключей (честная пометка не нужна:
 *    это приблизительный счётчик контроля, не семантика).
 */
export function countRecords(raw: unknown): number | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.length;
  if (typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  // trade_stats-форма: result — группы с entries
  if (Array.isArray(obj['result'])) {
    const groups = obj['result'] as Array<Record<string, unknown>>;
    const inner = groups.map((g) => (Array.isArray(g['entries']) ? (g['entries'] as unknown[]).length : 0));
    if (groups.some((g) => Array.isArray(g['entries']))) return inner.reduce((a, b) => a + b, 0);
    return groups.length;
  }
  for (const key of ['entries', 'patches', 'maps', 'mods', 'groups', 'terms', 'nodes', 'skills', 'supports']) {
    if (Array.isArray(obj[key])) return (obj[key] as unknown[]).length;
  }
  if (Array.isArray(obj['data'])) return (obj['data'] as unknown[]).length;
  return Object.keys(obj).length;
}

/** Стабильный отпечаток JSON-контента (без crypto-зависимости — cyrb53, паттерн §cachedPostJson). */
function fingerprint(s: string): string {
  // cyrb53: быстрый, стабильный, кросс-платформенный хэш
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const v = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return v.toString(16).padStart(13, '0');
}

/** Извлечь дату мета-поля верхнего уровня (первое строковое поле вида даты). */
function metaDateOf(raw: unknown): string | null {
  if (raw == null || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  for (const key of ['_meta', 'metadata']) {
    const m = obj[key];
    if (m != null && typeof m === 'object') {
      const mo = m as Record<string, unknown>;
      for (const dk of Object.keys(mo)) {
        if (/date|_at|at$|generated|fetched/i.test(dk) && typeof mo[dk] === 'string') {
          return mo[dk] as string;
        }
      }
    }
  }
  for (const dk of Object.keys(obj)) {
    if (/^(scraped_at|generated_at|as_of)$/i.test(dk) && typeof obj[dk] === 'string') return obj[dk] as string;
  }
  return null;
}

/**
 * Снапшот датасета из уже прочитанного JSON (объект) или из строки-файла.
 * null-сырьё → снапшот null (файла нет / не парсится).
 */
export function snapshotDataset(rawOrJson: unknown, jsonString?: string): DatasetSnapshot | null {
  let raw: unknown;
  let s: string;
  if (jsonString != null) {
    s = jsonString;
    try {
      raw = JSON.parse(jsonString);
    } catch {
      try {
        raw = JSON.parse((jsonString as string).replace(/^\uFEFF/, ''));
      } catch {
        return null;
      }
    }
  } else if (rawOrJson == null) {
    return null;
  } else {
    raw = rawOrJson;
    s = JSON.stringify(raw);
  }
  return {
    records: countRecords(raw),
    chars: s.length,
    fingerprint: fingerprint(s),
    metaDate: metaDateOf(raw),
  };
}

/** Сравнение до/после (снапшоты из snapshotDataset; null = файла нет). */
export function diffDatasetSnapshots(before: DatasetSnapshot | null, after: DatasetSnapshot | null): DatasetDiffReport {
  const recordsDelta =
    before?.records != null && after?.records != null ? after.records - before.records : null;
  return {
    before,
    after,
    recordsDelta,
    contentChanged: before?.fingerprint !== after?.fingerprint,
  };
}

/** Человекочитаемая строка отчёта по одному датасету (для refresh-data.mjs). */
export function formatDatasetDiff(rel: string, d: DatasetDiffReport): string {
  const rec = (s: DatasetSnapshot | null) =>
    s == null ? 'нет файла' : `${s.records ?? '?'} запис. (${s.chars} симв.)`;
  const delta =
    d.recordsDelta == null ? '' : d.recordsDelta > 0 ? ` +${d.recordsDelta}` : d.recordsDelta < 0 ? ` ${d.recordsDelta}` : ' без изм. числа';
  const verdict = !d.after
    ? '⚠ ФАЙЛ ИСЧЕЗ после refresh'
    : !d.before
      ? 'новый файл'
      : d.contentChanged
        ? `контент ИЗМЕНЁН${delta}`
        : 'контент не изменился';
  const dates = `${d.before?.metaDate ?? '—'} → ${d.after?.metaDate ?? '—'}`;
  return `${rel}: ${rec(d.before)} → ${rec(d.after)}; ${verdict}; мета-дата: ${dates}`;
}
