/**
 * Локальный каталог уникальных предметов PoE2 (приоритет №1 из DATA_SOURCES_RESEARCH).
 *
 * Источник: извлечено экстрактором `_extract_uniques_catalog.mjs` из
 * PathOfBuilding-PoE2 src/Data/Uniques/*.lua → data/game/uniques/uniques_catalog.json.
 * Позволяет по ПОЛОМУ имени уника (из PoB share-кода, без itemClass/baseType)
 * офлайн узнать базовый тип и категорию poe2scout — для одного точного запроса
 * в priceUnique вместо перебора ALL_UNIQUE_CATEGORIES.
 */

import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';

/** Категория уников poe2scout (значения как в trade.ts ScoutUniqueCategory). */
export type UniqueScoutCategory =
  | 'armour' | 'weapon' | 'accessory'
  | 'body' | 'helmets' | 'gloves' | 'boots' | 'shield' | 'quivers'
  | 'foci' | 'bows' | 'staves' | 'wands' | 'sceptres' | 'maces'
  | 'swords' | 'axes' | 'claws' | 'daggers' | 'flails' | 'spears'
  | 'crossbows' | 'rings' | 'amulets' | 'belts' | 'jewel' | 'flask';

/** Одна запись каталога уников. */
export interface UniqueCatalogEntry {
  /** Точное имя уника («Andvarius»). */
  name: string;
  /** Базовый тип («Gold Ring»). */
  baseType: string;
  /** Категория poe2scout (из слот-файла) или null для нестандартных слотов. */
  category: UniqueScoutCategory | null;
  /** Лига из блока (`League: X`), если указана, иначе null. */
  league: string | null;
  /** `Requires Level N`, если указан, иначе null. */
  requiresLevel: number | null;
  /** Исходный слот-файл («ring.lua»). */
  sourceFile: string;
  /** Тексты модов уника (raw из PoB2). */
  mods: string[];
}

let catalogCache: Map<string, UniqueCatalogEntry> | null = null;
let byNameListCache: UniqueCatalogEntry[] | null = null;

function dataDir(): string {
  return pathMod!.join(pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)), '..', 'data', 'game');
}

interface CatalogShape {
  uniques?: Record<string, UniqueCatalogEntry>;
}

/** Загрузить каталог (лениво, кэшируется). В браузере недоступен (HAS_DISK=false). */
function loadCatalog(): Map<string, UniqueCatalogEntry> {
  if (catalogCache) return catalogCache;
  if (!HAS_DISK) throw new Error('Офлайн-каталог уников недоступен в браузере');
  const raw = JSON.parse(
    fsMod!.readFileSync(pathMod!.join(dataDir(), 'uniques', 'uniques_catalog.json'), 'utf8'),
  ) as CatalogShape;
  catalogCache = new Map();
  for (const [key, e] of Object.entries(raw.uniques ?? {})) {
    if (e && e.name) catalogCache.set(key, e);
  }
  return catalogCache;
}

/**
 * Точный поиск уника по имени (регистр не важен; кириллица/латиница не важна).
 * Возвращает запись каталога или undefined.
 */
export function getUniqueByName(name: string): UniqueCatalogEntry | undefined {
  const q = (name ?? '').trim().toLowerCase();
  if (!q) return undefined;
  return loadCatalog().get(q);
}

/** Все записи каталога (для перебора/статистики). */
export function getUniqueCatalogEntries(): UniqueCatalogEntry[] {
  if (!byNameListCache) byNameListCache = [...loadCatalog().values()];
  return byNameListCache;
}

/** Поиск по подстроке имени (для подсказок/автодополнения), limit по умолчанию 10. */
export function searchUniqueNames(query: string, limit = 10): UniqueCatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return getUniqueCatalogEntries()
    .filter((u) => u.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.length - b.name.length)
    .slice(0, limit);
}

/**
 * Резолв категории poe2scout для уника по базовому типу/имени. Возвращает null,
 * если категория неизвестна (тогда priceUnique перебирает категории как раньше).
 */
export function scountCategoryForUnique(name: string, baseType: string | null): UniqueScoutCategory | null {
  // Сначала точное имя уника → категория из каталога (надёжнее всего).
  const byName = name ? getUniqueByName(name) : undefined;
  if (byName?.category) return byName.category;
  // Иначе по базовому типу.
  if (baseType) {
    const cat = resolveBaseTypeCategory(baseType);
    if (cat) return cat;
  }
  return null;
}

/** Внутренний маппинг regex по базовому типу → категория (как BASE_CATEGORY_TABLE в trade.ts). */
const BASE_CATEGORY_TABLE: Array<[RegExp, UniqueScoutCategory]> = [
  [/crossbow/i, 'crossbows'],
  [/quarterstaff/i, 'spears'],
  [/polearm|spear/i, 'spears'],
  [/flail/i, 'flails'],
  [/dagger/i, 'daggers'],
  [/claw/i, 'claws'],
  [/hatchet|axe/i, 'axes'],
  [/sword/i, 'swords'],
  [/maul|mace/i, 'maces'],
  [/sceptre/i, 'sceptres'],
  [/wand/i, 'wands'],
  [/warstaff|staff/i, 'staves'],
  [/bow/i, 'bows'],
  [/shield|buckler/i, 'shield'],
  [/quiver/i, 'quivers'],
  [/focus/i, 'foci'],
  [/helmet|helm|hood|mask|cap|visor|crown|circlet|coif|headguard/i, 'helmets'],
  [/glove|mitt/i, 'gloves'],
  [/boot|greave|tread/i, 'boots'],
  [/ring/i, 'rings'],
  [/amulet|locket|medallion|necklace|talisman/i, 'amulets'],
  [/belt/i, 'belts'],
  [/jewel|jewelry/i, 'jewel'],
  [/flask/i, 'flask'],
  [/body|chest|mail|armou?r|vest|coat|jacket|robe/i, 'body'],
];

/** Категория poe2scout по базовому типу (эвристика regex), null если не вывести. */
export function resolveBaseTypeCategory(baseType: string): UniqueScoutCategory | null {
  const b = (baseType ?? '').trim();
  if (!b) return null;
  for (const [re, cat] of BASE_CATEGORY_TABLE) {
    if (re.test(b)) return cat;
  }
  return null;
}