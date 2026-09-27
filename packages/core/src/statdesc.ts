/**
 * Рендер игровых описаний статов по значению (stat_id → текст с числом).
 *
 * Источник: `data/game/stat_descriptions/*.json` — датамайн официальных
 * StatDescriptions (файлы уже поставляются в пакет, отдельной загрузки не
 * требуется). Формат записи:
 *   { stat_ids: string[], primary_stat_id, primary_template,
 *     variants: [{ range: "#", template: "{0:+d} to maximum Life",
 *                 handlers: ["negate", "1"] }] }
 *
 * Семантика (проверена по выборке всего файла):
 *  - `range`: "#" — любое значение; "N" — точное; "a|b" — диапазон ("#" —
 *    бесконечная граница); "!N" — «не равно N».
 *  - `handlers`: цепочка шагов `<fn>|<индекс-плейсхолдера>|...`, применяется к
 *    единственному значению; числовые элементы ("1") и "canonical_line" —
 *    маркеры. Неизвестная функция ⇒ вариант считается неподдержанным
 *    (fail-safe null, не неверный текст).
 *  - `template`: "{0}" (возможно со спеком ": +d"), "{}" синоним {0};
 *    "[Tag|Display]" → Display, "[Tag]" → Tag.
 *
 * В отличие от dataset.ts (там только поиск stat_id → шаблон), этот модуль
 * подставляет ЧИСЛО и выбирает ветку по диапазону: «increased»-вариант для
 * положительных и «reduced» с negate — для отрицательных.
 *
 * Назначение: оффлайн-фолбэк/верификация матчинга статов (trade2 каталог
 * недоступен), валидация community-пополнений learned-библиотеки (шаблон из
 * датамайна — эталон), точная интерпретация модов в estimate-слое.
 */

import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';

// ═══ Типы датасета ═══════════════════════════════════════════════════════════

export interface StatDescVariantData {
  range: string | null;
  template: string | null;
  handlers: string[];
}

export interface StatDescRecordData {
  statIds: string[];
  primaryStatId: string;
  primaryTemplate: string | null;
  variants: StatDescVariantData[];
}

interface StatDescFile {
  descriptions?: Array<{
    stat_ids?: string[];
    primary_stat_id?: string;
    primary_template?: string | null;
    variants?: Array<{
      range?: string | null;
      template?: string | null;
      handlers?: string[];
    }>;
  }>;
}

/** Те же файлы и в том же порядке приоритета, что в dataset.ts. */
const STAT_DESC_FILES = [
  'stat_descriptions/stat_descriptions.json',
  'stat_descriptions/skill_stat_descriptions.json',
  'stat_descriptions/gem_stat_descriptions.json',
  'stat_descriptions/passive_skill_stat_descriptions.json',
  'stat_descriptions/character_panel_stat_descriptions.json',
] as const;

// ═══ Конверсии значений (handlers) ═══════════════════════════════════════════

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const ifRequired = (v: number, divisor: number, round: (n: number) => number): number =>
  v % divisor === 0 ? v / divisor : round(v / divisor);

/** Поддержанные числовые конверсии GGG (snake_case, как в датамайне). */
const HANDLERS: Record<string, (v: number) => number> = {
  canonical_line: (v) => v, // маркер канонической строки, числа не меняет
  negate: (v) => -v,
  double: (v) => v * 2,
  negate_and_double: (v) => -(v * 2),
  times_twenty: (v) => v * 20,
  add_one: (v) => v + 1,
  divide_by_two_0dp: (v) => Math.round(v / 2),
  divide_by_three: (v) => Math.round(v / 3),
  divide_by_four: (v) => Math.round(v / 4),
  divide_by_five: (v) => Math.round(v / 5),
  divide_by_fifteen_0dp: (v) => Math.round(v / 15),
  divide_by_fifty: (v) => Math.round(v / 50),
  divide_by_twenty_then_double_0dp: (v) => Math.round(v / 20) * 2,
  divide_by_ten_0dp: (v) => Math.round(v / 10),
  divide_by_ten_1dp: (v) => round1(v / 10),
  divide_by_ten_1dp_if_required: (v) => ifRequired(v, 10, round1),
  divide_by_one_hundred: (v) => Math.round(v / 100),
  divide_by_one_hundred_1dp: (v) => round1(v / 100),
  divide_by_one_hundred_2dp: (v) => round2(v / 100),
  divide_by_one_hundred_2dp_if_required: (v) => ifRequired(v, 100, round2),
  divide_by_one_hundred_and_negate: (v) => -Math.round(v / 100),
  per_minute_to_per_second: (v) => ifRequired(v, 60, round1),
  per_minute_to_per_second_0dp: (v) => Math.round(v / 60),
  per_minute_to_per_second_1dp: (v) => round1(v / 60),
  per_minute_to_per_second_2dp: (v) => round2(v / 60),
  per_minute_to_per_second_1dp_if_required: (v) => ifRequired(v, 60, round1),
  per_minute_to_per_second_2dp_if_required: (v) => ifRequired(v, 60, round2),
  milliseconds_to_seconds: (v) => Math.round(v / 1000),
  milliseconds_to_seconds_0dp: (v) => Math.round(v / 1000),
  milliseconds_to_seconds_1dp: (v) => round1(v / 1000),
  milliseconds_to_seconds_2dp: (v) => round2(v / 1000),
  milliseconds_to_seconds_2dp_if_required: (v) => ifRequired(v, 1000, round2),
  deciseconds_to_seconds: (v) => round1(v / 10),
};

