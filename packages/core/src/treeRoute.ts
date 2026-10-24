/**
 * treeRoute — планировщик маршрута по дереву пассивок PoE2 (пробел №3 карты
 * генератора билдов; спроектирован в sec6-плане 1.1–1.3 `_research/plan_sections/
 * sec6_tree_leveling.md`, реализация своя).
 *
 * Задача: вход «старт класса (+ уже взятые ноды) + список keypoints
 * (keystone/notable по имени/slug/числовому id)» → упорядоченный маршрут до
 * всех целей с минимальным числом новых очков и уровневыми метками «взять к L~N».
 *
 * ДАННЫЕ (факт-решение шага-0, полный layout-граф уже в репо):
 *  - packages/core/data/game/passive_tree/layout.json — 4903 узла
 *    (ключ = числовой game node id, поля name/ks/not/asc/x/y/stats) + 6069
 *    рёбер-пар + classStarts (8 классов) + ascStarts (16 асценданси) +
 *    ascClasses. Экстракт официального GGG skill tree export
 *    (export/data.json + manifest, см. metadata в самом файле) — тот же
 *    граф-слой, что использует poe2-toolkit/tree-core (MIT): их
 *    buildTreeGraph/pathToNode — эталон свери, НЕ копия кода (формат входа
 *    другой: у них — GGG TreeData, у нас уже вычищенный layout).
 *  - packages/core/data/game/build_planner/map.json — numeric_to_slug
 *    (4914 записей slug↔numeric-id, все id присутствуют в layout) —
 *    для резолва целей по GGG-slug.
 *  - leveling.ts LEVELING_ZONES.monsterLevel + questRewards.ts QUEST_REWARDS
 *    (kind='passive', акты 1–4) — квестовые очки пассивок для формулы уровня.
 *
 * АЛГОРИТМ (sec6 1.2): дерево невзвешенное (1 узел = 1 очко) → полный A*
 * не нужен, BFS оптимален. Мультитаргет-ordering — жадный по числу новых
 * узлов («пока цели не пусты: BFS от текущего фронта до ближайшей цели») —
 * эвристика, НЕ глобальный оптимум (задача коммивояжёра на подмножестве);
 * честно помечаем в результате. Идея «фронта от ЛЮБОГО из аллоцированных»
 * (мульти-стартовый BFS) — паттерн JayRichh-poe2/pathFinding.ts (без LICENSE
 * — паттерн только, ни одной строки их кода здесь нет).
 *
 * Уровневые метки: уровень ≈ доступные очки = (L−1) очков за уровни
 * (1 за уровень, game fact PoE2) + квестовые очки актов 1–4 из QUEST_REWARDS
 * (зона → monsterLevel как прокси уровня получения). Погрешность ±2 уровня:
 * интерлюдии (+2 Wolvenhold, +2 Worm and Scorpion, +2 Howling Caves) в
 * датасете квестов отсутствуют — все метки помечены `estimated`.
 *
 * Pure/headless, zero-deps (как tree-core README «Pure and headless»).
 */

import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';
import { installBrowserDataset } from './dataset.js';
import { stripDnt } from './starterBuilds.js';
import { LEVELING_ZONES } from './leveling.js';
import { QUEST_REWARDS } from './questRewards.js';

// ─── Загрузка layout-данных ─────────────────────────────────────────────────

interface LayoutNode {
  name: string;
  stats?: string[];
  asc?: string;
  ks?: boolean;
  not?: boolean;
  x?: number;
  y?: number;
}

interface TreeLayout {
  nodes: Record<string, LayoutNode>;
  edges: Array<[string, string]>;
  classStarts: Record<string, string>;
  ascStarts: Record<string, string>;
  ascClasses: Record<string, string>;
}

/** Ключ узла: числовой game id как string (канонический формат layout/edges). */
export type TreeNodeId = string;

function layoutPath(): string {
  return pathMod!.join(
    pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)),
    '..',
    'data',
    'game',
    'passive_tree',
    'layout.json',
  );
}

