/**
 * Офлайн-датасеты PoE2 — прилагаются с ядром, работают БЕЗ сети.
 *
 * Источник данных: извлечено из игровых файлов сообществом
 * hivemind-poe2-mcp (данные практики Path of Exile 2, патч 0.5
 * «Return of the Ancients», ревизия 12 — см. data/game/version.json).
 * Файлы скопированы с разрешением; формат — факт игры, не код.
 *
 * Состав (packages/core/data/game/):
 *  - version.json            — версия данных (датасетное версионирование)
 *  - ascendancies/           — асценданси-классы (неиспользуемые отфильтрованы)
 *  - skill_gems/             — активные гемы: статы по уровням, cost, теги
 *  - passive_tree/           — дерево пассивок: 9605 узлов (имена, статы, ключевые)
 *  - baseline base_items.json — базовые предметы
 *  - stats.json              — внутренние stat_id
 */

import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';

/** Datadir только под Node (в браузере датасеты недоступны с диска). */
function dataDir(): string {
  return pathMod!.join(pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)), '..', 'data', 'game');
}

function loadJson<T>(rel: string): T {
  if (!HAS_DISK) throw new Error('Офлайн-датасеты недоступны в браузере: ' + rel);
  return JSON.parse(fsMod!.readFileSync(pathMod!.join(dataDir(), rel), 'utf8')) as T;
}

// ─── Версия данных ───────────────────────────────────────────────────────────

export interface DatasetVersion {
  patch_version: string;
  patch_name: string;
  data_revision: number;
  released_as: string;
  extracted_at: string;
}

let versionCache: DatasetVersion | null = null;

/** Версия офлайн-датасетов (патч + ревизия). */
export function getDatasetVersion(): DatasetVersion {
  if (!versionCache) {
    const raw = loadJson<DatasetVersion & Record<string, unknown>>('version.json');
    versionCache = {
      patch_version: raw.patch_version,
      patch_name: raw.patch_name,
      data_revision: raw.data_revision,
      released_as: raw.released_as,
      extracted_at: raw.extracted_at,
    };
  }
  return versionCache;
}

// ─── Проверка версии дерева билда (P0-2) ───────────────────────────────────

/** Итог сверки treeVersion билда с патчем датасета. */
export interface TreeVersionCheckReport {
  /** treeVersion из <Spec> PoB2 (как в экспорте: "0_3") или null, если не указана. */
  treeVersion: string | null;
  /** Патч датасета (version.json: "0.5"). */
  datasetPatch: string;
  /**
   * - 'current' — версия билда = патчу датасета;
   * - 'older' — билд собран на более старом дереве (узлы могли переехать);
   * - 'newer' — датасет старее билда (нужно обновить данные);
   * - 'unparseable' — формат не из treeVersionList (0_1..0_5);
   * - 'missing' — treeVersion в билде не указана.
   */
  status: 'current' | 'older' | 'newer' | 'unparseable' | 'missing';
  /** Короткая подпись статуса для вывода ("актуальна", "старее патча", …). */
  label: string;
  /** Готовая строка для человекочитаемых сводок (с предупреждением ⚠ при рассинхроне). */
  message: string;
}

/** "0_3"/"0.5" → {major,minor}; null, если не разобрать. */
function parseVersionPair(v: string): { major: number; minor: number } | null {
  const m = /^\s*(\d+)[_.](\d+)\s*$/.exec(v);
  if (!m) return null;
  return { major: parseInt(m[1]!, 10), minor: parseInt(m[2]!, 10) };
}

/**
 * Сверка версии дерева билда (treeVersion из <Spec> PoB2: list 0_1..0_5)
 * с патчем офлайн-датасета. Если билд собран на более старом дереве —
 * узлы могли переехать и имена/статы из датасета к нему неприменимы.
 */
