/**
 * Свежесть офлайн-датасетов (№245, Этап 1 «источники + автонововление данных»).
 *
 * Назначение: каждый data-файл в packages/core/data/game/, у которого есть
 * метка даты (_meta / metadata / scraped_at / generated_at), проходит признак
 * свежести:
 *  - откуда файл (sourceId) и его kind/update-классификация (sources.ts);
 *  - fetchedAt/дата из меты, возраст в днях;
 *  - schema_version/_meta.rev если есть;
 *  - stale-флаг по правилам №245: auto — старше 30 дн ИЛИ старше известного
 *    патча; manual — старше 90 дн.
 *
 * Отсутствие меты — НЕ ошибка: пометка «нет меты» (честность №222/№236 —
 * не выдумываем даты и не падаем).
 *
 * Вывод потребляет MCP-тул poe2_data_freshness (таблица per-dataset, №208);
 * реестр дублировать в refresh-data.mjs НЕ нужно — паритет см. scripts/.
 */

import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';
import type { SourceKind, SourceUpdate } from './sources.js';
import { sourceStaleness } from './sources.js';
import { knownPatchAtMs as defaultKnownPatchAtMs } from './patches.js';

/** Спецификация свежести одного датасета. */
export interface FreshnessSpec {
  /** Путь от data/game (например 'maps/maps.json'). */
  rel: string;
  /** Источник: id из реестра sources.ts либо честная локальная метка. */
  sourceId: string;
  /** Происхождение данных (№245). */
  kind: SourceKind;
  /** auto — скрипты освежают; manual — куратор (№245). */
  update: SourceUpdate;
  /** Путь к дате получения внутри JSON (например ['_meta','fetchedAt']). */
  datePath: string[];
  /** Путь к schema_version/_meta.rev если есть (для вывода). */
  schemaPath?: string[];
}

/**
 * Реестр свежести: файлы с известными метами дат.
 * Она же — источник строк таблицы poe2_data_freshness (бывш. №208).
 */
export const FRESHNESS_DATASETS: FreshnessSpec[] = [
  {
    rel: 'trade/trade_stats.json',
    sourceId: 'trade2',
    kind: 'official',
    update: 'auto',
    datePath: ['_meta', 'fetchedAt'],
  },
  {
    rel: 'skill_gems/recommended_supports.json',
    sourceId: 'poe2db', // scraped: собрано с poe2db в №222 (scraped_at)
    kind: 'datamined',
    update: 'auto',
    datePath: ['scraped_at'],
  },
  {
    rel: 'skill_gems/gem_colors.json',
    sourceId: 'hivemind', // генератор из локальных игровых данных (generated_at)
    kind: 'datamined',
    update: 'auto',
    datePath: ['generated_at'],
  },
  {
    rel: 'build_planner/map.json',
    sourceId: 'pob2', // PoB2-клон + сверка с игрой (metadata.extraction_date)
    kind: 'datamined',
    update: 'auto',
    datePath: ['metadata', 'extraction_date'],
  },
  {
    rel: 'passive_tree/layout.json',
    sourceId: 'official-ggg-export', // официальный экспорт GGG (metadata.generated_at)
    kind: 'official',
    update: 'auto',
    datePath: ['metadata', 'generated_at'],
  },
  {
    rel: 'hideout/decor.json',
    sourceId: 'hivemind', // POH public downloads + нативные экспорты (№200)
    kind: 'community',
    update: 'manual',
    datePath: ['_meta', 'generated'],
  },
  {
    rel: 'support_gems/support_gems.json',
    sourceId: 'hivemind', // hivemind-poe2-mcp, извлечение из .datc64
    kind: 'datamined',
    update: 'auto',
    datePath: ['metadata', 'extraction_date'],
  },
  {
    // №234/№235: карты + waystone-моды из локального клона PoB2 (_meta.fetched, git_rev)
    rel: 'maps/maps.json',
    sourceId: 'pob2',
    kind: 'datamined',
    update: 'auto',
    datePath: ['_meta', 'fetched'],
    schemaPath: ['_meta', 'git_rev'],
  },
  {
    rel: 'maps/waystone_mods.json',
    sourceId: 'pob2',
    kind: 'datamined',
    update: 'auto',
    datePath: ['_meta', 'fetched'],
    schemaPath: ['_meta', 'git_rev'],
  },
];