/** Применить цепочку handlers к значению. null — неизвестная функция
 *  (вариант не поддержан, честный отказ вместо неверного числа). */
export function applyStatHandlers(handlers: string[], value: number): number | null {
  let v = value;
  for (const step of handlers) {
    if (/^\d+$/.test(step)) continue; // индекс плейсхолдера, не функция
    const fn = HANDLERS[step];
    if (!fn) return null;
    v = fn(v);
  }
  return v;
}

/** Список встреченных в датасете функций, Unsupported конверсий нет? Для диагностики. */
export function statDescSupportedHandlers(): string[] {
  return Object.keys(HANDLERS);
}

// ═══ Диапазоны ("#" | "N" | "a|b" | "!N") ═════════════════════════════════════

export function statRangeMatches(range: string | null, value: number): boolean {
  if (!range) return true;
  const r = range.trim();
  if (r === '#' || r === '') return true;
  if (r.startsWith('!')) return value !== parseInt(r.slice(1), 10);
  if (!r.includes('|')) return value === parseInt(r, 10);
  const [minRaw, maxRaw] = r.split('|', 2);
  const min = minRaw === '#' || minRaw === '' ? Number.NEGATIVE_INFINITY : parseInt(minRaw!, 10);
  const max = maxRaw === '#' || maxRaw === undefined || maxRaw === '' ? Number.POSITIVE_INFINITY : parseInt(maxRaw, 10);
  return value >= min && value <= max;
}

// ═══ Шаблоны: подстановка числа и теги ════════════════════════════════════════

/** Вызов {N:spec}: "+d" добавляет знак плюса положительным числам. */
function formatStatNumber(n: number, spec: string): string {
  if (spec.includes('+') && n > 0) return `+${n}`;
  return String(n);
}

/** "[Tag|Display]" → Display; "[Tag]" → Tag. */
export function resolveStatTags(text: string): string {
  return text.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]|]+)\]/g, '$1');
}

/** Подставить value во все плейсхолдеры шаблона ({0}, {0:+d}, {}). */
function renderTemplate(template: string, value: number): string {
  return template.replace(/\{(\d*)(?::([^}]*))?\}/g, (_, _idx: string, spec = '') =>
    formatStatNumber(value, spec),
  );
}

// ═══ Индекс: stat_id → запись с вариантами ════════════════════════════════════

let indexCache: Map<string, StatDescRecordData> | null = null;

function dataDir(): string {
  return pathMod!.join(
    pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)),
    '..',
    'data',
    'game',
  );
}

function buildRenderIndex(): Map<string, StatDescRecordData> {
  const map = new Map<string, StatDescRecordData>();
  if (!HAS_DISK) return map;
  for (const file of STAT_DESC_FILES) {
    let raw: StatDescFile;
    try {
      raw = JSON.parse(fsMod!.readFileSync(pathMod!.join(dataDir(), file), 'utf8')) as StatDescFile;
    } catch {
      continue; // файла нет/битый — индекс строится из остальных
    }
    for (const d of raw.descriptions ?? []) {
      const ids = d.stat_ids ?? [];
      if (!ids.length) continue;
      const record: StatDescRecordData = {
        statIds: ids,
        primaryStatId: d.primary_stat_id ?? ids[0]!,
        primaryTemplate: d.primary_template ?? null,
        variants: (d.variants ?? [])
          .filter((v) => typeof v.template === 'string' && v.template.length > 0)
          .map((v) => ({
            range: v.range ?? null,
            template: v.template!,
            handlers: v.handlers ?? [],
          })),
      };
      for (const id of ids) if (!map.has(id)) map.set(id, record);
    }
  }
  return map;
}

