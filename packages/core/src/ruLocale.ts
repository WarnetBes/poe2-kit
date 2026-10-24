/**
 * Офлайн RU→EN-словарь имён предметов/уникалей/гемов (мастер-план §5).
 *
 * Зачем: RU-клиент Ctrl+C отдаёт русские имена/базы; trade2/poe2scout принимают
 * только EN. До сих пор overlay строил словарь скрейпом poe2db в рантайме
 * (~2 мин, нужна сеть, юзер-кэш). Таблица Exiled Exchange 2 (MIT, поле
 * `source` в JSON) даёт полный офлайн-фундамент: 2287 предметов, 766 уникалей,
 * 861 гем — дата сборки 2026-10-08, поле `built`.
 *
 * Атрибуция: NOTICE.md в корне репо. Файл — только данные (JSON), читается
 * через JSON.parse, никогда не исполняется (см. SECURITY.md).
 *
 * Additive-слой 2026-10-24 (поле `merged`): RU-базы и metadataId/tradeCat из
 * Sidekick (Sidekick-Poe/Sidekick, MIT): +929 строк names.item, extras в
 * хвосте строк (RuEnExtras). Существующие записи не переопределялись.
 *
 * Контракт тот же, что у overlay-словаря: ключ — normName (NFD, без
 * диакритики, ё→е, й→и, без апострофов, lowercase — так poe2db RU-слаги),
 * lookup: точный → strip-affix (суперлативы/exalted/prefix «Улучшенный …»).
 * Overlay использует сеть как ДОПОЛНЕНИЕ поверх этого офлайн-базиса.
 */

import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';

/**
 * [ru, en, itemClass?, extras?] — формат строк в names.item / names.unique /
 * names.gem. extras (индекс 3) — донор Sidekick (MIT), только где был:
 * metadataId — первый Metadata/Items/* из baseItemIds; tradeCat — ru-файл
 * донора локализован, поэтому tradeItems[].type там = само RU-имя, несём
 * только категорию (weapon/gem/currency/jewel/...).
 */
export interface RuEnExtras {
  metadataId?: string;
  tradeCat?: string;
}
export type RuEnEntry = [ru: string, en: string, extra?: string, extras?: RuEnExtras];

interface RuLocaleFile {
  lang?: string;
  source?: string;
  built?: string;
  names?: { item?: RuEnEntry[]; unique?: RuEnEntry[]; gem?: RuEnEntry[] };
}

function localePath(): string {
  return pathMod!.join(
    pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)),
    '..',
    'data',
    'game',
    'i18n',
    'items_ru.json',
  );
}