let layoutCache: TreeLayout | null = null;

/** Полный layout дерева (nodes/edges/classStarts/ascStarts/ascClasses), кэш. */
export function getTreeLayout(): TreeLayout {
  if (!layoutCache) {
    if (!HAS_DISK) {
      // В браузере host ставит полный файл заранее (см. installBrowserDataset
      // в dataset.ts — тот же контракт «полный JSON 1:1 с data/game»).
      throw new Error(
        'passive_tree/layout.json недоступен в браузере — установите через installBrowserDataset()',
      );
    }
    layoutCache = JSON.parse(fsMod!.readFileSync(layoutPath(), 'utf8')) as TreeLayout;
  }
  return layoutCache;
}

/** Браузерный hook: подсунуть layout целиком (аналог dataset-контракта №222). */
export function installTreeLayoutBrowser(data: unknown): boolean {
  return installBrowserDataset('passive_tree/layout.json', data);
}

// ─── Граф смежности (один проход по edges, sec6 1.2) ────────────────────────

export interface TreeGraph {
  /** Узлы по числовому id. */
  nodeById: Map<TreeNodeId, LayoutNode>;
  /** Соседи узла (сортированы по числовому id для детерминизма). */
  adjacency: Map<TreeNodeId, TreeNodeId[]>;
}

let graphCache: TreeGraph | null = null;

/** Граф смежности дерева (кэш; рёбра двунаправленные — обе пары уже в edges). */
export function getTreeGraph(): TreeGraph {
  if (!graphCache) {
    const layout = getTreeLayout();
    const nodeById = new Map<TreeNodeId, LayoutNode>();
    for (const [id, n] of Object.entries(layout.nodes ?? {})) {
      if (n && n.name) nodeById.set(id, n);
    }
    const adj = new Map<TreeNodeId, TreeNodeId[]>();
    const push = (a: string, b: string) => {
      const list = adj.get(a);
      if (list) list.push(b);
      else adj.set(a, [b]);
    };
    for (const [a, b] of layout.edges ?? []) {
      if (nodeById.has(a) && nodeById.has(b)) {
        push(a, b);
        push(b, a);
      }
    }
    for (const list of adj.values()) list.sort((x, y) => Number(x) - Number(y));
    graphCache = { nodeById, adjacency: adj };
  }
  return graphCache;
}

/** Есть ли ребро a—b (для тестов/отладки). */
export function isTreeEdge(a: TreeNodeId, b: TreeNodeId): boolean {
  return getTreeGraph().adjacency.get(a)?.includes(b) ?? false;
}

// ─── Резолв целей ───────────────────────────────────────────────────────────

export interface ResolvedTreeTarget {
  /** Как записали на входе (для отчёта). */
  input: string;
  id: TreeNodeId;
  name: string;
  nodeType: TreeRouteStep['nodeType'];
}

/** Тип узла: keystone → notable → ascendancy → small. */
function nodeTypeOf(id: TreeNodeId, n: LayoutNode): TreeRouteStep['nodeType'] {
  if (n.ks) return 'keystone';
  if (n.not) return 'notable';
  if (n.asc) return 'ascendancy';
  return 'small';
}

const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

let slugToIdCache: Map<string, TreeNodeId> | null = null;
let nameLookupCache: Map<string, TreeNodeId> | null = null;

function slugMap(): Map<string, TreeNodeId> {
  if (!slugToIdCache) {
    slugToIdCache = new Map();
    const hasDisk = HAS_DISK;
    if (hasDisk) {
      const raw = JSON.parse(
        fsMod!.readFileSync(
          pathMod!.join(
            pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)),
            '..',
            'data',
            'game',
            'build_planner',
            'map.json',
          ),
          'utf8',
        ),
      ) as { numeric_to_slug?: Record<string, string> };
      const graph = getTreeGraph();
      for (const [id, slug] of Object.entries(raw.numeric_to_slug ?? {})) {
        if (slug && graph.nodeById.has(id) && !slugToIdCache.has(slug)) {
          slugToIdCache.set(slug, id);
        }
      }
    }
  }
  return slugToIdCache;
}

