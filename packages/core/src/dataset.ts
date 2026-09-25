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
}

interface RawGem {
  name?: string;
  baseTypeName?: string;
  castTime?: number;
  skillTypes?: string[];
  levels?: Array<{ cost?: Record<string, number> }>;
}

let gemsCache: SkillGem[] | null = null;

function rawGems(): Record<string, RawGem> {
  const raw = loadJson<{ skills?: Record<string, RawGem> }>('skill_gems/skill_gems_v2.json');
  return raw.skills ?? {};
}

/** Все активные гемы (может быть ~150; данные центурируются лениво). */
export function getSkillGems(): SkillGem[] {
  if (!gemsCache) {
    gemsCache = Object.entries(rawGems()).map(([id, g]) => ({
      id,
      name: g.name ?? g.baseTypeName ?? id,
      baseTypeName: g.baseTypeName ?? '',
      castTime: g.castTime ?? 0,
      skillTypes: g.skillTypes ?? [],
      maxLevel: g.levels?.length ?? 0,
      firstLevelCost: g.levels?.[0]?.cost ?? null,
      lastLevelCost: g.levels?.[g.levels.length - 1]?.cost ?? null,
    }));
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

// ─── Резолв узлов по ID (как в PoB <Spec nodes="…"> или URL дерева) ──────────────────
//
// В датасете две схемы ID:
//  - обычное дерево (passive_tree/tree.json) — СИМВОЛЬНЫЕ ключи/фрагменты PoB-схемы
//    ("attributes1", …). Числовых ID (как в PoB/URL дерева) у обычного дерева нет.
//  - асценданси (ascendancies/nodes.json) — ЧИСЛОВЫЕ ID игры (12876 = "Faith is a Choice").
// PoB2 пишет в <Spec nodes="…"> числовые ID игры; они резолвятся только для
// асценданси, обычное дерево по числовым ID офлайн не находится (нужна полная
// числовая карта дерева из игровых данных — при её добавлении резолвы заработают
// автоматически, схема ниже это уже поддерживает).

export interface ResolvedPassiveNode extends PassiveNode {
  /** 'tree' — обычное дерево (символьный ID), 'ascendancy' — узел асценданси. */
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
  /** Из missing — числовые ID (обычное дерево из PoB; карты чисел для него пока нет). */
  missingNumeric: string[];
  /** Из missing — символьные ID (не найдено даже среди ключей tree.json). */
  missingSymbolic: string[];
}

let treeById: Map<string, PassiveNode> | null = null;
let ascNodeById: Map<string, AscendancyNode> | null = null;

const _isNumeric = (k: string): boolean => /^\d+$/.test(k);

/** Узел по ID: сначала символьные ключи обычного дерева (~9605), затем числовые ID асценданси. */
export function getPassiveNodeById(id: string): ResolvedPassiveNode | undefined {
  const key = String(id).trim();
  if (!key) return undefined;
  if (!treeById) treeById = new Map(getPassiveTree().map((n) => [String(n.id), n]));
  const treeHit = treeById.get(key);
  if (treeHit) return { ...treeHit, source: 'tree', kind: '' };
  if (!ascNodeById) ascNodeById = new Map(getAscendancyNodes().map((n) => [String(n.id), n]));
  const ascHit = ascNodeById.get(key);
  if (!ascHit) return undefined;
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
}

let supportGemsCache: SupportGemEntry[] | null = null;

/** Все саппорт-гемы (680). */
export function getSupportGems(): SupportGemEntry[] {
  if (!supportGemsCache) {
    const raw = loadJson<{ support_gems?: Record<string, SupportGemEntry> }>('support_gems/support_gems.json');
    supportGemsCache = Object.values(raw.support_gems ?? {});
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