export function checkTreeVersion(treeVersion: string | null | undefined): TreeVersionCheckReport {
  const { patch_version: datasetPatch, patch_name: patchName } = getDatasetVersion();
  const tv = (treeVersion ?? '').trim();
  if (!tv) {
    return {
      treeVersion: null,
      datasetPatch,
      status: 'missing',
      label: 'версия дерева не указана',
      message: 'В билде не указана версия дерева (treeVersion) — актуальность узлов не проверить, сверить в Path of Building.',
    };
  }
  const build = parseVersionPair(tv);
  const dataset = parseVersionPair(datasetPatch);
  if (!build || !dataset) {
    return {
      treeVersion: tv,
      datasetPatch,
      status: 'unparseable',
      label: 'версия дерева не распознана',
      message: `Версию дерева билда «${tv}» не удалось сопоставить с патчем ${datasetPatch} — сверить в Path of Building.`,
    };
  }
  const diff = build.major - dataset.major || build.minor - dataset.minor;
  if (diff === 0) {
    return {
      treeVersion: tv,
      datasetPatch,
      status: 'current',
      label: 'актуальна',
      message: `Версия дерева билда ${tv} актуальна для патча ${datasetPatch} (${patchName}).`,
    };
  }
  if (diff < 0) {
    return {
      treeVersion: tv,
      datasetPatch,
      status: 'older',
      label: 'старее патча',
      message: `⚠ билд собран на другой версии дерева: treeVersion ${tv} старее патча датасета ${datasetPatch} (${patchName}). Узлы могли переехать — перенести дерево в PoB2 на актуальную версию и заново экспортировать.`,
    };
  }
  return {
    treeVersion: tv,
    datasetPatch,
    status: 'newer',
    label: 'новее патча',
    message: `⚠ версия дерева билда ${tv} новее патча датасета ${datasetPatch} (${patchName}) — датасет устарел, обновить данные poe2-kit.`,
  };
}

// ─── Асценданси ─────────────────────────────────────────────────────────────

export interface AscendancyClass {
  id: string;
  displayName: string;
  baseClass: string;
}

let ascCache: AscendancyClass[] | null = null;

/** Все активные асценданси-классы PoE2. */
export function getAscendancies(): AscendancyClass[] {
  if (!ascCache) {
    const raw = loadJson<{
      ascendancies?: Array<{ id?: string; display_name?: string; base_class?: string; is_unused?: boolean }>;
    }>('ascendancies/ascendancies.json');
    ascCache = (raw.ascendancies ?? [])
      .filter((e) => e && !e.is_unused && e.display_name && e.base_class)
      .map((e) => ({ id: e.id ?? '', displayName: e.display_name!, baseClass: e.base_class! }))
      .sort((a, b) => a.baseClass.localeCompare(b.baseClass) || a.displayName.localeCompare(b.displayName));
  }
  return ascCache;
}

/** Все активные асценданси-классы PoE2. */

/** Асценданси для базового класса ('Monk', 'Warrior', ...). */
export function getAscendanciesByClass(baseClass: string): AscendancyClass[] {
  const wanted = baseClass.toLowerCase();
  return getAscendancies().filter((a) => a.baseClass.toLowerCase() === wanted);
}

// ─── Гемы ────────────────────────────────────────────────────────────────────

/**
 * Источник получения гема в PoE2 (P0 #5).
 *
 * Поскольку в офлайн-датасетах НЕТ пер-гем разметки «конкретный босс/квест»,
 * классификация — ЧЕСТНАЯ ЭВРИСТИКА по типу гема (теги skillTypes, флаг is_support),
 * а не выдуманные данные. Механика PoE2: гемы «разворачиваются» из uncut-гемов,
 * поэтому источник почти всегда uncut-гем того же типа.
 */
export interface GemSource {
  /** Машинный код типа источника. */
  kind: 'UncutSkillGem' | 'UncutSupportGem' | 'UncutSpiritGem';
  /** Человекочитаемое имя предмета-источника. */
  item: string;
  /** Характерный уровень «открытия» (для активных гемов — минимальный требуемый уровень), или null если неизвестен. */
  unlockLevel: number | null;
  /** Пояснение (эвристика, без выдуманных дроп-цифр). */
  note: string;
}