/** Имя (после stripDnt, lower) / name-slug → id; приоритет keystone/notable. */
function nameLookup(): Map<string, TreeNodeId> {
  if (!nameLookupCache) {
    nameLookupCache = new Map();
    const graph = getTreeGraph();
    const score = (n: LayoutNode): number => (n.ks ? 3 : n.not ? 2 : n.asc ? 1 : 0);
    for (const [id, n] of graph.nodeById) {
      const clean = stripDnt(n.name);
      if (!clean) continue;
      for (const key of [clean.toLowerCase(), slugify(clean)]) {
        const prev = nameLookupCache.get(key);
        if (prev === undefined || score(n) > score(graph.nodeById.get(prev)!)) {
          // при равном score меньший id (детерминизм, вставка по возрастанию)
          nameLookupCache.set(key, id);
        } else if (prev !== undefined && score(n) === score(graph.nodeById.get(prev)!) && Number(id) < Number(prev)) {
          nameLookupCache.set(key, id);
        }
      }
    }
  }
  return nameLookupCache;
}

/**
 * Резолв целей: числовой id | GGG-slug (build_planner/map.json) | имя узла
 * (keystones/notables приоритетнее small-дублей) | name-slug.
 * Порядок входа сохраняется; дубликаты id отбрасываются.
 */
