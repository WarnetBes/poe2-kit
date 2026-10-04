/**
 * Ленивый монтаж WebGL-режима вкладки «Карта» (P2 #24b).
 *
 * Данные — официальный экспорт GGG (grindinggear/poe2-skilltree-export):
 *   export/data.json                       — канонический вход normalizeGggTree
 *   export/manifest.json                   — собирается _build_tree_manifest.mjs
 *   assets/skills.webp + export/frame.webp + export/mastery-effect-active.webp
 * Канонический путь без единой строчки своей геометрии:
 *   data.json → normalizeGggTree → buildScene → TreeView (PixiJS WebGL).
 *
 * API: mountGameTree(host, {onNodeClick}) → GameHandle {unmount, setClass}.
 * Всё замечательное живёт в отдельном lazy-чанке (dynamic import из fullMap.ts).
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  buildScene, buildTreeGraph, clearAscendancyAllocation,
  toggleAllocation, toggleAscendancyAllocation,
  type BuildAllocation, type Scene, type SpriteManifest, type TreeData,
  type TreeGraph,
} from '@poe2-toolkit/tree-core';
import { normalizeGggTree } from '@poe2-toolkit/tree-core/ggg';
import { GameTree } from './GameTree';

import dataUrl from '../../../../packages/core/data/game/passive_tree/export/data.json?url';
import manifestUrl from '../../../../packages/core/data/game/passive_tree/export/manifest.json?url';
import skillsUrl from '../../../../packages/core/data/game/passive_tree/assets/skills.webp?url';
import frameUrl from '../../../../packages/core/data/game/passive_tree/export/frame.webp?url';
import masteryUrl from '../../../../packages/core/data/game/passive_tree/export/mastery-effect-active.webp?url';

/** Информация об узле для карточки (значения — из data.json, без пересчётов). */
export interface GameNodeInfo {
  name: string;
  stats: string[];
  ascendancy?: string;
  isKeystone?: boolean;
  isNotable?: boolean;
  isMastery?: boolean;
  isJewelSocket?: boolean;
  isAscendancyStart?: boolean;
}

export interface GameHandle {
  unmount(): void;
  /** Имя базового класса (Monk, …) → подсветка стартового кольца; undefined — все. */
  setClass(name: string | undefined): void;
  /** Display-имя асценданси («Invoker») → диск переносится в хаб; undefined — нет. */
  setAscendancy(name: string | undefined): void;
  /**
   * Подсветка билда: набор взялённых узлов PoB (числовые id = GGG skill ids —
   * совпадение проверено на эталоне 28880: 148/148). null — пустое дерево.
   */
  setBuild(allocation: BuildAllocation | null): void;
  // ── Планировщик (№209): клик по узлу = взять/снять с path-валидацией ───────
  /** Текущий план (или null, если ещё не начат). */
  getPlan(): GamePlan | null;
  /**
   * Старт/восстановление плана от класса: пустой allocated. Class сменa здесь
   * НЕ роняет существующий план (селектор класса — визуальный фильтр);
   * полный перезапуск — resetPlan() + initPlan().
   */
  initPlan(className: string, ascendancy?: string): void;
  /** Восстановить план из persisted-состояния (ссылка/localStorage). */
  restorePlan(p: GamePlan): boolean;
  /**
   * Клик по узлу: взять (кратчайший путь от старта класса + текущего плана)
   * или снять (с автоматическим отсечением осиротевших ветвей — как PoB).
   * Возврат: ok=false = отказ (узел вне класса/чужая асценданси), hint — причина.
   */
  toggleNode(skill: number): { ok: boolean; plan: GamePlan | null; hint?: string };
  /** Сменить асценданси-ветку плана (узлы старой ветки снимаются). */
  planSetAscendancy(name: string | undefined): void;
  /** Полный сброс плана. */
  resetPlan(): void;
  /** базовый класс → его асценданси (display-имена, из GGG data.json). */
  ascByClass: Map<string, string[]>;
}

