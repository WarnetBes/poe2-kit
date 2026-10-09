/**
 * Реестр известных патчей PoE2 (Этап 4, №248) — офлайн-справочник.
 *
 * Зачем: stale-правило №245 «auto-данные, полученные ДО известного патча,
 * считаются протухшими» нуждается в дате патча как ДАННЫХ, а не в парсинге
 * GGG-страниц. Источник — data/game/patches.json (кураторский офлайн-реестр,
 * заполненный из дайджестов ресёрча 09.10.2026); обновляет его куратор при
 * новом патче — сознательно БЕЗ живого парсинга на этом этапе.
 *
 * Дисциплина честности (№222/№239/№247): записи с unverified=true (дата не
 * подтверждена первоисточником / источники расходятся) в knownPatchAt НЕ
 * попадают — датой отсчёта берётся самый свежий ПОДТВЕРЖДЁННЫЙ патч.
 *
 * Загрузка — статический JSON-импорт `with {type:'json'}` (паттерн №247
 * simulacrum_facts): данные inline-ятся в сборку и доступны в браузере и
 * в MCP одинаково; файл — только данные, никогда не исполняется.
 */

import patchesFile from '../data/game/patches.json' with { type: 'json' };

/** Одна запись реестра патчей (см. data/game/patches.json). */
export interface KnownPatch {
  /** Версия патча, как в клиенте (например '0.5.5e'). */
  version: string;
  /** Дата патча (ISO, YYYY-MM-DD). */
  date: string;
  /** Название патча/лиги, если есть. */
  title?: string;
  /** Патч, запустивший лигу. */
  league?: boolean;
  /** Хотфикс (не самостоятельный патч). */
  hotfix?: boolean;
  /** Дата не подтверждена / источники расходятся — в knownPatchAt НЕ попадает. */
  unverified?: string;
  /** Точность даты (для unverified-записей). */
  date_accuracy?: string;
  /** Источник(и) даты. */
  source?: string;
}

export interface PatchesFile {
  _meta?: { patch?: string; as_of?: string; sources?: string[]; note?: string };
  patches?: KnownPatch[];
}

/** Разобранная запись: ISO-строки даты + ms (для сравнения). */
export interface ResolvedPatch extends KnownPatch {
  /** Date.parse(date); NaN — если дата не парсится (запись дефектна). */
  dateMs: number;
}

function normalize(raw: unknown): PatchesFile {
  if (!raw || typeof raw !== 'object') return {};
  const f = raw as PatchesFile;
  return {
    _meta: f._meta,
    patches: (Array.isArray(f.patches) ? f.patches : []).filter(
      (p): p is KnownPatch =>
        p != null && typeof p.version === 'string' && p.version.trim().length > 0 && typeof p.date === 'string',
    ),
  };
}

/**
 * Нормализация произвольного JSON в список патчей (чистая функция —
 * тесты гоняют битые/пустые payload'ы без подмены живого импорта).
 * Даты, не парсящиеся Date.parse, отфильтровываются честно (не клевещем).
 */
export function parseKnownPatches(raw: unknown): ResolvedPatch[] {
  const { patches = [] } = normalize(raw);
  const out: ResolvedPatch[] = [];
  for (const p of patches!) {
    const ms = Date.parse(p.date);
    if (!Number.isFinite(ms)) continue; // дефектная дата — не участвует
    out.push({ ...p, dateMs: ms });
  }
  // стабильный порядок: по дате (свежие — позже), внутри дня — по версии файла
  return out.sort((a, b) => a.dateMs - b.dateMs);
}

/** Все известные патчи из data-файла (в хронологическом порядке). */
export function listKnownPatches(): ResolvedPatch[] {
  return parseKnownPatches(patchesFile);
}

/** Патч по точной версии ('0.5.5e'); null — не найден. */
export function findKnownPatch(version: string): ResolvedPatch | null {
  const v = version.trim();
  return listKnownPatches().find((p) => p.version === v) ?? null;
}

/**
 * Дата последнего ПОДТВЕРЖДЁННОГО патча (ms) — канонический knownPatchAt
 * для freshness-логики. unverified-записи пропускаются (дисциплина честности:
 * приблизительная дата патча не должна ложно «протухлять» датасеты).
 * null — подтверждённых патчей нет (вырожденный реестр).
 */
export function knownPatchAtMs(): number | null {
  const verified = listKnownPatches().filter((p) => p.unverified == null);
  if (!verified.length) return null;
  return verified[verified.length - 1]!.dateMs;
}

/**
 * Последний подтверждённый патч целиком (для вывода в отчётах/тулах).
 * null — подтверждённых записей нет.
 */
export function latestKnownPatch(): ResolvedPatch | null {
  const verified = listKnownPatches().filter((p) => p.unverified == null);
  return verified.length ? verified[verified.length - 1]! : null;
}

/** Мета data-файла (для диагностики/само-отчёта). */
export function knownPatchesMeta(): {
  patch: string | null;
  asOf: string | null;
  total: number;
  unverified: number;
} {
  const all = listKnownPatches();
  return {
    patch: patchesFile._meta?.patch ?? null,
    asOf: patchesFile._meta?.as_of ?? null,
    total: all.length,
    unverified: all.filter((p) => p.unverified != null).length,
  };
}