export function resolveTreeTargets(targets: string[]): {
  resolved: ResolvedTreeTarget[];
  missing: string[];
} {
  const graph = getTreeGraph();
  const resolved: ResolvedTreeTarget[] = [];
  const missing: string[] = [];
  const seen = new Set<TreeNodeId>();
  for (const raw of targets) {
    const input = String(raw ?? '').trim();
    if (!input) continue;
    let id: TreeNodeId | undefined;
    if (/^\d+$/.test(input) && graph.nodeById.has(input)) id = input;
    if (!id) id = slugMap().get(input) ?? slugMap().get(slugify(input));
    if (!id) id = nameLookup().get(input.toLowerCase()) ?? nameLookup().get(slugify(input));
    if (!id) {
      missing.push(input);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const n = graph.nodeById.get(id)!;
    resolved.push({ input, id, name: stripDnt(n.name), nodeType: nodeTypeOf(id, n) });
  }
  return { resolved, missing };
}

/** Резолв узла старта: имя класса (Monk) | имя асценданси (Invoker) | числовой id. */
export function resolveTreeStart(start?: string, ascendancy?: string): TreeNodeId[] {
  const layout = getTreeLayout();
  const out = new Set<TreeNodeId>();
  const byLower = (obj: Record<string, string>, key: string): string | undefined => {
    for (const [k, v] of Object.entries(obj)) {
      if (k.toLowerCase() === key.toLowerCase()) return v;
    }
    return undefined;
  };
  const s = start?.trim();
  const a = ascendancy?.trim();
  if (s) {
    const cls = byLower(layout.classStarts, s);
    if (cls) out.add(cls);
    else if (/^\d+$/.test(s) && getTreeGraph().nodeById.has(s)) out.add(s);
  }
  if (a) {
    const asc = byLower(layout.ascStarts, a);
    if (asc) out.add(asc);
  }
  return [...out];
}

// ─── Квест-очки и формула «уровень ↔ доступные очки» ────────────────────────

/** Одна квестовая награда очков пассивок: уровень-прокси (monsterLevel зоны). */
export interface QuestPassivePoint {
  zone: string;
  /** Прокси уровня персонажа на момент награды (monsterLevel зоны из leveling.ts). */
  level: number;
  points: number;
}

const QUEST_PASSIVE_RE = /(\d+)\s*Passive/i;

let questPassiveCache: QuestPassivePoint[] | null = null;

/**
 * Квестовые очки пассивок кампании (акты 1–4): QUEST_REWARDS kind='passive'
 * + monsterLevel зон из LEVELING_ZONES. Интерлюдии (+2 Wolvenhold и др.) в
 * датасете НЕТ — источник погрешности ±2 уровня у меток.
 */
export function questPassivePoints(): QuestPassivePoint[] {
  if (!questPassiveCache) {
    const zoneLevel = new Map<string, number>();
    for (const z of LEVELING_ZONES) {
      if (z.monsterLevel != null && !zoneLevel.has(z.zone.toLowerCase())) {
        zoneLevel.set(z.zone.toLowerCase(), z.monsterLevel);
      }
    }
    questPassiveCache = [];
    for (const q of QUEST_REWARDS) {
      if (q.kind !== 'passive') continue;
      const m = QUEST_PASSIVE_RE.exec(q.reward);
      const pts = m ? Number(m[1]) : 2;
      const lvl = zoneLevel.get(q.zone.toLowerCase());
      if (lvl != null && pts > 0) questPassiveCache.push({ zone: q.zone, level: lvl, points: pts });
    }
    questPassiveCache.sort((x, y) => x.level - y.level || x.zone.localeCompare(y.zone));
  }
  return questPassiveCache;
}

/** Очки за уровни: 1 за каждый уровень персонажа начиная со 2-го (game fact PoE2). */
export const PASSIVE_POINTS_PER_LEVEL = 1;

/**
 * Суммарные доступные очки пассивок на уровне L (оценка):
 * (L−1) за уровни + квестовые очки, чей прокси-уровень ≤ L.
 * Монотонно неубывает.
 */
export function passivePointsAvailableAtLevel(level: number): number {
  const lvl = Math.max(1, Math.floor(level));
  return (
    (lvl - 1) * PASSIVE_POINTS_PER_LEVEL +
    questPassivePoints()
      .filter((q) => q.level <= lvl)
      .reduce((sum, q) => sum + q.points, 0)
  );
}

/**
 * Минимальный уровень, на котором доступно ≥ points очков (инверсия
 * passivePointsAvailableAtLevel). null — не хватает даже на L100.
 * Оценка (±2): интерлюдии-квесты вне датасета ускоряют реальный набор.
 */
export function levelForPassivePoints(points: number): number | null {
  const p = Math.max(0, Math.floor(points));
  for (let lvl = 1; lvl <= 100; lvl++) {
    if (passivePointsAvailableAtLevel(lvl) >= p) return lvl;
  }
  return null;
}

// ─── Маршрут ───────────────────────────────────────────────────────────────

export interface TreeRouteRequest {
  /** Имя класса (Monk/Warrior/…) или числовой id стартового узла. */
  classStart?: string;
  /** Альтернативный старт: имя асценданси (Invoker/…) → ascStarts. */
  ascendancy?: string;
  /** Keystones/notables: имя | GGG-slug | числовой id. Неизвестные → unresolved. */
  targets: string[];
  /** Уже взятые узлы (числовые id) — стартовый фронт, их очки НЕ считаем. */
  allocated?: string[];
  /** Смета очков на маршрут: цели сверх неё → deferred. */
  levelBudget?: number;
}

export type TreeNodeType = 'keystone' | 'notable' | 'small' | 'ascendancy';

export interface TreeRouteStep {
  id: TreeNodeId;
  name: string;
  nodeType: TreeNodeType;
  /** Очки, потраченные к этому узлу маршрута ВКЛЮЧАЯ его (1 узел = 1 очко). */
  cumPoints: number;
  /** Метка «взять к L~N» (оценка ±2): на уровне N очков уже хватает. */
  takeByLevel: number | null;
  /** true — сам является целью. */
  isTarget: boolean;
  /** Индекс этапа (leg) в milestones. */
  legIndex: number;
}

export interface TreeRouteMilestone {
  /** id целевого узла. */
  targetId: TreeNodeId;
  /** Имя цели. */
  targetName: string;
  /** Как записали на входе. */
  input: string;
  /** Новые очки, потраченные на этот этап. */
  legPoints: number;
  /** Кумулятив по маршруту после этапа. */
  cumPoints: number;
  /** Метка этапа «взять к L~N». */
  takeByLevel: number | null;
  /** Шаги этапа (новые узлы; шаг цели — последний). */
  steps: TreeRouteStep[];
  /** Узел фронта, от которого пришёл этап (id). */
  reachedFrom: TreeNodeId;
}

export interface TreeRouteResult {
  ok: boolean;
  /** Узлы старта (класс + асценданси, если задан). */
  startNodeIds: TreeNodeId[];
  /** Полный маршрут в порядке взятия (без стартов/allocated). */
  steps: TreeRouteStep[];
  /** Этапы по целям в порядке закрытия (0-очковые — тоже). */
  milestones: TreeRouteMilestone[];
  /** Число новых очков за весь маршрут. */
  totalPoints: number;
  /** Метки уровня — оценка ±2 (интерлюдии вне датасета квестов). */
  estimated: string;
  /** Входные цели, не разрешённые к узлам дерева. */
  unresolved: string[];
  /** Разрешённые, но недостижимые из старта (нет пути в layout-графе). */
  unreachable: string[];
  /** Цели за пределами levelBudget (им хватило бы очков позже — см. milestones
   * этих целей для ранжирования). Подаются как входные строки. */
  deferred: string[];
}

interface BfsTrees {
  dist: Map<TreeNodeId, number>;
  parent: Map<TreeNodeId, TreeNodeId>;
}

/** Мульти-стартовый BFS: расстояние до всех узлов от ближайшего узла фронта. */
function bfsFromFrontier(frontier: Set<TreeNodeId>, graph: TreeGraph): BfsTrees {
  const dist = new Map<TreeNodeId, number>();
  const parent = new Map<TreeNodeId, TreeNodeId>();
  const queue: TreeNodeId[] = [];
  for (const id of [...frontier].sort((a, b) => Number(a) - Number(b))) {
    if (graph.nodeById.has(id) && !dist.has(id)) {
      dist.set(id, 0);
      parent.set(id, id);
      queue.push(id);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const d = dist.get(cur)!;
    for (const nb of graph.adjacency.get(cur) ?? []) {
      if (dist.has(nb)) continue;
      dist.set(nb, d + 1);
      parent.set(nb, cur);
      queue.push(nb);
    }
  }
  return { dist, parent };
}

const NO_FRONTIER: TreeNodeId = '';

/**
 * Планировщик маршрута по дереву пассивок (sec6 1.2).
 *
 * null — если ни одна цель не резолвится к узлам дерева (полный список
 * «что не найдено» — через resolveTreeTargets) или если не задан ни один
 * старт (classStart/ascendancy/allocated все пусты/неизвестны).
 *
 * Ordering — жадный (ближайшая по BFS цель первой), не глобальный минимум
 * по всем целям: честная эвристика, см. шапку модуля.
 */
export function treeRoute(request: TreeRouteRequest): TreeRouteResult | null {
  const targets = (request.targets ?? []).map((t) => String(t ?? '').trim()).filter(Boolean);
  if (!targets.length) return null;
  const { resolved, missing } = resolveTreeTargets(targets);
  if (!resolved.length) return null;

  const graph = getTreeGraph();
  const startIds = resolveTreeStart(request.classStart, request.ascendancy);
  const allocatedIds = (request.allocated ?? [])
    .map((a) => String(a ?? '').trim())
    .filter((a) => /^\d+$/.test(a) && graph.nodeById.has(a));

  const frontier = new Set<TreeNodeId>(startIds);
  for (const id of allocatedIds) frontier.add(id);
  if (!frontier.size) return null;

  // уже взятые (allocated) или стартовые цели закрываются бесплатно
  const remaining = resolved.filter((t) => !frontier.has(t.id));
  const freeTargets = resolved.filter((t) => frontier.has(t.id));

  const steps: TreeRouteStep[] = [];
  const milestones: TreeRouteMilestone[] = [];
  const unresolved = [...missing];
  const unreachable: string[] = [];
  const deferred: string[] = [];

  const budget =
    typeof request.levelBudget === 'number' && Number.isFinite(request.levelBudget) && request.levelBudget >= 0
      ? Math.floor(request.levelBudget)
      : null;

  let cum = 0;
  let legIndex = 0;
  const spentIds = new Set<TreeNodeId>();

  const emitFree = (t: ResolvedTreeTarget): void => {
    milestones.push({
      targetId: t.id,
      targetName: t.name,
      input: t.input,
      legPoints: 0,
      cumPoints: cum,
      takeByLevel: levelForPassivePoints(cum),
      steps: [],
      reachedFrom: t.id,
    });
  };
  freeTargets.forEach(emitFree);

  // жадный ordering: на каждом шаге BFS от текущего фронта → ближайшая цель
  const pending = [...remaining];
  while (pending.length) {
    const { dist, parent } = bfsFromFrontier(frontier, graph);
    // ближайшая цель; при равенстве дистанции — меньший числовой id (детерминизм)
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < pending.length; i++) {
      const d = dist.get(pending[i]!.id) ?? Infinity;
      // bestIdx < 0 — патологический tie Infinity===Infinity (недостижимые цели):
      // берём «лучшую из худших», ветка ниже честно уйдёт в unreachable.
      if (d < bestDist || (d === bestDist && (bestIdx < 0 || Number(pending[i]!.id) < Number(pending[bestIdx]!.id)))) {
        bestIdx = i;
        bestDist = d;
      }
    }
    const target = pending[bestIdx]!;
    if (!dist.has(target.id)) {
      // недостижим из текущего фронта (нет пути в layout-графе)
      unreachable.push(target.input);
      pending.splice(bestIdx, 1);
      continue;
    }

    // реконструкция пути: цель → ближайший узел фронта
    const legNodes: TreeNodeId[] = [];
    let cur: TreeNodeId = target.id;
    while (!frontier.has(cur)) {
      legNodes.push(cur);
      cur = parent.get(cur)!;
    }
    const root = cur;
    legNodes.reverse();

    const legPoints = legNodes.length;
    if (budget !== null && cum + legPoints > budget) {
      deferred.push(target.input);
      pending.splice(bestIdx, 1);
      continue;
    }
    for (const id of legNodes) {
      if (spentIds.has(id)) continue; // защита от дублей (теоретически невозможно)
      spentIds.add(id);
      cum += 1;
      const n = graph.nodeById.get(id)!;
      steps.push({
        id,
        name: stripDnt(n.name),
        nodeType: nodeTypeOf(id, n),
        cumPoints: cum,
        takeByLevel: levelForPassivePoints(cum),
        isTarget: id === target.id,
        legIndex,
      });
      frontier.add(id);
    }
    milestones.push({
      targetId: target.id,
      targetName: target.name,
      input: target.input,
      legPoints,
      cumPoints: cum,
      takeByLevel: levelForPassivePoints(cum),
      steps: steps.filter((s) => s.legIndex === legIndex),
      /** Узел фронта, от которого пришёл этап (id). */
      reachedFrom: root,
    });
    pending.splice(bestIdx, 1);
    legIndex += 1;
  }

  // консистентность: суммарные очки = число шагов (1 узел = 1 очко)
  return {
    ok: steps.length > 0 || milestones.length > 0,
    startNodeIds: [...startIds],
    steps,
    milestones,
    totalPoints: cum,
    estimated: 'level ±2 (интерлюдии-квесты вне датасета квестов)',
    unresolved,
    unreachable,
    deferred,
  };
}