/** Сериализуемое состояние плана (persist: URL/localStorage). */
export interface GamePlan {
  /** Базовый класс-корень плана (Monk, …). */
  className: string;
  /** Числовые id взятых узлов (GGG skill ids, start-узел класса НЕ входит). */
  allocated: number[];
  /** Активная асценданси-ветка плана (display-имя), если выбрана. */
  ascendancy?: string;
}

export interface MountOpts {
  onNodeClick: (info: GameNodeInfo | null, skill: number, screen: { x: number; y: number }) => void;
  /** Билд для немедленной подсветки при монтаже (опционально). */
  allocation?: BuildAllocation | null;
}

/** базовый класс → display-имена его асценданси (только непустые, из GGG data.json). */
export function ascendanciesByClass(treeData: TreeData): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const cls of treeData.classes) {
    const names = (cls.ascendancies ?? []).map((a) => a.name).filter(Boolean);
    if (names.length) map.set(cls.name, names);
  }
  return map;
}

const loadJson = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} для ${url}`);
  return (await r.json()) as T;
};

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Не загрузился атлас ${url}`));
    img.src = url;
  });

/** Все тяжёлые ресурсы качаем/парсим один раз (сессия живет — кэш держим). */
interface Loaded {
  treeData: TreeData;
  scene: Scene;
  manifest: SpriteManifest;
  atlases: Record<string, CanvasImageSource>;
  nodeBySkill: Map<number, GameNodeInfo>;
  classIds: Map<string, number>;
  classStarts: Map<string, number>;
}
let loaded: Promise<Loaded> | null = null;

function toInfo(node: Record<string, unknown>): GameNodeInfo {
  return {
    name: (node.name as string) ?? '',
    stats: (node.stats as string[]) ?? [],
    ascendancy: typeof node.ascendancyName === 'string' ? node.ascendancyName : undefined,
    isKeystone: !!node.isKeystone,
    isNotable: !!node.isNotable,
    isMastery: !!node.isMastery,
    isJewelSocket: !!node.isJewelSocket,
    isAscendancyStart: !!node.isAscendancyStart,
  };
}

async function loadAll(): Promise<Loaded> {
  const [raw, manifest, skillsImg, frameImg, masteryImg] = await Promise.all([
    loadJson<Record<string, unknown>>(dataUrl),
    loadJson<SpriteManifest>(manifestUrl),
    loadImage(skillsUrl),
    loadImage(frameUrl),
    loadImage(masteryUrl),
  ]);
  const treeData = normalizeGggTree(raw as unknown as Parameters<typeof normalizeGggTree>[0], '0_5');
  const scene = buildScene(treeData);

  const nodeBySkill = new Map<number, GameNodeInfo>();
  const nodes = (raw.nodes ?? {}) as Record<string, Record<string, unknown>>;
  for (const node of Object.values(nodes)) {
    if (node && typeof node === 'object' && typeof node.skill === 'number' && node.name) {
      nodeBySkill.set(node.skill, toInfo(node));
    }
  }

  const classIds = new Map<string, number>();
  const classStarts = new Map<string, number>();
  treeData.classes.forEach((c, i) => {
    classIds.set(c.name, c.id ?? i);
    if (typeof c.startNode === 'number') classStarts.set(c.name, c.startNode);
  });

  return {
    treeData,
    scene,
    manifest,
    atlases: { skills: skillsImg, frame: frameImg, mastery: masteryImg },
    nodeBySkill,
    classIds,
    classStarts,
  };
}

