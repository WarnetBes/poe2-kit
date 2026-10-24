import { describe, it, expect } from 'vitest';
import {
  treeRoute,
  resolveTreeTargets,
  resolveTreeStart,
  getTreeGraph,
  getTreeLayout,
  questPassivePoints,
  passivePointsAvailableAtLevel,
  levelForPassivePoints,
} from '../src/treeRoute.js';

/**
 * Пробел №3 (карта генератора билдов, sec6 1.1–1.3): маршрут по пассивке с
 * уровневыми метками. Все keypoints — РЕАЛЬНЫЕ узлы layout.json
 * (nodes/edges/classStarts — экстракт GGG export, см. getTreeLayout().metadata).
 */

const LAYOUT = getTreeLayout();
const MONK_START = LAYOUT.classStarts['Monk']!;

describe('treeRoute: данные-предпосылки', () => {
  it('layout.json содержит полный граф: узлы, рёбра, старты классов', () => {
    const graph = getTreeGraph();
    expect(graph.nodeById.size).toBeGreaterThan(4000);
    expect(graph.adjacency.size).toBeGreaterThan(4000);
    expect(LAYOUT.classStarts['Monk']).toBe(MONK_START);
    expect(LAYOUT.ascStarts['Invoker']).toBeTruthy();
    // старт Monk связан и с обычным деревом, и со стартами асценданси
    expect(graph.adjacency.get(MONK_START)!.length).toBeGreaterThan(0);
  });

  it('квестовые очки пассивок получены из QUEST_REWARDS (акты 1–4)', () => {
    const q = questPassivePoints();
    expect(q.length).toBeGreaterThan(5); // 9 наград «2 Passive Points» в актах 1–4
    for (const e of q) expect(e.points).toBe(2);
    // уровни-прокси монотонно информативны (не все на одном monsterLevel)
    const levels = new Set(q.map((e) => e.level));
    expect(levels.size).toBeGreaterThan(3);
  });

  it('формула очков: 1 за уровень + квесты, монотонна', () => {
    // L1: 0 очков — старт класс ниче не стоит
    expect(passivePointsAvailableAtLevel(1)).toBe(0);
    let prev = -1;
    for (let lvl = 1; lvl <= 100; lvl++) {
      const v = passivePointsAvailableAtLevel(lvl);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // инверсия: ищем уровень под N очков
    expect(levelForPassivePoints(0)).toBe(1);
    expect(levelForPassivePoints(10)).not.toBeNull();
  });
});

describe('treeRoute: resolveTreeTargets', () => {
  it('имя keystone из layout.json → числовой id (Chaos Inoculation)', () => {
    const { resolved, missing } = resolveTreeTargets(['Chaos Inoculation']);
    expect(missing).toEqual([]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.id).toBe('56349'); // факт layout.json
    expect(resolved[0]!.nodeType).toBe('keystone');
  });

  it('GGG-slug из build_planner/map.json резолвится', () => {
    const { resolved, missing } = resolveTreeTargets(['passive_keystone_zealots_oath']);
    expect(missing).toEqual([]);
    expect(resolved[0]!.id).toBe('52'); // Zealot's Oath
    expect(resolved[0]!.name).toBe("Zealot's Oath");
  });

  it('числовой id напрямую', () => {
    const { resolved } = resolveTreeTargets(['56349']);
    expect(resolved[0]!.name).toBe('Chaos Inoculation');
  });

  it('нотабль асценданси по имени (Invoker)', () => {
    const { resolved, missing } = resolveTreeTargets(['Faith is a Choice']);
    expect(missing).toEqual([]);
    expect(resolved[0]!.nodeType).toBe('notable');
  });

  it('unknown target → missing-список', () => {
    const { resolved, missing } = resolveTreeTargets(['No Such Keystore 999', 'Chaos Inoculation']);
    expect(missing).toEqual(['No Such Keystore 999']);
    expect(resolved).toHaveLength(1);
  });
});

describe('treeRoute: маршрут', () => {
  const REQ = {
    classStart: 'Monk',
    targets: ['Chaos Inoculation'],
  };

  it('Маршрут Monk → Chaos Inoculation: путь валиден и минимален по построению', () => {
    const r = treeRoute(REQ);
    expect(r).not.toBeNull();
    const graph = getTreeGraph();
    const ids = r!.steps.map((s) => s.id);
    // 1 узел = 1 очко
    expect(r!.totalPoints).toBe(ids.length);
    // старт не в маршруте и не оплачивается
    expect(ids).not.toContain(MONK_START);
    // непрерывность: первый шаг — сосед старта, каждый следующий — сосед предыдущего
    expect(graph.adjacency.get(MONK_START)).toContain(ids[0]);
    for (let i = 1; i < ids.length; i++) {
      expect(graph.adjacency.get(ids[i - 1]!)).toContain(ids[i]);
    }
    // цель — последний шаг, помечена isTarget
    expect(r!.steps.at(-1)!.id).toBe('56349');
    expect(r!.steps.at(-1)!.isTarget).toBe(true);
    // cumPoints растёт по шагам
    r!.steps.forEach((s, i) => expect(s.cumPoints).toBe(i + 1));
    expect(r!.unresolved).toEqual([]);
    expect(r!.unreachable).toEqual([]);
  });

  it('уровневые метки разумны и неубывающи', () => {
    const r = treeRoute(REQ)!;
    let prev = 1;
    for (const s of r.steps) {
      expect(s.takeByLevel).not.toBeNull();
      expect(s.takeByLevel!).toBeGreaterThanOrEqual(prev);
      // метка согласована с формулой очков
      expect(passivePointsAvailableAtLevel(s.takeByLevel!)).toBeGreaterThanOrEqual(s.cumPoints);
      prev = s.takeByLevel!;
    }
    // целевой шаг: на уровнях ниже метки очков ещё не хватает
    const final = r.steps.at(-1)!;
    if (final.takeByLevel! > 1) {
      expect(passivePointsAvailableAtLevel(final.takeByLevel! - 1)).toBeLessThan(final.cumPoints);
    }
  });

  it('мультитаргет: обе цели закрыты, жадный ordering, детерминизм', () => {
    const req = { classStart: 'Monk', targets: ['Chaos Inoculation', 'Resolute Technique'] };
    const r1 = treeRoute(req)!;
    const r2 = treeRoute({ ...req, targets: ['Chaos Inoculation', 'Resolute Technique'] })!;
    expect(r1.steps.map((s) => s.id)).toEqual(r2.steps.map((s) => s.id));

    expect(r1.milestones).toHaveLength(2);
    expect(new Set(r1.milestones.map((m) => m.targetName))).toEqual(
      new Set(['Chaos Inoculation', 'Resolute Technique']),
    );
    // суммарные очки = сумма этапов; legPoints > 0 у каждой новой цели
    expect(r1.totalPoints).toBe(r1.milestones.reduce((s, m) => s + m.legPoints, 0));
    // все шаги уникальны, isTarget ровно у целей
    const ids = r1.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(r1.steps.filter((s) => s.isTarget)).toHaveLength(2);
    // этапы идут в порядке маршрута (legIndex не убывает)
    let prevLeg = -1;
    for (const s of r1.steps) {
      expect(s.legIndex).toBeGreaterThanOrEqual(prevLeg);
      prevLeg = s.legIndex;
    }
  });

  it('allocated: уже взятые узлы образуют фронт и очки не считаются', () => {
    const base = treeRoute(REQ)!;
    // берём середину маршрута как «уже взято» — маршрут должен стать дешевле
    const mid = base.steps[Math.floor(base.steps.length / 2)]!;
    const withAlloc = treeRoute({ ...REQ, allocated: [mid.id] })!;
    expect(withAlloc.totalPoints).toBeLessThan(base.totalPoints);
    expect(withAlloc.steps.map((s) => s.id)).not.toContain(mid.id);
  });

  it('цель уже в allocated/старте → закрывается бесплатно (milestone с 0 очков)', () => {
    const r = treeRoute({ ...REQ, allocated: ['56349'] })!;
    expect(r.totalPoints).toBe(0);
    expect(r.steps).toEqual([]);
    expect(r.milestones).toHaveLength(1);
    expect(r.milestones[0]!.legPoints).toBe(0);
  });

  it('нотабль Invoker достижим со старта Monk (асценданси-подграф в layout)', () => {
    const r = treeRoute({ classStart: 'Monk', targets: ['Faith is a Choice'] });
    expect(r).not.toBeNull();
    expect(r!.unreachable).toEqual([]);
    expect(r!.unresolved).toEqual([]);
    expect(r!.steps.length).toBeGreaterThan(0);
    expect(r!.steps.some((s) => s.nodeType === 'ascendancy')).toBe(true);
  });

  it('unknown target: все цели unknown → null; список — через resolveTreeTargets', () => {
    expect(treeRoute({ classStart: 'Monk', targets: ['Nothing Here 42'] })).toBeNull();
    expect(treeRoute({ classStart: 'Monk', targets: [] })).toBeNull();
    // без старта нет маршрута
    expect(treeRoute({ targets: ['Chaos Inoculation'] })).toBeNull();
    // частично unknown: неизвестная в отчёте, известная — в маршруте
    const partial = treeRoute({ classStart: 'Monk', targets: ['Nothing Here 42', 'Chaos Inoculation'] })!;
    expect(partial.unresolved).toEqual(['Nothing Here 42']);
    expect(partial.unreachable).toEqual([]);
    expect(partial.steps.at(-1)!.name).toBe('Chaos Inoculation');
  });

  it('levelBudget: цели сверх сметы → deferred', () => {
    const base = treeRoute(REQ)!;
    const tight = treeRoute({ ...REQ, levelBudget: Math.max(0, base.totalPoints - 1) })!;
    expect(tight.deferred).toContain('Chaos Inoculation');
    expect(tight.steps).toEqual([]);
  });
});

// ─── Golden: сверка с эталонным pathToNode (poe2-toolkit, MIT) ──────────────
//
// Эталон: _research/poe2-toolkit/packages/poe2-tree-core (MIT),
// src/scene/allocate.ts — buildTreeGraph/pathToNode: BFS по НЕВЗВЕШЕНному
// графу (1 узел = 1 очко), multi-source frontier, путь исключает source-узлы
// и включает цель; null — недостижимо. Ниже refPathToNode — adapted from
// poe2-toolkit (MIT).
//
// Формат данных эталона vs наш: у poe2-toolkit вход — сырой GGG TreeData
// (nodes с полями skill/ascendancyName/connections/in|out; normalize.ts на
// лету), и их buildTreeGraph фильтрует walkable-узлы (masteries, ascendancy,
// чужие class-starts при activeStart, синтетический root-хаб). Наш layout.json
// — уже вычищенный экстракт того же GGG-экспорта: общий id-пространство
// (числовые skill-id), root-хаб отсутствует (замок-тест ниже), ascendancy —
// тупиковые ветви от class-стартов (26 граничных рёбер, маршрут через них
// не короче), masteries экстрактором исключены. Данные пакетом poe2-toolkit
// не поставляются → эталонный BFS гоняем на нашем layout-графе: сверка
// валидирует сам механизм (BFS distances, реконструкция пути, multi-target
// ordering) против независимой MIT-реализации.
//
// Расхождения семантики графов (задокументировано, НЕ баг):
//  - poe2-toolkit при activeStart удаляет чужие class-starts (антимост);
//    наш layout их держит как обычные узлы — оба графа без root-хаба, у
//    старт-узлов нет «сквозной» роли (соседи стартов замерены тестом);
//  - poe2-toolkit исключает ascendancy-узлы из главного графа (отдельная
//    панель, buildAscendancyGraph); наш роутер ведёт асценданси-цели прямо
//    (см. тест 'Faith is a Choice').

describe('treeRoute: golden cross-check vs poe2-toolkit pathToNode (MIT)', () => {
  const G = getTreeGraph();
  type RefGraph = ReturnType<typeof getTreeGraph>;

  /** adapted from poe2-toolkit (MIT), src/scene/allocate.ts: pathToNode. */
  function refPathToNode(graph: RefGraph, sources: ReadonlySet<string>, target: string): string[] | null {
    if (sources.has(target)) return [];
    const prev = new Map<string, string>();
    const seen = new Set<string>(sources);
    const queue: string[] = [...sources];
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head]!;
      for (const next of graph.adjacency.get(cur) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        prev.set(next, cur);
        if (next === target) {
          const path: string[] = [];
          let step: string | undefined = target;
          while (step !== undefined && !sources.has(step)) {
            path.push(step);
            step = prev.get(step);
          }
          return path.reverse();
        }
        queue.push(next);
      }
    }
    return null;
  }

  const refDistAtLeast = (sources: ReadonlySet<string>, target: string): number | null => {
    const p = refPathToNode(G, sources, target);
    return p === null ? null : p.length;
  };

  // Реальные цели: общие keystones + детерминированная выборка notable-ов
  // layout.json (факт-проверка их наличия — через resolveTreeTargets ниже).
  const GOLDEN_KEYSTONES = [
    'Chaos Inoculation',
    'Resolute Technique',
    "Zealot's Oath",
    'Unwavering Stance',
    'Iron Reflexes',
    'Blood Magic',
    'Pain Attunement',
    'Eldritch Battery',
    'Avatar of Fire',
    'Mind Over Matter',
    'Necromantic Talisman',
    "Giant's Blood",
    'Trusted Kinship',
    'Hollow Palm Technique',
    'Conduit',
  ];
  const GOLDEN_NOTABLE_IDS = [...G.nodeById.entries()]
    .filter(([, n]) => n.not)
    .map(([id]) => id)
    .filter((_, i) => i % 143 === 0)
    .slice(0, 8); // детерминированный сэмпл (~0.1% notable-ов)
  const GOLDEN_TARGETS = [
    ...GOLDEN_KEYSTONES.map((input) => ({ input })),
    ...GOLDEN_NOTABLE_IDS.map((id) => ({ input: id })),
  ];
  const STARTS = Object.entries(LAYOUT.classStarts); // 6 реальных классов

  it('факт-предпосылка: layout без root-хаба, нет узла, смежного ≥2 класс-стартам', () => {
    const startIds = new Set(STARTS.map(([, id]) => id));
    for (const [id, neighbors] of G.adjacency) {
      const hits = neighbors.filter((nb) => startIds.has(nb)).length;
      expect(hits).toBeLessThan(2);
    }
  });

  it('golden single-target: все резолвятся и длина маршрута == эталонный BFS', () => {
    const { resolved, missing } = resolveTreeTargets(GOLDEN_TARGETS.map((t) => t.input));
    expect(missing).toEqual([]);
    expect(resolved.length).toBeGreaterThanOrEqual(23); // 15 keystones + notable-сэмпл
    let pairs = 0;
    for (const [cls, startId] of STARTS) {
      for (const t of resolved) {
        const expected = refDistAtLeast(new Set([startId]), t.id);
        expect(expected, `${cls} → ${t.name}: эталон достижим`).not.toBeNull();
        const r = treeRoute({ classStart: cls, targets: [t.input] })!;
        expect(r.unresolved, t.name).toEqual([]);
        expect(r.unreachable, t.name).toEqual([]);
        expect(r.totalPoints, `${cls} → ${t.name}`).toBe(expected);
        // путь валиден: непрерывен по рёбрам layout, начинается соседом старта,
        // заканчивается целью
        const ids = r.steps.map((s) => s.id);
        expect(ids.at(-1), t.name).toBe(t.id);
        if (ids.length) {
          expect(G.adjacency.get(startId), t.name).toContain(ids[0]);
          for (let i = 1; i < ids.length; i++) {
            expect(G.adjacency.get(ids[i - 1]!), `${cls}→${t.name} разрыв ${ids[i - 1]}—${ids[i]}`).toContain(ids[i]);
          }
        }
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThanOrEqual(23 * STARTS.length); // ≥138 golden-пар
  });

  it('golden multi-target: жадный ordering в задокументированных bounds (жад ≠ TSP)', () => {
    // Bounds жадного мультитаргета (не глобальный оптимум):
    //   lower: total ≥ max_i dist(start, t_i)   — самую дальнюю всё равно идти
    //   upper: total ≤ Σ_i dist(start, t_i)     — общий фронт только помогает
    //   greedy-свойство: первый этап — ближайшая цель, его legPoints == min dist
    for (const [cls, startId] of STARTS) {
      const targets = ['Chaos Inoculation', 'Resolute Technique', 'Eldritch Battery'];
      const r = treeRoute({ classStart: cls, targets })!;
      expect(r.unreachable).toEqual([]);
      const ids = resolveTreeTargets(targets).resolved.map((t) => t.id);
      const dists = ids.map((id) => refDistAtLeast(new Set([startId]), id)!);
      expect(r.totalPoints, cls).toBeGreaterThanOrEqual(Math.max(...dists));
      expect(r.totalPoints, cls).toBeLessThanOrEqual(dists.reduce((a, b) => a + b, 0));
      expect(r.milestones).toHaveLength(3);
      expect(r.milestones[0]!.legPoints, cls).toBe(Math.min(...dists));
      expect(new Set(r.milestones.map((m) => m.targetName))).toEqual(new Set(targets));
      // консистентность сумм
      expect(r.totalPoints).toBe(r.milestones.reduce((s, m) => s + m.legPoints, 0));
    }
  });

  it('golden allocated-фронт: multi-source эталона == наш маршрут с allocated', () => {
    const base = treeRoute({ classStart: 'Monk', targets: ['Chaos Inoculation', 'Resolute Technique'] })!;
    const allocatedIds = base.steps.filter((s) => s.legIndex === 0).map((s) => s.id);
    const rtId = resolveTreeTargets(['Resolute Technique']).resolved[0]!.id;
    const sources = new Set<string>([MONK_START, ...allocatedIds]);
    const expected = refDistAtLeast(sources, rtId)!;
    const r = treeRoute({ classStart: 'Monk', targets: ['Resolute Technique'], allocated: allocatedIds })!;
    expect(expected).not.toBeNull();
    expect(r.totalPoints).toBe(expected);
    // allocated не оплачиваются дважды и не входят в steps
    for (const id of allocatedIds) expect(r.steps.map((s) => s.id)).not.toContain(id);
  });

  it('golden асценданси: Invoker-старт (мульти-source class+asc) == эталон', () => {
    const invokerStart = LAYOUT.ascStarts['Invoker']!;
    const sources = new Set<string>([MONK_START, invokerStart]);
    const r = treeRoute({ classStart: 'Monk', ascendancy: 'Invoker', targets: ['Faith is a Choice'] })!;
    const expected = refDistAtLeast(sources, resolveTreeTargets(['Faith is a Choice']).resolved[0]!.id)!;
    expect(r.totalPoints).toBe(expected);
    expect(r.unreachable).toEqual([]);
  });

  it('unreachable-изоляты layout не роняют роутер (недостижимая первой в pending)', () => {
    // 22 узла layout без единого ребра ('Unfettered', "Kaom's Blessing", …) —
    // раньше tie-break Infinity===Infinity читал pending[-1] → TypeError.
    const r = treeRoute({ classStart: 'Monk', targets: ['Unfettered', 'Chaos Inoculation'] })!;
    expect(r.unreachable).toEqual(['Unfettered']);
    expect(r.totalPoints).toBeGreaterThan(0);
    expect(r.steps.at(-1)!.name).toBe('Chaos Inoculation');
    // только изоляты: маршрута нет, но падения тоже нет
    const all = treeRoute({ classStart: 'Monk', targets: ['Unfettered', "Kaom's Blessing"] })!;
    expect(all.ok).toBe(false);
    expect(all.totalPoints).toBe(0);
    expect(new Set(all.unreachable)).toEqual(new Set(['Unfettered', "Kaom's Blessing"]));
    // каждый изолят действительно без рёбер — замок данных
    expect(G.adjacency.get(resolveTreeTargets(['Unfettered']).resolved[0]!.id)).toBeUndefined();
  });

  it('milestones: «взять к L~N» непротиворечиво порядку путей и формуле очков', () => {
    const r = treeRoute({ classStart: 'Monk', targets: ['Chaos Inoculation', 'Resolute Technique', 'Eldritch Battery'] })!;
    let prevLevel = 0;
    let prevCum = 0;
    for (const m of r.milestones) {
      expect(m.cumPoints).toBeGreaterThan(prevCum - 1); // кумулятив строго растёт
      expect(m.cumPoints).toBe(prevCum + m.legPoints);
      expect(m.takeByLevel!).not.toBeNull();
      // очков на этом уровне уже хватает… (≤ passivePointsAvailableAtLevel)
      expect(passivePointsAvailableAtLevel(m.takeByLevel!)).toBeGreaterThanOrEqual(m.cumPoints);
      // …а на уровень ниже — ещё нет (метка минимальна)
      if (m.takeByLevel! > 1) {
        expect(passivePointsAvailableAtLevel(m.takeByLevel! - 1)).toBeLessThan(m.cumPoints);
      }
      // метки неубывают вместе с порядком этапов
      expect(m.takeByLevel!).toBeGreaterThanOrEqual(prevLevel);
      prevLevel = m.takeByLevel!;
      prevCum = m.cumPoints;
      // шаги этапа непрерывны и заканчиваются целью
      const ids = m.steps.map((s) => s.id);
      if (ids.length) {
        for (let i = 1; i < ids.length; i++) expect(G.adjacency.get(ids[i - 1]!)).toContain(ids[i]);
        expect(ids.at(-1)).toBe(m.targetId);
      }
    }
  });
});
