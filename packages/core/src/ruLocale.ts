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
 * Контракт тот же, что у overlay-словаря: ключ — normName (NFD, без
 * диакритики, ё→е, й→и, без апострофов, lowercase — так poe2db RU-слаги),
 * lookup: точный → strip-affix (суперлативы/exalted/prefix «Улучшенный …»).
 * Overlay использует сеть как ДОПОЛНЕНИЕ поверх этого офлайн-базиса.
 */

import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';

/** [ru, en, itemClass?] — формат строк в names.item / names.unique / names.gem. */
export type RuEnEntry = [ru: string, en: string, extra?: string];

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
type RuEnMaps = { items: Map<string, string>; uniques: Map<string, string>; gems: Map<string, string> };

let cache: (RuLocaleFile & { maps: RuEnMaps }) | null = null;

function load(): RuLocaleFile & { maps: RuEnMaps } {
  const empty: RuLocaleFile & { maps: RuEnMaps } = {
    maps: { items: new Map(), uniques: new Map(), gems: new Map() },
  };
  if (!HAS_DISK) return empty;
  if (cache) return cache;
  try {
    const raw = JSON.parse(fsMod!.readFileSync(localePath(), 'utf8')) as RuLocaleFile;
    const maps: RuEnMaps = { items: new Map(), uniques: new Map(), gems: new Map() };
    fill(maps.items, raw.names?.item);
    fill(maps.uniques, raw.names?.unique);
    fill(maps.gems, raw.names?.gem);
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