function activeGemSource(skillTypes: string[], unlockLevel: number | null): GemSource {
  const reserve = skillTypes.some((t) => t === 'Aura' || t === 'Herald');
  if (reserve) {
    return {
      kind: 'UncutSpiritGem',
      item: 'Uncut Spirit Gem',
      unlockLevel,
      note:
        'Резервация (аура/вестник): получается из Uncut Spirit Gem. Uncut уровня N открывает гем уровня N; в SSF выпадает дропом, а не покупается.',
    };
  }
  return {
    kind: 'UncutSkillGem',
    item: 'Uncut Skill Gem',
    unlockLevel,
    note:
      'Активный гем: получается из Uncut Skill Gem. Uncut уровня N открывает гем уровня N (требуемый уровень персонажа под уровень гема указан в деталях); в SSF выпадает дропом, а не покупается.',
  };
}

export interface SkillGem {
  id: string;
  name: string;
  baseTypeName: string;
  castTime: number;
  skillTypes: string[];
  /** Максимальный уровень гема (по числу levels). */
  maxLevel: number;
  /** Стоимость {Mana: n} на 1-м и последнем уровне. */
  firstLevelCost: Record<string, number> | null;
  lastLevelCost: Record<string, number> | null;
  /** Источник получения (P0 #5): uncut-гем того же типа + уровень открытия. */
  source?: GemSource;
}

interface RawGem {
  name?: string;
  baseTypeName?: string;
  castTime?: number;
  skillTypes?: string[];
  levels?: Array<{ cost?: Record<string, number>; levelRequirement?: number }>;
}

let gemsCache: SkillGem[] | null = null;

function rawGems(): Record<string, RawGem> {
  const raw = loadJson<{ skills?: Record<string, RawGem> }>('skill_gems/skill_gems_v2.json');
  return raw.skills ?? {};
}

/** Все активные гемы (может быть ~150; данные центурируются лениво). */
export function getSkillGems(): SkillGem[] {
  if (!gemsCache) {
    gemsCache = Object.entries(rawGems()).map(([id, g]) => {
      // Некоторые гемы (Cast on Melee Stun и т.п.) хранят levels как объект {lvl: {...}},
      // а не массив — нормализуем к массиву, сортируя по ключу-уровню.
      const rawLevels: unknown = g.levels ?? [];
      const levels = Array.isArray(rawLevels)
        ? (rawLevels as Array<{ cost?: Record<string, number>; levelRequirement?: number }>)
        : Object.entries(rawLevels as Record<string, { cost?: Record<string, number>; levelRequirement?: number }>)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([, lv]) => lv);
      const unlock =
        levels.find((l) => (l.levelRequirement ?? 0) > 0)?.levelRequirement ??
        levels[0]?.levelRequirement ??
        null;
      return {
        id,
        name: g.name ?? g.baseTypeName ?? id,
        baseTypeName: g.baseTypeName ?? '',
        castTime: g.castTime ?? 0,
        skillTypes: g.skillTypes ?? [],
        maxLevel: levels.length,
        firstLevelCost: levels[0]?.cost ?? null,
        lastLevelCost: levels[levels.length - 1]?.cost ?? null,
        source: activeGemSource(g.skillTypes ?? [], unlock),
      };
    });
    gemsCache.sort((a, b) => a.name.localeCompare(b.name));
  }
  return gemsCache;
}

/** Поиск гемов по подстроке имени (регистр не важен). */
export function searchSkillGems(query: string, limit = 5): SkillGem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = getSkillGems();
  const starts = all.filter((g) => g.name.toLowerCase().startsWith(q));
  const contains = all.filter((g) => !g.name.toLowerCase().startsWith(q) && g.name.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, limit);
}

