/**
 * Полная карта дерева пассивок PoE2 «как в игре» (P2, web).
 *
 * В отличие от вкладки «Дерево» (#15), которая показывает только «взятые узлы»
 * конкретного билда, здесь рисуется ВСЯ карта: узлы общего дерева + деревья
 * асценданси, со связями между узлами и позициями точно как в игре.
 *
 * Возможности:
 *  - панорамирование (перетаскивание) + масштаб (колесо вокруг курсора / двойной клик);
 *  - связи между узлами (линии) с раскраской асценданси;
 *  - раскраска: обычные узлы нейтрально, узлы асценданси — цветом своей асценданси;
 *  - селектор класса: подсветить узлы асценданси выбранного класса, остальные приглушить;
 *  - клик по узлу → карточка с именем, типом, асценданси и статами;
 *  - легенда асценданси с их стартовыми точками.
 *
 * Данные — `packages/core/data/game/passive_tree/layout.json` (канонические
 * координаты + рёбра, экстракт из PathOfBuilding-PoE2 TreeData — та же разметка,
 * из которой PoB и игра рисуют дерево). Vite отдаёт ассетом (?url); лениво.
 */

import layoutUrl from '../../../packages/core/data/game/passive_tree/layout.json?url';
import skillsUrl from '../../../packages/core/data/game/passive_tree/assets/skills.webp?url';
import groupBgUrl from '../../../packages/core/data/game/passive_tree/assets/group-background.webp?url';

interface LayoutNode {
  name: string;
  stats: string[];
  asc: string;
  ks: boolean;
  not: boolean;
  x: number;
  y: number;
  /** Кадр в спрайт-листе skills.webp (официальный экспорт GGG). */
  ic?: [number, number, number, number];
}

interface Layout {
  metadata?: Record<string, unknown> & {
    skills?: { image: string; size: { w: number; h: number }; scale: number };
    ring?: { image: string; scale: number; size: { w: number; h: number }; frame: [number, number, number, number] };
  };
  nodes: Record<string, LayoutNode>;
  edges: (readonly (string | number)[])[];
  classStarts: Record<string, string>;
  ascStarts: Record<string, string>;
  ascClasses: Record<string, string>;
}

interface Node {
  id: string;
  name: string;
  stats: string[];
  ascendancy: string;
  isKeystone: boolean;
  isNotable: boolean;
  x: number;
  y: number;
  ic?: [number, number, number, number];
}

type Db = {
  nodes: Map<string, Node>;
  edges: (readonly (string | number)[])[];
  ascClasses: Record<string, string>;
  ascStarts: Record<string, string>;
  classStarts: Record<string, string>;
  skills?: NonNullable<Layout['metadata']>['skills'];
  ring?: NonNullable<Layout['metadata']>['ring'];
};
let dbPromise: Promise<Db> | null = null;

async function loadDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const r = await fetch(layoutUrl);
      if (!r.ok) throw new Error(`layout HTTP ${r.status}`);
      const raw = (await r.json()) as Layout;
      const nodes = new Map<string, Node>();
      for (const [id, n] of Object.entries(raw.nodes ?? {})) {
        if (!n?.name) continue;
        nodes.set(id, {
          id,
          name: n.name,
          stats: n.stats ?? [],
          ascendancy: n.asc ?? '',
          isKeystone: !!n.ks,
          isNotable: !!n.not,
          x: n.x,
          y: n.y,
          ic: n.ic ? [n.ic[0], n.ic[1], n.ic[2], n.ic[3]] : undefined,
        });
      }
      const edges: (readonly (string | number)[])[] = [];
      for (const pair of raw.edges ?? []) {
        const na = nodes.get(String(pair[0]));
        const nb = nodes.get(String(pair[1]));
        if (na && nb) edges.push([na.id, nb.id, ...pair.slice(2)]);
      }
      return {
        nodes,
        edges,
        ascClasses: raw.ascClasses ?? {},
        ascStarts: raw.ascStarts ?? {},
        classStarts: raw.classStarts ?? {},
        skills: raw.metadata?.skills,
        ring: raw.metadata?.ring,
      };
    })();
  }
  return dbPromise;
}

