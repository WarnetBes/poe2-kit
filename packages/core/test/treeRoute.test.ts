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