/** Полная запись гема (с уровнями) по имени. */
export function getSkillGemDetails(query: string): (SkillGem & { levels: Array<{ cost: Record<string, number>; levelRequirement: number; baseMultiplier?: number }> }) | null {
  const raw = rawGems();
  const q = query.trim().toLowerCase();
  const hit =
    Object.entries(raw).find(([, g]) => (g.name ?? '').toLowerCase() === q) ??
    Object.entries(raw).find(([, g]) => (g.name ?? '').toLowerCase().includes(q));
  if (!hit) return null;
  const [id, g] = hit;
  const levels = (g.levels ?? []).map((l) => ({
    cost: l.cost ?? {},
    levelRequirement: (l as { levelRequirement?: number }).levelRequirement ?? 0,
    baseMultiplier: (l as { baseMultiplier?: number }).baseMultiplier,
  }));
  const unlock =
    levels.find((l) => l.levelRequirement > 0)?.levelRequirement ??
    levels[0]?.levelRequirement ??
    null;
  return {
    id,
    name: g.name ?? g.baseTypeName ?? id,
    baseTypeName: g.baseTypeName ?? '',
    castTime: g.castTime ?? 0,
    skillTypes: g.skillTypes ?? [],
    maxLevel: levels.length,
    firstLevelCost: levels[0]?.cost ?? null,
    lastLevelCost: levels[levels.length - 1]?.cost ?? null,
    levels,
    source: activeGemSource(g.skillTypes ?? [], unlock),
  };
}

// ─── Дерево пассивок ─────────────────────────────────────────────────────────

export interface PassiveNode {
  id: string;
  name: string;
  isKeystone: boolean;
  isNotable: boolean;
  ascendancy: string;
  stats: string[];
}

let treeCache: PassiveNode[] | null = null;

/** Все узлы дерева пассивок и асценданси (~9605). */
export function getPassiveTree(): PassiveNode[] {
  if (!treeCache) {
    const raw = loadJson<{
      nodes?: Record<string, { id?: string; name?: string; is_keystone?: boolean; is_notable?: boolean; ascendancy?: string; stats?: string[] }>;
    }>('passive_tree/tree.json');
    treeCache = Object.values(raw.nodes ?? {})
      .filter((n) => n && n.name)
      .map((n) => ({
        id: n.id ?? '',
        name: n.name ?? '',
        isKeystone: !!n.is_keystone,
        isNotable: !!n.is_notable,
        ascendancy: n.ascendancy ?? '',
        stats: n.stats ?? [],
      }));
  }
  return treeCache;
}

/** Поиск узлов дерева по имени или тексту статов. */
export function searchPassiveTree(query: string, opts: { limit?: number; keystonesOnly?: boolean } = {}): PassiveNode[] {
  const limit = opts.limit ?? 10;
  const q = query.trim().toLowerCase();
  if (!q) return [];
  let nodes = getPassiveTree();
  if (opts.keystonesOnly) nodes = nodes.filter((n) => n.isKeystone);
  const byName = nodes.filter((n) => n.name.toLowerCase().includes(q));
  const byStat = nodes.filter(
    (n) => !n.name.toLowerCase().includes(q) && n.stats.some((s) => s.toLowerCase().includes(q)),
  );
  const seen = new Set<string>();
  const out: PassiveNode[] = [];
  for (const n of [...byName, ...byStat]) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}

export interface PassiveTreeByStatsOpts {
  limit?: number;
  keystonesOnly?: boolean;
  /** true — обратное: узлы, где встречается хотя бы одно слово (OR). По умолчанию AND. */
  any?: boolean;
}

/**
 * Поиск по дереву по НАБОРУ статов (P1 #10, AND-агрегат).
 * Возвращает узлы, где каждое слово/фраза из `terms` встречается в имени ИЛИ
 * статах узла (AND). Эта отладка: «узлы с "% increased Energy Shield" и
 * "Evasion Rating"» вместо перебора по одному слову. `any: true` — хотя бы одно
 * (OR), для комбинирования через poe2_tree_search в одиночном режиме.
 */