/** Нормализация ключа — идентична overlay normName (обе стороны сворачиваем одинаково): диакритика, ё→е, й→и, апострофы, пробелы, lowercase. */
export function normRuEnKey(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ё/g, 'е')
    .replace(/й/g, 'и')
    .replace(/[''`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ~/.local… / browser — файл просто недоступен (HAS_DISK=false): карты пустые.
type RuEnMaps = {
  items: Map<string, string>;
  uniques: Map<string, string>;
  gems: Map<string, string>;
  /** normKey → Sidekick-extras (metadataId/tradeCat) одной строкой на все секции. */
  extras: Map<string, RuEnExtras>;
};

let cache: (RuLocaleFile & { maps: RuEnMaps }) | null = null;

function load(): RuLocaleFile & { maps: RuEnMaps } {
  const empty: RuLocaleFile & { maps: RuEnMaps } = {
    maps: { items: new Map(), uniques: new Map(), gems: new Map(), extras: new Map() },
  };
  if (!HAS_DISK) return empty;
  if (cache) return cache;
  try {
    const raw = JSON.parse(fsMod!.readFileSync(localePath(), 'utf8')) as RuLocaleFile;
    const maps: RuEnMaps = {
      items: new Map(),
      uniques: new Map(),
      gems: new Map(),
      extras: new Map(),
    };
    fill(maps.items, raw.names?.item);
    fill(maps.uniques, raw.names?.unique);
    fill(maps.gems, raw.names?.gem);
    for (const rows of [raw.names?.item, raw.names?.unique, raw.names?.gem]) {
      for (const row of rows ?? []) {
        if (!Array.isArray(row) || row.length < 2) continue;
        const ex = row[3];
        if (!ex || typeof ex !== 'object' || Array.isArray(ex)) continue;
        if (ex.metadataId == null && ex.tradeCat == null) continue;
        const key = normRuEnKey(row[0]);
        if (!key || maps.extras.has(key)) continue;
        maps.extras.set(key, { metadataId: ex.metadataId, tradeCat: ex.tradeCat });
      }
    }
    cache = { ...raw, maps };
    return cache;
  } catch {
    return empty;
  }
}

function fill(map: Map<string, string>, rows: RuEnEntry[] | undefined): void {
  for (const row of rows ?? []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const ru = String(row[0]);
    const en = String(row[1]);
    if (!ru.trim() || !en.trim() || ru === en) continue;
    map.set(normRuEnKey(ru), en);
  }
}

/** Метаданные датасета (source/built/размеры) — для логов и тулов. */
export function ruEnLocaleMeta(): { source: string | undefined; built: string | undefined; items: number; uniques: number; gems: number } {
  const { maps, ...raw } = load();
  return { source: raw.source, built: raw.built, items: maps.items.size, uniques: maps.uniques.size, gems: maps.gems.size };
}

/**
 * RU-имя → EN-канон. Порядок: уники (точные имена артефактов) → гемы → базы.
 * Точный промах → strip-affix: «Улучшенный/Exalted/Superior/…»-префикс убирается
 * (второй lookup). Промах → '' (НЕ identity: вызывающий сам решает фолбэк).
 */
export function ruToEnName(name: string | null | undefined): string {
  const key = normRuEnKey(name);
  if (!key) return '';
  const m = load().maps;
  const direct = m.uniques.get(key) ?? m.gems.get(key) ?? m.items.get(key);
  if (direct) return direct;
  const stripped = key.replace(/^(улучшенн(ый|ая|ое) |exalted |superior )/, '');
  if (stripped !== key) {
    const byStrip = m.uniques.get(stripped) ?? m.gems.get(stripped) ?? m.items.get(stripped);
    if (byStrip) return byStrip;
  }
  return '';
}

/** Только базы (для baseType-резолва независимо от имени артефакта). */
export function ruToEnBase(baseType: string | null | undefined): string {
  const key = normRuEnKey(baseType);
  if (!key) return '';
  const m = load().maps;
  return m.items.get(key) ?? m.items.get(key.replace(/^(улучшенн(ый|ая|ое) |exalted |superior )/, '')) ?? '';
}

/**
 * Bulk-доступ для сидирования внешних словарей (overlay: ruEnBases/ruEnUniques).
 * Возвращает копию Map — изменения не влияют на кэш ядра.
 */
export function ruEnMap(
  kind: 'items' | 'uniques' | 'gems',
): ReadonlyMap<string, string> {
  return new Map(load().maps[kind]);
}

/**
 * Sidekick-extras (MIT-донор, additive-слой `merged`): metadataId — EN Metadata
 * ID базового предмета, tradeCat — trade-категория (weapon/gem/currency/...).
 * Есть не у всех строк; промах → undefined.
 */
export function ruEnExtras(name: string | null | undefined): RuEnExtras | undefined {
  const ex = load().maps.extras.get(normRuEnKey(name));
  return ex ? { ...ex } : undefined;
}

// ═══ RU-моды и классы (§5, RU mod-patterns) ═════════════════════════════════

/**
 * RU-строки модов → EN ref (датасет ExE2 stats.ndjson, MIT) и RU-значения
 * «Класс предмета:» → EN (xiletrade ItemClassTwo.json, MIT).
 *
 * Перевод не заменяет парсинг: ParsedItem.mods.text остаётся как в клире,
 * канонизация в EN происходит только на входе estimate (defense/verdict).
 * Классы наоборот канонизуются в parse — они учавствуют в сравнении
 * RU-кандидат vs EN-гиры билда (itemVerdict) и определении слота оружия.
 */

interface RuModEntry {
  ru: string;
  en: string;
  negate?: boolean;
}

interface RuModsData {
  _meta?: { source?: string; built?: string };
  mods: RuModEntry[];
}

interface RuClassesData {
  _meta?: { source?: string; built?: string };
  classes: [string, string][];
}

interface CompiledMatcher {
  re: RegExp;
  en: string;
  negate: boolean;
}

let modCache: { meta: RuModsData['_meta']; matchers: CompiledMatcher[] } | null = null;
let classCache: { meta: RuClassesData['_meta']; map: Map<string, string> } | null = null;

function i18nPath(file: string): string {
  return pathMod!.join(
    pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)),
    '..',
    'data',
    'game',
    'i18n',
    file,
  );
}

/**
 * RU-матчер → RegExp: '#' → знаковое число (за ним допустима скобка
 * диапазона "(40-54)" из poe2db/PoB-аннотаций), пробелы толерантны.
 */
function compileRuMatcher(ru: string): string {
  const NUM = '([+-]?\\d+(?:\\.\\d+)?)(?:\\s*\\(\\d+(?:\\.\\d+)?\\s*-\\s*\\d+(?:\\.\\d+)?\\))?';
  const escaped = ru
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  return '^' + escaped.split('#').join(NUM) + '\\s*$';
}

function loadMods(): { meta: RuModsData['_meta']; matchers: CompiledMatcher[] } {
  if (modCache) return modCache;
  const empty = { meta: undefined, matchers: [] as CompiledMatcher[] };
  if (!HAS_DISK) return (modCache = empty);
  try {
    const raw = JSON.parse(fsMod!.readFileSync(i18nPath('mods_ru.json'), 'utf8')) as RuModsData;
    const matchers: CompiledMatcher[] = (raw.mods ?? []).map((m) => ({
      re: new RegExp(compileRuMatcher(m.ru), 'i'),
      en: m.en,
      negate: m.negate === true,
    }));
    modCache = { meta: raw._meta, matchers };
    return modCache;
  } catch {
    return (modCache = empty);
  }
}

function loadClasses(): { meta: RuClassesData['_meta']; map: Map<string, string> } {
  if (classCache) return classCache;
  if (!HAS_DISK) return (classCache = { meta: undefined, map: new Map() });
  try {
    const raw = JSON.parse(fsMod!.readFileSync(i18nPath('item_classes_ru.json'), 'utf8')) as RuClassesData;
    const map = new Map<string, string>();
    for (const [ru, en] of raw.classes ?? []) {
      if (ru && en && ru !== en) map.set(ru.trim().toLowerCase(), en.trim());
    }
    classCache = { meta: raw._meta, map };
    return classCache;
  } catch {
    return (classCache = { meta: undefined, map: new Map() });
  }
}

const HAS_CYRILLIC = /[а-яё]/i;

/** Подставить числа матча в EN-шаблон ("#% to Fire Resistance" → "+28% to Fire Resistance"). */
function fillEnTemplate(en: string, m: RegExpExecArray, negate: boolean): string {
  let i = 1;
  let out = en.replace(/#/g, () => {
    const raw = m[i++];
    if (raw == null) return '#';
    let v = raw;
    if (negate && !/^[+-]/.test(v)) v = '-' + v;
    return v;
  });
  // Отрицательные ref-шаблоны донора ("#% reduced ...") с negate-матчером:
  // значение уже с минусом, ref без negate — знак оставляем числу как есть.
  if (!out.startsWith('+') && /^\d/.test(out)) out = '+' + out;
  return out;
}

/**
 * RU-строка мода → EN-канон (или null, если строка не RU / не из таблицы).
 * Сначала точный матч, затем повтор без хвостового маркера "(...)" вроде
 * "(crafted)" — таблица их не содержит.
 */
export function translateRuModLine(line: string): string | null {
  if (!line || !HAS_CYRILLIC.test(line)) return null;
  const trimmed = line.trim();
  const matchers = loadMods().matchers;
  for (const m of matchers) {
    const hit = m.re.exec(trimmed);
    if (hit) return fillEnTemplate(m.en, hit, m.negate);
  }
  const stripped = trimmed.replace(/\s*\([^()]*\)\s*$/, '');
  if (stripped && stripped !== trimmed) {
    for (const m of matchers) {
      const hit = m.re.exec(stripped);
      if (hit) return fillEnTemplate(m.en, hit, m.negate);
    }
  }
  return null;
}

/**
 * Массив строк модов RU→EN (точечно: непереведённое проходит как есть).
 * Точка инжекта — сбор модов в estimate: дальше вердикт/EHP-оси работают
 * на EN-regex'ах без изменений.
 */
export function translateRuMods(mods: string[]): string[] {
  return mods.map((t) => translateRuModLine(t) ?? t);
}

/** RU-значение «Класс предмета:» → EN-канон; иначе ''. */
export function ruToEnItemClass(itemClass: string | null | undefined): string {
  const key = String(itemClass ?? '').trim().toLowerCase();
  if (!key || !HAS_CYRILLIC.test(key)) return '';
  return loadClasses().map.get(key) ?? '';
}

/** Метаданные датасетов (для логов/тулов). */
export function ruModsMeta(): { mods: number; classes: number; source?: string; built?: string } {
  const mods = loadMods();
  const classes = loadClasses();
  return {
    mods: mods.matchers.length,
    classes: classes.map.size,
    source: mods.meta?.source,
    built: mods.meta?.built,
  };
}