export async function mountGameTree(host: HTMLElement, opts: MountOpts): Promise<GameHandle> {
  // WebGL-гейт: без него Pixi не встанет — говорим честно, SVG-режим остаётся.
  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2')) {
    throw new Error('WebGL2 недоступен в этом браузере');
  }

  // Сбой загрузки (сеть и т.п.) не должен прилипать в кэше: иначе «Игровой вид»
  // мёртв до перезагрузки страницы (отклонённый promise не ретраится) — №208.
  if (!loaded) {
    loaded = loadAll().catch((e: unknown) => {
      loaded = null;
      throw e;
    });
  }
  const L = await loaded;

  let activeClassId: number | undefined;
  let activeAscendancy: string | undefined;

  // ── Планировщик (№209) ────────────────────────────────────────────────────
  // Корень = start-узел класса; граф ходьбы строится per-класс (activeStart),
  // чужие старты из графа исключены — мостить гейты между классами нельзя.
  interface Plan {
    className: string;
    classId: number;
    start: number;
    allocated: Set<number>;
    ascendancy?: string;
    graph: TreeGraph;
  }
  const planIdsOf = (): GamePlan | null =>
    plan ? { className: plan.className, allocated: [...plan.allocated], ascendancy: plan.ascendancy } : null;
  const startPlanFor = (className: string, ascendancy?: string, allocated?: Iterable<number>): Plan | null => {
    const classId = L.classIds.get(className);
    const start = L.classStarts.get(className);
    if (classId === undefined || start === undefined) return null;
    return {
      className,
      classId,
      start,
      allocated: new Set(allocated ?? []),
      ascendancy: ascendancy || undefined,
      graph: buildTreeGraph(L.treeData, start),
    };
  };
  let plan: Plan | null = null;
  // Сцена пересобирается сменой билда: buildScene — чистая функция по аллокации
  // (fps-критичный рендер уже в PixiJS-слое, разовая пересборка при клике ок).
  let scene: Scene = opts.allocation
    ? buildScene(L.treeData, { allocation: opts.allocation })
    : L.scene;
  let root: Root | null = createRoot(host);

  const render = () => {
    root?.render(
      createElement(GameTree, {
        scene,
        manifest: L.manifest,
        atlases: L.atlases,
        activeClassId,
        activeAscendancy,
        onNodeClick: (skill: number, screen: { x: number; y: number }) =>
          opts.onNodeClick(L.nodeBySkill.get(skill) ?? null, skill, screen),
      }),
    );
  };
  render();

  return {
    unmount() {
      root?.unmount();
      root = null;
    },
    setClass(name: string | undefined) {
      activeClassId = name ? L.classIds.get(name) : undefined;
      render();
    },
    setAscendancy(name: string | undefined) {
      activeAscendancy = name || undefined;
      render();
    },
    setBuild(allocation: BuildAllocation | null) {
      scene = allocation ? buildScene(L.treeData, { allocation }) : L.scene;
      render();
    },
    getPlan: () => planIdsOf(),
    initPlan(className: string, ascendancy?: string) {
      plan = startPlanFor(className, ascendancy);
    },
    restorePlan(p: GamePlan) {
      if (!Array.isArray(p.allocated)) return false;
      const next = startPlanFor(p.className, p.ascendancy, p.allocated);
      if (!next) return false;
      plan = next;
      return true;
    },
    toggleNode(skill: number) {
      if (!plan) return { ok: false, plan: null, hint: 'нет классов-плана' };
      const info = L.nodeBySkill.get(skill);
      if (!info) return { ok: false, plan: planIdsOf(), hint: 'узел вне экспорта GGG' };
      try {
        if (info.isMastery) return { ok: false, plan: planIdsOf(), hint: 'мастерство не аллоцируется кликом' };
        let next: number[];
        if (info.ascendancy) {
          if (info.ascendancy !== plan.ascendancy) {
            return { ok: false, plan: planIdsOf(), hint: `асценданси «${info.ascendancy}» не активна в плане` };
          }
          next = toggleAscendancyAllocation(L.treeData, plan.ascendancy, plan.allocated, skill);
        } else {
          next = toggleAllocation(L.treeData, plan.start, plan.allocated, skill, plan.graph);
        }
        plan.allocated = new Set(next);
        return { ok: true, plan: planIdsOf() };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, plan: planIdsOf(), hint: msg };
      }
    },
    planSetAscendancy(name: string | undefined) {
      if (!plan || plan.ascendancy === (name || undefined)) return;
      if (plan.ascendancy) {
        plan.allocated = new Set(clearAscendancyAllocation(L.treeData, plan.allocated, plan.ascendancy));
      }
      plan = startPlanFor(plan.className, name, plan.allocated);
    },
    resetPlan() {
      plan = null;
    },
    ascByClass: ascendanciesByClass(L.treeData),
  };
}