export function searchPassiveTreeByStats(terms: string[], opts: PassiveTreeByStatsOpts = {}): PassiveNode[] {
  const limit = opts.limit ?? 10;
  const queries = terms.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!queries.length) return [];
  let nodes = getPassiveTree();
  if (opts.keystonesOnly) nodes = nodes.filter((n) => n.isKeystone);
  const match = (n: PassiveNode): boolean => {
    const haystack = [n.name, ...n.stats].join('\u0001').toLowerCase();
    return opts.any
      ? queries.some((q) => haystack.includes(q))
      : queries.every((q) => haystack.includes(q));
  };
  return nodes.filter(match).slice(0, limit);
}

// ─── Резолв узлов по ID (как в PoB <Spec nodes="…"> или URL дерева) ──────────────────
//
// В датасете три схемы ID:
//  - обычное дерево (passive_tree/tree.json) — СИМВОЛЬНЫЕ ключи/фрагменты PoB-схемы
//    ("attributes1", …).
//  - обычное дерево по ЧИСЛОВЫМ game ID (passive_tree/numeric_ids.json, P0 #1b).
//    Карта извлечена из PoB Community (TreeData/0_3/tree.lua, таблица `nodes`,
//    заeeдена числовыми game-идентификаторами — те же, что PoB пишет в <Spec nodes>).
//    4118 именованных узлов; is_keystone/is_notable выведены эвристикой по имени
//    из tree.json (см. metadata в файле).
//  - асценданси (ascendancies/nodes.json) — ЧИСЛОВЫЕ ID игры (12876 = "Faith is a Choice").
// PoB2 пишет в <Spec nodes="…"> числовые ID игры; теперь они резолвятся и для обычного
// дерева (numeric_ids.json), и для асценданси (nodes.json).

export interface ResolvedPassiveNode extends PassiveNode {
  /** 'tree' — обычное дерево (символьный или числовой ID), 'ascendancy' — узел асценданси. */
  source: 'tree' | 'ascendancy';
  /** kind из асценданси-датасета (start/small/notable) — только для source='ascendancy'. */
  kind: string;
}

export interface PassiveNodeResolveReport {
  /** Сколько уникальных ID было запрошено. */
  requested: number;
  /** Найденные узлы (в порядке ввода, дубликаты отброшены). */
  resolved: ResolvedPassiveNode[];
  /** ID, которых нет ни в одном датасете. */
  missing: string[];
  /** Из missing — числовые ID обычного дерева, которых нет в числовой карте. */
  missingNumeric: string[];
  /** Из missing — символьные ID (не найдено даже среди ключей tree.json). */
  missingSymbolic: string[];
}

let treeById: Map<string, PassiveNode> | null = null;
let ascNodeById: Map<string, AscendancyNode> | null = null;
let numericTreeById: Map<number, NumericTreeEntry> | null = null;

/** Запись числовой карты обычного дерева (passive_tree/numeric_ids.json, P0 #1b). */
export interface NumericTreeEntry {
  name: string;
  stats: string[];
  /** Асцендансия, если узел — asc (числовой ID асценданси; см. также ascendancies/nodes.json). */
  ascendancy: string;
  isKeystone: boolean;
  isNotable: boolean;
}

/** Числовая карта обычного дерева: game node ID (number) → {name, stats, …}. */
export function getNumericTreeMap(): Map<number, NumericTreeEntry> {
  if (!numericTreeById) {
    const raw = loadJson<{ nodes?: Record<string, { name?: string; stats?: string[]; ascendancy?: string; is_keystone?: boolean; is_notable?: boolean }> }>(
      'passive_tree/numeric_ids.json',
    );
    numericTreeById = new Map();
    for (const [id, n] of Object.entries(raw.nodes ?? {})) {
      if (!n || !n.name) continue;
      const num = Number(id);
      if (Number.isFinite(num)) {
        numericTreeById.set(num, {
          name: n.name,
          stats: n.stats ?? [],
          ascendancy: n.ascendancy ?? '',
          isKeystone: !!n.is_keystone,
          isNotable: !!n.is_notable,
        });
      }
    }
  }
  return numericTreeById;
}