const escAttr = (s: string): string =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** Детерминированная палитра цветов асценданси (индекс по отсортированному реестру). */
const ASC_COLORS: string[] = [
  '#e05656', '#e09156', '#e0c956', '#9ed056', '#56d08e', '#56d0d0', '#568ed0',
  '#6a56d0', '#b056d0', '#d056a8', '#d0566e', '#8fbf5f', '#5fb7bf', '#bf8f5f',
  '#bf5fc0', '#5f90e0', '#c06080', '#a0d080', '#80a0d0', '#d0a050', '#50b0a0',
  '#c05090', '#60c0a0',
];

// Светлая читаемая палитра и размеры (под светлый фон канваса).
const NORMAL_COLOR = '#7e8fb3';
const EDGE_COLOR = '#8d9cbb';
const NORMAL_R = 3.6;
const ASC_R = 5.2;
const NOTABLE_R = 6.6;
const KEYSTONE_R = 9.5;
const START_R = 12;

function nodeRadius(n: Node): number {
  if (n.ascendancy) return ASC_R;
  if (n.isKeystone) return KEYSTONE_R;
  if (n.isNotable) return NOTABLE_R;
  return NORMAL_R;
}

/**
 * Отрисовать полную карту дерева в host (вкладка «Карта»).
 */