function getIndex(): Map<string, StatDescRecordData> {
  if (!indexCache) indexCache = buildRenderIndex();
  return indexCache;
}

/** Запись описаний статов по внутреннему stat_id ("base_maximum_life"). */
export function getStatDescRecord(statId: string): StatDescRecordData | null {
  return getIndex().get(statId) ?? null;
}

/** Сколько stat_id покрывает индекс (диагностика/само-отчёт). */
export function statDescRenderInfo(): { statIds: number; unsupportedHandlerChains: number } {
  const idx = getIndex();
  const chains = new Set<string>();
  let unsupported = 0;
  for (const rec of idx.values()) {
    for (const v of rec.variants) {
      const key = v.handlers.join('|');
      if (chains.has(key)) continue;
      chains.add(key);
      if (applyStatHandlers(v.handlers, 1) === null) unsupported++;
    }
  }
  return { statIds: idx.size, unsupportedHandlerChains: unsupported };
}

// ═══ Нормализация шаблонов (матчинг текст ↔ шаблон) ═══════════════════════════

/**
 * Привести шаблон/текст к канонической сопоставимой форме: плейсхолдеры и
 * числа → "#", знак срезается ("+40" ≡ "40"), теги → display-текст, нижний
 * регистр, пробелы схлопнуты. Позволяет сверять trade-текст ("# to maximum
 * Life") с шаблоном датамайна ("{0:+d} to maximum Life").
 */
export function normalizeStatPattern(text: string): string {
  return text
    .replace(/\{\d*(?::[^}]*)?\}/g, '#') // {0}, {0:+d}, {} → '#'
    .replace(/\s+/g, ' ')
    .replace(/[+-]?\d+(?:\.\d+)?/g, '#') // числа (со знаком) → '#'
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2') // [Tag|Display] → Display
    .replace(/\[([^\]|]+)\]/g, '$1')
    .trim()
    .toLowerCase();
}

/** Найти stat_id по нормализованному текстовому паттерну
 *  ("#, к maximum life"). Возвращает первую (детерминированную) запись. */
export function findStatIdByPattern(
  pattern: string,
): { statId: string; template: string; record: StatDescRecordData } | null {
  const want = normalizeStatPattern(pattern);
  if (!want || !want.includes('#')) return null;
  for (const [id, rec] of getIndex()) {
    for (const v of rec.variants) {
      if (v.template && normalizeStatPattern(v.template) === want) {
        return { statId: id, template: v.template, record: rec };
      }
      if (rec.primaryTemplate && normalizeStatPattern(rec.primaryTemplate) === want) {
        return { statId: id, template: rec.primaryTemplate, record: rec };
      }
    }
  }
  return null;
}

// ═══ Главный API: stat_id + значение → готовый текст ══════════════════════════

export interface RenderStatTextOptions {
  /** Оставить [Tags] как есть (по умолчанию разрешаются в display-текст). */
  keepTags?: boolean;
  /** Выбрать конкретный вариант (для отладки/тестов). */
  variantIndex?: number;
}

/**
 * Отрендерить игровое описание стата: "base_maximum_life" + 40 →
 * "+40 to maximum Life". null — stat_id неизвестен, либо ни одна ветка
 * диапазона не покрывает значение, либо в ней неподдержанная конверсия.
 */
export function renderStatText(
  statId: string,
  value: number,
  opts: RenderStatTextOptions = {},
): string | null {
  const rec = getIndex().get(statId);
  if (!rec) return null;
  for (const v of rec.variants) {
    if (!v.template) continue;
    if (!statRangeMatches(v.range, value)) continue;
    const handled = applyStatHandlers(v.handlers, value);
    if (handled === null) continue; // неподдержанная конверсия — честный отказ
    const out = renderTemplate(v.template, handled);
    return opts.keepTags ? out : resolveStatTags(out);
  }
  return null;
}