const _isNumeric = (k: string): boolean => /^\d+$/.test(k);

/** Узел по ID: символьные ключи обычного дерева, числовые ID (обычные + асценданси). */
export function getPassiveNodeById(id: string): ResolvedPassiveNode | undefined {
  const key = String(id).trim();
  if (!key) return undefined;
  if (_isNumeric(key)) {
    // Числовой ID: сначала асценданси (сохраняет kind), затем числовая карта обычного дерева.
    if (!ascNodeById) ascNodeById = new Map(getAscendancyNodes().map((n) => [String(n.id), n]));
    const ascHit = ascNodeById.get(key);
    if (ascHit) {
      return {
        id: ascHit.id,
        name: ascHit.name,
        isKeystone: false,
        isNotable: ascHit.kind === 'notable',
        ascendancy: ascHit.ascendancy,
        stats: ascHit.stats,
        source: 'ascendancy',
        kind: ascHit.kind,
      };
    }
    const numHit = getNumericTreeMap().get(Number(key));
    if (numHit) {
      return {
        id: key,
        name: numHit.name,
        isKeystone: numHit.isKeystone,
        isNotable: numHit.isNotable,
        ascendancy: numHit.ascendancy,
        stats: numHit.stats,
        source: 'tree',
        kind: '',
      };
    }
    return undefined;
  }
  // Символьный ключ: обычное дерево.
  if (!treeById) treeById = new Map(getPassiveTree().map((n) => [String(n.id), n]));
  const treeHit = treeById.get(key);
  if (!treeHit) return undefined;
  return { ...treeHit, source: 'tree', kind: '' };
}

/** Резолв списка ID в узлы: порядок ввода сохраняется, дубликаты и ненайденные отбрасываются. */
export function getPassiveNodesByIds(ids: string[]): ResolvedPassiveNode[] {
  return resolvePassiveNodes(ids).resolved;
}

/** Резолв списка ID с полным отчётом: найденные + ненайденные (числовые/символьные отдельно). */
export function resolvePassiveNodes(ids: string[]): PassiveNodeResolveReport {
  const seen = new Set<string>();
  const requested: string[] = [];
  for (const raw of ids) {
    const key = String(raw).trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      requested.push(key);
    }
  }
  const resolved: ResolvedPassiveNode[] = [];
  const missing: string[] = [];
  for (const key of requested) {
    const node = getPassiveNodeById(key);
    if (node) resolved.push(node);
    else missing.push(key);
  }
  return {
    requested: requested.length,
    resolved,
    missing,
    missingNumeric: missing.filter(_isNumeric),
    missingSymbolic: missing.filter((k) => !_isNumeric(k)),
  };
}

// ─── Координаты дерева (P2 #15 — «взятые узлы на карте») ──────────────────────

let passivePositions: Map<string, [number, number]> | null = null;

/** Карта координат узлов дерева: game node ID → [x, y] (в игровых координатах карты). */
export function getPassiveTreePositions(): Map<string, [number, number]> {
  if (!passivePositions) {
    const raw = loadJson<{ positions?: Record<string, [number, number]> }>('passive_tree/positions.json');
    passivePositions = new Map();
    for (const [id, p] of Object.entries(raw.positions ?? {})) {
      if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) passivePositions.set(id, [p[0], p[1]]);
    }
  }
  return passivePositions;
}

/** Позиция узла дерева по ID (числовой game ID), если известна. */
export function getPassiveNodePosition(id: string): [number, number] | null {
  return getPassiveTreePositions().get(String(id).trim()) ?? null;
}

// ─── Базовые предметы ────────────────────────────────────────────────────────

export interface BaseItem {
  id: string;
  name: string;
  itemClass: string;
  /** Человекочитаемый класс ("Stackable Currency"). */
  itemClassName: string;
}

let baseItemsCache: BaseItem[] | null = null;