export async function renderFullMap(host: HTMLElement): Promise<void> {
  let db: Db;
  try {
    db = await loadDb();
  } catch (e) {
    host.innerHTML = `<p class="err">Не удалось загрузить данные дерева: ${escAttr(e instanceof Error ? e.message : String(e))}</p>`;
    return;
  }
  const nodes = [...db.nodes.values()];
  if (!nodes.length) {
    host.innerHTML = '<p class="err">Данные дерева пусты.</p>';
    return;
  }

  // Реестры из данных (не хардкод — дерево обновляется экстрактором).
  const ascNames = [...new Set(nodes.map((n) => n.ascendancy).filter(Boolean))].sort();
  const ascColor = (asc: string): string => {
    const i = ascNames.indexOf(asc);
    return i >= 0 ? ASC_COLORS[i % ASC_COLORS.length]! : '#99aabb';
  };
  const baseClasses = [...new Set(Object.values(db.ascClasses))].sort();
  const baseOf = (asc: string): string => db.ascClasses[asc] ?? '';

  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'tree-wrap';
  wrap.innerHTML = `
    <div class="tree-top">
      <span class="badge">Узлов: <b>${nodes.length}</b> · связей: <b>${db.edges.length}</b></span>
      <label class="tree-class-lbl" for="map-class" title="Подсветить узлы асценданси выбранного класса">Класс:</label>
      <select id="map-class" class="tree-class-select">
        <option value="">— Все классы —</option>
        ${baseClasses.map((c) => {
          const list = ascNames.filter((a) => baseOf(a) === c).join(', ');
          return `<option value="${escAttr(c)}">${escAttr(c)} (${escAttr(list)})</option>`;
        }).join('')}
      </select>
      <button type="button" class="btn-fit" title="Вписать карту">⟳ Вписать</button>
      <a class="btn-fit" href="https://poe2db.tw/us/passive-skill-tree/" target="_blank" rel="noopener noreferrer" title="Внешний планировщик с игровым видом карты (poe2db)">🗺 poe2db-планировщик ↗</a>
    </div>
    <details class="tree-legend" open>
      <summary>Легенда асценданси</summary>
      <ul class="tree-legend-list">
        <li><i style="background:${NORMAL_COLOR}"></i> обычное дерево</li>
        <li><i style="background:#7cc7ff"></i> notable</li>
        <li><i style="background:#e8b84a"></i> keystone</li>
        ${ascNames.map((a) => `<li><i style="background:${ascColor(a)}"></i> ${escAttr(a)}</li>`).join('')}
      </ul>
    </details>
    <div class="tree-body">
      <div class="tree-canvas map-canvas"></div>
      <aside class="tree-detail"><em>Кликни по узлу на карте, чтобы увидеть статы.</em></aside>
    </div>`;
  host.appendChild(wrap);

  const canvas = wrap.querySelector<HTMLDivElement>('.tree-canvas')!;
  const detail = wrap.querySelector<HTMLElement>('.tree-detail')!;
  const fitBtn = wrap.querySelector<HTMLButtonElement>('.btn-fit')!;
  const classSel = wrap.querySelector<HTMLSelectElement>('#map-class')!;

  // Границы всей карты.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tree-svg map-svg');
  svg.style.width = '100%';
  svg.style.height = '100%';
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(g);
  canvas.appendChild(svg);

  // ── Спрайты (официальный экспорт GGG). Отличить unique-кадр — чтобы не плодить defs.
  const skillsScale = db.skills?.scale && db.skills.scale > 0 ? db.skills.scale : 1;
  const atlasW = db.skills?.size?.w ?? 0;
  const atlasH = db.skills?.size?.h ?? 0;
  const frameKey = (f: number[]): string => f.join(',');
  const symbolOfFrame = new Map<string, string>();
  if (atlasW && atlasH && [...nodes.values()].some((n) => n.ic)) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    let i = 0;
    for (const n of nodes.values()) {
      if (!n.ic) continue;
      const key = frameKey(n.ic);
      if (symbolOfFrame.has(key)) continue;
      const id = `m-ic-${i++}`;
      const sym = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
      sym.setAttribute('id', id);
      sym.setAttribute('viewBox', `${n.ic[0]} ${n.ic[1]} ${n.ic[2]} ${n.ic[3]}`);
      const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      img.setAttribute('x', '0');
      img.setAttribute('y', '0');
      img.setAttribute('width', String(atlasW));
      img.setAttribute('height', String(atlasH));
      img.setAttribute('href', skillsUrl);
      sym.appendChild(img);
      defs.appendChild(sym);
      symbolOfFrame.set(key, id);
    }
    svg.insertBefore(defs, g);
  }
  const canIcons = symbolOfFrame.size > 0;
  /** Размер иконки в координатах дерева: кадр / масштаб атласа. */
  const iconSize = (f: number[]): number => Math.max(f[2], f[3]) / skillsScale;

  // ── Стартовые кольца классов (group-background.webp, официальный экспорт) ───
  if (db.ring && db.ring.frame && groupBgUrl) {
    const rf = db.ring.frame;
    const ringId = 'm-ring';
    const defs = svg.querySelector('defs') ?? (() => {
      const d = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svg.insertBefore(d, g);
      return d;
    })();
    const sym = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
    sym.setAttribute('id', ringId);
    sym.setAttribute('viewBox', `${rf[0]} ${rf[1]} ${rf[2]} ${rf[3]}`);
    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    img.setAttribute('x', '0');
    img.setAttribute('y', '0');
    img.setAttribute('width', String(db.ring.size?.w ?? rf[0] + rf[2]));
    img.setAttribute('height', String(db.ring.size?.h ?? rf[1] + rf[3]));
    img.setAttribute('href', groupBgUrl);
    sym.appendChild(img);
    defs.appendChild(sym);
    const ringScale = db.ring.scale && db.ring.scale > 0 ? db.ring.scale : 1;
    const size = rf[2] / ringScale;
    for (const id of Object.values(db.classStarts)) {
      const n = db.nodes.get(id);
      if (!n) continue;
      const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      u.setAttribute('href', `#${ringId}`);
      u.setAttribute('class', 'mring');
      u.setAttribute('x', String(n.x - size / 2));
      u.setAttribute('y', String(n.y - size / 2));
      u.setAttribute('width', String(size));
      u.setAttribute('height', String(size));
      g.appendChild(u);
    }
  }

  // ── Связи (под узлами): дуга по орбите, если обе точки на одной орбите
  //    (game-вид, как poe2db/игра), иначе прямая. Цвет — асценданси, если совпадает.
  const edgeEls: SVGGeometryElement[] = [];
  const arcD = (a: Node, b: Node, cxr: number, cyr: number, r: number, large: number, sweep: number): string =>
    `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} ${sweep} ${b.x} ${b.y}`;
  for (const raw of db.edges) {
    const a = db.nodes.get(String(raw[0]))!;
    const b = db.nodes.get(String(raw[1]))!;
    let el: SVGGeometryElement;
    if (raw.length >= 7) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', arcD(a, b, Number(raw[2]), Number(raw[3]), Number(raw[4]), Number(raw[5]), Number(raw[6])));
      el = p;
    } else {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(a.x));
      line.setAttribute('y1', String(a.y));
      line.setAttribute('x2', String(b.x));
      line.setAttribute('y2', String(b.y));
      el = line;
    }
    el.setAttribute('class', 'medge');
    if (a.ascendancy && a.ascendancy === b.ascendancy) {
      el.setAttribute('stroke', ascColor(a.ascendancy));
      el.setAttribute('data-asc', a.ascendancy);
    } else {
      el.setAttribute('stroke', EDGE_COLOR);
    }
    edgeEls.push(el);
    g.appendChild(el);
  }

  // ── Узлы ───────────────────────────────────────────────────────────────────
  const circles: Record<string, SVGCircleElement> = {};
  const nodeEls: Record<string, SVGElement> = {};
  const underEls: Record<string, SVGCircleElement> = {};
  // Иконки: [use, подложка, мировой размер, мин. экранный px] — apply()
  // держит size = max(world, minPx/(baseScale*k)): на дальнем зуме иконка
  // мирового размера перекрывает соседей (промежутки 32-42 юнитов), поэтому
  // там она клампится к точке ~4-7 px, как у poe2db.
  const iconEls: [SVGUseElement, SVGCircleElement, number, number, Node][] = [];
  // hit-круги: [el, мировой радиус] — apply() держит экранный радиус >= MIN_HIT_PX.
  const hitCircles: [SVGCircleElement, number][] = [];
  const MIN_HIT_PX = 6;
  // Подписи notable-узлов: показывать только на близком зуме (на дальнем — каша).
  const labelEls: SVGTextElement[] = [];
  for (const n of nodes) {
    const r = nodeRadius(n);
    const symId = n.ic && canIcons ? symbolOfFrame.get(frameKey(n.ic)) : undefined;
    if (symId) {
      const s = iconSize(n.ic!);
      const minPx = n.isKeystone ? 7 : n.isNotable ? 5 : 4;
      const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      u.setAttribute('href', `#${symId}`);
      u.setAttribute('class', 'tnode mnode mnode-icon');
      u.setAttribute('data-id', n.id);
      u.setAttribute('data-asc', n.ascendancy || '');
      iconEls.push([u, null!, s, minPx, n]);
      u.setAttribute('x', String(n.x - s / 2));
      u.setAttribute('y', String(n.y - s / 2));
      u.setAttribute('width', String(s));
      u.setAttribute('height', String(s));
      nodeEls[n.id] = u;
      g.appendChild(u);
      // Невидимый hit-круг поверх иконки: hit-testing <use> идёт только по
      // закрашенным пикселям спрайта (паддинги иконок «проваливают» клик),
      // плюс стартовые кольца перекрывают область. Круг ловит клики надёжно.
      const h = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      h.setAttribute('class', 'tnode mnode mhit');
      h.setAttribute('data-id', n.id);
      h.setAttribute('data-asc', n.ascendancy || '');
      h.setAttribute('cx', String(n.x));
      h.setAttribute('cy', String(n.y));
      hitCircles.push([h, s * 0.3]);
      h.setAttribute('r', String(s * 0.3));
      h.setAttribute('fill', 'none');
      g.appendChild(h);
      // Тонкая подложка-контур под иконкой: цвет preserved для фильтра/лёгенды.
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('class', 'mnode-under');
      c.setAttribute('data-id', n.id);
      c.setAttribute('cx', String(n.x));
      c.setAttribute('cy', String(n.y));
      c.setAttribute('r', String(s / 2));
      c.setAttribute('fill', 'none');
      c.setAttribute('stroke', n.ascendancy ? ascColor(n.ascendancy) : '#00000033');
      c.setAttribute('stroke-width', String(s / 14));
      underEls[n.id] = c;
      iconEls[iconEls.length - 1]![1] = c;
      g.insertBefore(c, u);
      if (n.isNotable && !n.ascendancy) {
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', String(n.x));
        t.setAttribute('y', String(n.y - s / 2 - 4));
        t.setAttribute('class', 'tnode-label');
        t.textContent = n.name;
        labelEls.push(t);
        g.appendChild(t);
      }
      continue;
    }
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('class', 'tnode mnode');
    c.setAttribute('data-id', n.id);
    c.setAttribute('data-asc', n.ascendancy || '');
    c.setAttribute('cx', String(n.x));
    c.setAttribute('cy', String(n.y));
    c.setAttribute('r', String(r));
    c.setAttribute('fill', n.ascendancy
      ? ascColor(n.ascendancy)
      : n.isKeystone ? '#e8b84a' : n.isNotable ? '#7cc7ff' : NORMAL_COLOR);
    c.setAttribute('stroke', '#00000077');
    c.setAttribute('stroke-width', '1.1');
    circles[n.id] = c;
    nodeEls[n.id] = c;
    g.appendChild(c);
    if (n.isNotable && !n.ascendancy) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', String(n.x));
      t.setAttribute('y', String(n.y - r - 3));
      t.setAttribute('class', 'tnode-label');
      t.textContent = n.name;
      labelEls.push(t);
      g.appendChild(t);
    }
  }
  // Стартовые точки асценданси — кольца.
  const startRingAsc: Record<string, string> = {};
  for (const [asc, id] of Object.entries(db.ascStarts)) {
    const n = db.nodes.get(id);
    const ringColor = n?.ascendancy ? ascColor(n.ascendancy) : ascColor(asc);
    startRingAsc[id] = asc;
    if (!n) continue;
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ring.setAttribute('class', 'mstart');
    ring.setAttribute('data-asc', asc);
    ring.setAttribute('cx', String(n.x));
    ring.setAttribute('cy', String(n.y));
    ring.setAttribute('r', String(START_R));
    ring.setAttribute('stroke', ringColor);
    ring.setAttribute('fill', 'none');
    g.appendChild(ring);
  }

  // ── Трансформация: вписать bbox + pan (tx,ty) + zoom (k) ────────────────────
  let tx = 0, ty = 0, k = 1;
  let baseScale = 1;

  function fit(): void {
    const W = canvas.clientWidth || 800;
    const H = canvas.clientHeight || 520;
    const pad = 60;
    baseScale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
    if (!Number.isFinite(baseScale) || baseScale <= 0) baseScale = 1;
    k = 1;
    tx = W / 2;
    ty = H / 2;
    apply();
  }

  function apply(): void {
    const tr = `translate(${tx} ${ty}) scale(${baseScale * k}) translate(${-cx} ${-cy})`;
    g.setAttribute('transform', tr);
    const sk = baseScale * k;
    // Иконки: экранный размер = max(мировой, мин. px) — на дальнем зуме
    // кламп к точке 4-7 px (иначе иконки перекрывают соседей: промежутки 32-42).
    for (const [u, c, s, minPx, n] of iconEls) {
      const eff = Math.max(s, minPx / sk);
      u.setAttribute('x', String(n.x - eff / 2));
      u.setAttribute('y', String(n.y - eff / 2));
      u.setAttribute('width', String(eff));
      u.setAttribute('height', String(eff));
      if (c) c.setAttribute('r', String(eff / 2));
    }
    // Гарантированный минимальный экранный размер hit-круга (кликабельность
    // на дальнем зуме, когда иконка < 1 px).
    const minR = MIN_HIT_PX / sk;
    for (const [el, r] of hitCircles) el.setAttribute('r', String(Math.max(r, minR)));
    // Подписи notable — только когда иконка ≥ ~12 px экрана (иначе каша);
    // шрифт держим экранным (обратный мировому масштаб), толщину — non-scaling.
    const labelsOn = sk * 68 >= 12;
    const cls = labelsOn ? 'tnode-label label-on' : 'tnode-label';
    const fs = String(13 / sk);
    for (const t of labelEls) {
      t.setAttribute('class', cls);
      t.setAttribute('font-size', fs);
    }
  }

  // ── Фильтр по классу ────────────────────────────────────────────────────────
  function applyClassFilter(selected: string): void {
    const active = new Set<string>();
    if (selected) {
      for (const asc of ascNames) if (baseOf(asc) === selected) active.add(asc);
    }
    for (const line of edgeEls) {
      const asc = line.getAttribute('data-asc');
      // inline style, не атрибут: CSS-правило .medge{opacity:.42} перебивает
      // presentation-атрибут, и фильтр визуально не работал.
      line.style.opacity = !selected || (asc && active.has(asc)) ? '' : '0.15';
    }
    for (const n of nodes) {
      const el = nodeEls[n.id];
      const under = underEls[n.id];
      const op = !selected
        ? '1'
        : n.ascendancy && active.has(n.ascendancy)
          ? '1'
          : !n.ascendancy
            ? '0.22'
            : '0.12';
      el?.setAttribute('opacity', op);
      under?.setAttribute('opacity', op);
    }
  }
  classSel.addEventListener('change', () => applyClassFilter(classSel.value));
  applyClassFilter('');

  // ── Pan перетаскиванием ────────────────────────────────────────────────────
  let dragging = false, lastX = 0, lastY = 0;
  svg.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('panning');
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    tx += e.clientX - lastX;
    ty += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    apply();
  });
  const endDrag = (e: PointerEvent) => {
    dragging = false;
    svg.classList.remove('panning');
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  // ── Zoom колесом вокруг курсора ─────────────────────────────────────────────
  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const k2 = Math.min(30, Math.max(0.05, k * factor));
      const sk = baseScale * k2;
      const s0 = baseScale * k;
      tx = mx - ((mx - tx) * sk) / s0;
      ty = my - ((my - ty) * sk) / s0;
      k = k2;
      apply();
    },
    { passive: false },
  );
  svg.addEventListener('dblclick', (e) => {
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = 1.6;
    const k2 = Math.min(30, k * factor);
    const sk = baseScale * k2;
    const s0 = baseScale * k;
    tx = mx - ((mx - tx) * sk) / s0;
    ty = my - ((my - ty) * sk) / s0;
    k = k2;
    apply();
  });

  // ── Клик → статы ────────────────────────────────────────────────────────────
  function showDetail(n: Node): void {
    const typeBadge = n.isKeystone ? 'keystone' : n.isNotable ? 'notable' : n.ascendancy ? 'ascendancy' : 'обычный';
    const stats = n.stats.length
      ? `<ul class="tstats">${n.stats.map((s) => `<li>${escAttr(s)}</li>`).join('')}</ul>`
      : '<p class="dim">Статы не указаны.</p>';
    detail.innerHTML = `
      <div class="tname">${escAttr(n.name)}</div>
      <div class="tbadges">
        <span class="pill">${typeBadge}</span>
        ${n.ascendancy ? `<span class="pill" style="color:${ascColor(n.ascendancy)}">${escAttr(n.ascendancy)}</span>` : ''}
        ${n.ascendancy ? `<span class="pill">${escAttr(baseOf(n.ascendancy))}</span>` : ''}
        ${startRingAsc[n.id] ? '<span class="pill">стартовая точка</span>' : '' }
        <span class="pill mono">#${n.id}</span>
      </div>
      ${stats}`;
  }
  svg.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<SVGElement>('.mnode');
    if (!el) return;
    const n = db.nodes.get(el.getAttribute('data-id') ?? '');
    if (n) showDetail(n);
  });

  fitBtn.addEventListener('click', fit);
  window.addEventListener('resize', fit);

  fit();
}