/** Результат свежести одного датасета. */
export interface DatasetFreshness {
  rel: string;
  sourceId: string;
  kind: SourceKind;
  update: SourceUpdate;
  /** ISO-строка даты из меты; null — меты нет (честная пометка, не выдумка). */
  fetchedAt: string | null;
  /** Возраст в целых днях; null — нет даты. */
  ageDays: number | null;
  /** Порог протухания (30 auto / 90 manual). */
  thresholdDays: number;
  /** Протух по правилам №245. */
  stale: boolean;
  /** Причина stale (null если свежий). */
  staleReason: string | null;
  /** schema_version/_meta.rev если есть, иначе null. */
  schemaVersion: string | null;
  /** Честная пометка («нет меты», «не читается» и т.п.). */
  note: string | null;
}

function dig(raw: unknown, path: string[]): unknown {
  let cur: unknown = raw;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/**
 * Свежесть одного датасета из уже разобранного JSON (чистая функция —
 * тестируется без диска). Мета отсутствует → fetchedAt=null, note='нет меты'.
 *
 * №248 (Этап 4): knownPatchAt по умолчанию — дата последнего подтверждённого
 * патча из data/game/patches.json (core.patches.knownPatchAtMs). Явный
 * параметр ПЕРЕОПРЕДЕЛЯЕТ дефолт (null — отключить правило «старше патча»).
 */
export function datasetFreshnessFromRaw(
  spec: FreshnessSpec,
  raw: unknown,
  nowMs: number = Date.now(),
  knownPatchAtMsArg?: number | null,
): DatasetFreshness {
  const patchAt =
    knownPatchAtMsArg === null ? undefined : knownPatchAtMsArg ?? defaultKnownPatchAtMs() ?? undefined;
  const dateRaw = dig(raw, spec.datePath);
  const schemaRaw = spec.schemaPath ? dig(raw, spec.schemaPath) : undefined;
  const schemaVersion =
    schemaRaw == null ? null : typeof schemaRaw === 'string' || typeof schemaRaw === 'number' ? String(schemaRaw) : null;
  if (typeof dateRaw !== 'string' || !Number.isFinite(Date.parse(dateRaw))) {
    return {
      rel: spec.rel,
      sourceId: spec.sourceId,
      kind: spec.kind,
      update: spec.update,
      fetchedAt: null,
      ageDays: null,
      thresholdDays: spec.update === 'auto' ? 30 : 90,
      stale: false,
      staleReason: null,
      schemaVersion,
      note: 'нет меты — дата получения неизвестна',
    };
  }
  const fetchedAtMs = Date.parse(dateRaw);
  const st = sourceStaleness({
    update: spec.update,
    fetchedAtMs,
    nowMs,
    knownPatchAtMs: patchAt,
  });
  return {
    rel: spec.rel,
    sourceId: spec.sourceId,
    kind: spec.kind,
    update: spec.update,
    fetchedAt: dateRaw,
    ageDays: Number.isFinite(st.ageDays) ? st.ageDays : null,
    thresholdDays: st.thresholdDays,
    stale: st.stale,
    staleReason: st.staleReason,
    schemaVersion,
    note: Number.isFinite(fetchedAtMs) ? null : 'дата в мете не парсится',
  };
}

/** Datadir только под Node (паритет с dataset.ts). */
function dataDir(): string {
  return pathMod!.join(pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)), '..', 'data', 'game');
}

/**
 * Свежесть всех датасетов реестра (читает packages/core/data/game).
 * В браузере (HAS_DISK=false) возвращает записи с пометкой — не падает.
 * Ошибки чтения отдельного файла — честная пометка «не читается», остальные идут дальше.
 * №248: knownPatchAt по умолчанию — из patches.json (см. datasetFreshnessFromRaw).
 */
export function datasetFreshnessList(nowMs: number = Date.now(), knownPatchAtMsArg?: number | null): DatasetFreshness[] {
  return FRESHNESS_DATASETS.map((spec) => {
    let raw: unknown;
    try {
      raw = JSON.parse(fsMod!.readFileSync(pathMod!.join(dataDir(), spec.rel), 'utf8'));
    } catch {
      return {
        rel: spec.rel,
        sourceId: spec.sourceId,
        kind: spec.kind,
        update: spec.update,
        fetchedAt: null,
        ageDays: null,
        thresholdDays: spec.update === 'auto' ? 30 : 90,
        stale: false,
        staleReason: null,
        schemaVersion: null,
        note: HAS_DISK ? 'не читается (файл отсутствует/битый)' : 'датасеты недоступны в браузере',
      } satisfies DatasetFreshness;
    }
    return datasetFreshnessFromRaw(spec, raw, nowMs, knownPatchAtMsArg);
  });
}