/** Все базовые предметы (~5382). */
export function getBaseItems(): BaseItem[] {
  if (!baseItemsCache) {
    const raw = loadJson<{ base_items?: Record<string, { name?: string; item_class?: string; item_class_name?: string }> }>(
      'base_items.json',
    );
    const entries = Object.entries(raw.base_items ?? {});
    baseItemsCache = entries
      .filter(([, b]) => b && b.name)
      .map(([id, b]) => ({ id, name: b.name!, itemClass: b.item_class ?? '', itemClassName: b.item_class_name ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return baseItemsCache;
}

/** Поиск базовых предметов по подстроке имени. */
export function searchBaseItems(query: string, limit = 10): BaseItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return getBaseItems().filter((b) => b.name.toLowerCase().includes(q)).slice(0, limit);
}

// ─── Внутренние stat_id ──────────────────────────────────────────────────────

let statsCache: string[] | null = null;

/** Все внутренние stat_id игры (~27k) — для маппинга «текст → id» в узлах дерева. */
export function getStatIds(): string[] {
  if (!statsCache) {
    const raw = loadJson<{ stats?: Array<{ stat_id?: string }> }>('stats.json');
    statsCache = (raw.stats ?? []).map((s) => s.stat_id ?? '').filter(Boolean);
  }
  return statsCache;
}

/** Поиск stat_id по подстроке. */
export function searchStatIds(query: string, limit = 10): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return getStatIds().filter((s) => s.toLowerCase().includes(q)).slice(0, limit);
}

// ─── Саппорт-гемы ───────────────────────────────────────────────────────────
// support_gems.json: { metadata, support_gems: { id: {...} } } — 680 записей.

export interface SupportGemEntry {
  row_index: number;
  id: string;
  name: string;
  is_support: boolean;
  effects: Record<string, unknown>;
  tags: string[];
  compatible_with: string[];
  max_level: number;
  /** Источник получения (P0 #5): саппорт-гемы получаются из Uncut Support Gem. */
  source?: GemSource;
}

let supportGemsCache: SupportGemEntry[] | null = null;

/** Все саппорт-гемы (680). */
export function getSupportGems(): SupportGemEntry[] {
  if (!supportGemsCache) {
    const raw = loadJson<{ support_gems?: Record<string, SupportGemEntry> }>('support_gems/support_gems.json');
    supportGemsCache = Object.values(raw.support_gems ?? {}).map((g) => ({
      ...g,
      source: {
        kind: 'UncutSupportGem' as const,
        item: 'Uncut Support Gem',
        unlockLevel: null,
        note:
          'Саппорт-гем: получается из Uncut Support Gem. Uncut уровня N открывает поддержку уровня N; в SSF выпадает дропом, а не покупается.',
      },
    }));
  }
  return supportGemsCache;
}

/** Поиск саппорт-гемов по имени («Concentrated» → Concentrated Effect Support). */
export function searchSupportGems(query: string, limit = 10): SupportGemEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return getSupportGems()
    .filter((g) => g.name.toLowerCase().includes(q) || g.id.toLowerCase().includes(q))
    .sort((a, b) => a.name.length - b.name.length)
    .slice(0, limit);
}

// ─── Узлы асценданси ─────────────────────────────────────────────────────────
// nodes.json: { metadata, ascendancy_nodes: { ascendancy: { nodeId: node } } }.

export interface AscendancyNode {
  id: string;
  ascendancy: string;
  name: string;
  kind: 'start' | 'small' | 'notable' | string;
  stats: string[];
}

let ascendancyNodesCache: AscendancyNode[] | null = null;

/** Все узлы всех асценданси (уплощённые). */
export function getAscendancyNodes(): AscendancyNode[] {
  if (!ascendancyNodesCache) {
    const raw = loadJson<{ ascendancy_nodes?: Record<string, Record<string, { name: string; kind: string; stats: string[] }>> }>(
      'ascendancies/nodes.json',
    );
    const out: AscendancyNode[] = [];
    for (const [asc, nodes] of Object.entries(raw.ascendancy_nodes ?? {})) {
      for (const [id, n] of Object.entries(nodes)) {
        out.push({ id, ascendancy: asc, name: n.name, kind: n.kind, stats: n.stats ?? [] });
      }
    }
    ascendancyNodesCache = out;
  }
  return ascendancyNodesCache;
}

/** Узлы конкретной асценданси (например «Invoker», «Pathfinder»). */
export function getAscendancyNodesByName(ascendancy: string): AscendancyNode[] {
  const q = ascendancy.trim().toLowerCase();
  return getAscendancyNodes().filter((n) => n.ascendancy.toLowerCase() === q || n.ascendancy.toLowerCase().includes(q));
}

/** Поиск узлов асценданси по имени/тексту статов. */
export function searchAscendancyNodes(query: string, opts: { notablesOnly?: boolean; limit?: number } = {}): AscendancyNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const limit = opts.limit ?? 15;
  return getAscendancyNodes()
    .filter((n) => (opts.notablesOnly ? n.kind === 'notable' : true))
    .filter(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        n.ascendancy.toLowerCase().includes(q) ||
        n.stats.some((s) => s.toLowerCase().includes(q)),
    )
    .slice(0, limit);
}

// ─── Игровые описания статов ─────────────────────────────────────────────────
// stat_descriptions/*.json: { descriptions: [{ stat_ids, primary_template, variants }] }.
// Канонические игровые тексты stat_id → шаблон (как в клиенте).

export interface StatDescription {
  statId: string;
  allStatIds: string[];
  template: string;
  sourceFile: string;
}

/** Файлы описаний в порядке приоритета (игровые > скилловые > геммовые). */
const STAT_DESC_FILES = [
  'stat_descriptions/stat_descriptions.json',
  'stat_descriptions/skill_stat_descriptions.json',
  'stat_descriptions/gem_stat_descriptions.json',
  'stat_descriptions/passive_skill_stat_descriptions.json',
  'stat_descriptions/character_panel_stat_descriptions.json',
] as const;

let statDescCache: Map<string, StatDescription> | null = null;

function buildStatDescIndex(): Map<string, StatDescription> {
  const map = new Map<string, StatDescription>();
  for (const file of STAT_DESC_FILES) {
    try {
      const raw = loadJson<{
        descriptions?: Array<{ stat_ids?: string[]; primary_template?: string }>;
      }>(file);
      for (const d of raw.descriptions ?? []) {
        const ids = d.stat_ids ?? [];
        if (!ids.length || !d.primary_template) continue;
        const entry: StatDescription = {
          statId: ids[0]!,
          allStatIds: ids,
          template: d.primary_template,
          sourceFile: file,
        };
        for (const id of ids) if (!map.has(id)) map.set(id, entry);
      }
    } catch {
      // файла нет/битый — пропускаем, индекс строится из остальных
    }
  }
  return map;
}

/**
 * Игровое описание stat_id (текст как в клиенте): base_life →
 * «…% increased maximum Life»-шаблон. null — описания нет.
 */
export function getStatDescription(statId: string): StatDescription | null {
  if (!statDescCache) statDescCache = buildStatDescIndex();
  return statDescCache.get(statId) ?? null;
}

/**
 * Объяснить механику по тексту: подставит stat_id (подстрока) в игровой шаблон.
 * «Glory» → stat_ids c glory → игровой текст. Для AI-слоя «проверить механику».
 */
export function searchStatDescriptions(query: string, limit = 5): StatDescription[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  if (!statDescCache) statDescCache = buildStatDescIndex();
  const seen = new Set<string>();
  const out: StatDescription[] = [];
  for (const [id, desc] of statDescCache) {
    if (id.toLowerCase().includes(q) && !seen.has(desc.statId)) {
      seen.add(desc.statId);
      out.push(desc);
      if (out.length >= limit) break;
    }
  }
  return out;
}
