/**
 * Полная карта дерева пассивок PoE2 «как в игре» (P2, web).
 *
 * В отличие от вкладки «Дерево» (#15), которая показывает только «взятые узлы»
 * конкретного билда, здесь рисуется ВСЯ карта: 4118 узлов (3780 обычного общего
 * дерева + 338 узлов асценданси по 17 асцендансам), у каждого есть имя и статы.
 *
 * Возможности:
 *  - панорамирование (перетаскивание) + масштаб (колесо вокруг курсора / двойной клик);
 *  - раскраска: обычные узлы нейтрально, узлы асценданси — цветом своей асценданси;
 *  - селектор класса: подсветить узлы асценданси выбранного класса (+ стартовая точка),
 *    остальные приглушить; «Все классы» — показать всё;
 *  - клик по узлу → карточка с именем, типом, асценданси и статами;
 *  - легенда асценданси с их стартовыми точками.
 *
 * Данные — канонические файлы пакета core (без дублей), Vite отдаёт их отдельными
 * ассетами (?url); грузим лениво через fetch — только когда пользователь открыл вкладку.
 */

import numericUrl from '../../../packages/core/data/game/passive_tree/numeric_ids.json?url';
import positionsUrl from '../../../packages/core/data/game/passive_tree/positions.json?url';

interface NumericEntry {
  name: string;
  stats: string[];
  ascendancy: string;
  is_keystone?: boolean;
  is_notable?: boolean;
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
}

/** Асценданси, у которых есть узлы с координатами в positions.json (17). */
const POSITIONED_ASCENDANCIES = [
  'Titan', 'Warbringer', 'Smith of Kitava',
  'Deadeye', 'Pathfinder',
  'Amazon', 'Ritualist',
  'Infernalist', 'Blood Mage', 'Lich',
  'Stormweaver', 'Chronomancer',
  'Tactician', 'Witchhunter', 'Gemling Legionnaire',
  'Invoker', 'Acolyte of Chayula',
] as const;

/** Маппинг асценданси → базовый класс (по ascendancies.json; только те, что есть на карте). */
const ASC_BASE_CLASS: Record<string, string> = {
  Titan: 'Warrior', Warbringer: 'Warrior', 'Smith of Kitava': 'Warrior',
  Deadeye: 'Ranger', Pathfinder: 'Ranger',
  Amazon: 'Huntress', Ritualist: 'Huntress',
  Infernalist: 'Witch', 'Blood Mage': 'Witch', Lich: 'Witch',
  Stormweaver: 'Sorceress', Chronomancer: 'Sorceress',
  Tactician: 'Mercenary', Witchhunter: 'Mercenary', 'Gemling Legionnaire': 'Mercenary',
  Invoker: 'Monk', 'Acolyte of Chayula': 'Monk',
};

/** Порядок классов в селекторе. */
const BASE_CLASSES = [
  'Warrior', 'Ranger', 'Huntress', 'Witch',
  'Sorceress', 'Mercenary', 'Monk',
] as const;

/** Стартовые точки асценданси: номер узла → асценданси (найдены в positions.json). */
const ASC_START_NODE: Record<number, string> = {
  74: 'Acolyte of Chayula', 1583: 'Pathfinder', 5852: 'Smith of Kitava', 7120: 'Witchhunter',
  9994: 'Invoker', 22147: 'Chronomancer', 23710: 'Lich', 32534: 'Titan', 32699: 'Infernalist',
  33812: 'Warbringer', 36252: 'Tactician', 36365: 'Ritualist', 41736: 'Amazon', 46990: 'Deadeye',
  59822: 'Blood Mage',
};

/** Детерминированная палитра цветов асценданси (индекс по реестру). */
const ASC_COLORS: string[] = [
  '#e05656', '#e09156', '#e0c956', '#9ed056', '#56d08e', '#56d0d0', '#568ed0',
  '#6a56d0', '#b056d0', '#d056a8', '#d0566e', '#8fbf5f', '#5fb7bf', '#bf8f5f',
  '#bf5fc0', '#5f90e0', '#c06080',
];
const ASC_ORDER: string[] = [...POSITIONED_ASCENDANCIES];
const ascColor = (asc: string): string => {
  const i = ASC_ORDER.indexOf(asc);
  return i >= 0 ? ASC_COLORS[i % ASC_COLORS.length]! : '#99aabb';
};

type Db = { nodes: Map<string, NumericEntry>; pos: Map<string, [number, number]> };
let dbPromise: Promise<Db> | null = null;

async function loadDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const [nodesRaw, posRaw] = await Promise.all([
        fetch(numericUrl).then((r) => {
          if (!r.ok) throw new Error(`numeric_ids HTTP ${r.status}`);
          return r.json() as Promise<{ nodes?: Record<string, NumericEntry> }>;
        }),
        fetch(positionsUrl).then((r) => {
          if (!r.ok) throw new Error(`positions HTTP ${r.status}`);
          return r.json() as Promise<{ positions?: Record<string, [number, number]> }>;
        }),
      ]);
      const nodes = new Map<string, NumericEntry>();
      for (const [id, n] of Object.entries(nodesRaw.nodes ?? {})) if (n?.name) nodes.set(id, n);
      const pos = new Map<string, [number, number]>();
      for (const [id, p] of Object.entries(posRaw.positions ?? {})) {
        if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) pos.set(id, [p[0], p[1]]);
      }
      return { nodes, pos };
    })();
  }
  return dbPromise;
}

const escAttr = (s: string): string =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** Получить все узлы карты (с координатами). */
async function allNodes(): Promise<Node[]> {
  const db = await loadDb();
  const out: Node[] = [];
  for (const [id, n] of db.nodes) {
    const p = db.pos.get(id);
    if (!p) continue;
    out.push({
      id,
      name: n.name,
      stats: n.stats ?? [],
      ascendancy: n.ascendancy ?? '',
      isKeystone: !!n.is_keystone,
      isNotable: !!n.is_notable,
      x: p[0],
      y: p[1],
    });
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}

// Светлая читаемая палитра и увеличенные размеры (под светлый фон канваса).
const NORMAL_COLOR = '#6a7894';
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

function nodeColor(n: Node): string {
  if (n.ascendancy) return ascColor(n.ascendancy);
  if (n.isKeystone) return '#c07a0a';
  if (n.isNotable) return '#1f7fd6';
  return NORMAL_COLOR;
}

/**
 * Отрисовать полную карту дерева в host (вкладка «Карта»).
 */
export async function renderFullMap(host: HTMLElement): Promise<void> {
  let nodes: Node[];
  try {
    nodes = await allNodes();
  } catch (e) {
    host.innerHTML = `<p class="err">Не удалось загрузить данные дерева: ${escAttr(e instanceof Error ? e.message : String(e))}</p>`;
    return;
  }

  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'tree-wrap';
  wrap.innerHTML = `
    <div class="tree-top">
      <span class="badge">Узлов на карте: <b>${nodes.length}</b></span>
      <label class="tree-class-lbl" for="map-class" title="Подсветить узлы асценданси выбранного класса">Класс:</label>
      <select id="map-class" class="tree-class-select">
        <option value="">— Все классы —</option>
        ${BASE_CLASSES.map((c) => {
          const list = Object.entries(ASC_BASE_CLASS).filter(([, b]) => b === c).map(([a]) => a);
          return `<option value="${escAttr(c)}">${escAttr(c)} (${list.join(', ')})</option>`;
        }).join('')}
      </select>
      <button type="button" class="btn-fit" title="Вписать карту">⟳ Вписать</button>
    </div>
    <details class="tree-legend" open>
      <summary>Легенда асценданси</summary>
      <ul class="tree-legend-list">
        <li><i style="background:${NORMAL_COLOR}"></i> обычное дерево</li>
        <li><i style="background:#1f7fd6"></i> notable</li>
        <li><i style="background:#c07a0a"></i> keystone</li>
        ${POSITIONED_ASCENDANCIES.map((a) => `<li><i style="background:${ascColor(a)}"></i> ${escAttr(a)}</li>`).join('')}
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

  // Все узлы — один проход (готовим кружки и кольца стартов).
  const circles: Record<string, SVGCircleElement> = {};
  for (const n of nodes) {
    const r = nodeRadius(n);
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('class', 'tnode mnode');
    c.setAttribute('data-id', n.id);
    c.setAttribute('data-asc', n.ascendancy || '');
    c.setAttribute('cx', String(n.x));
    c.setAttribute('cy', String(n.y));
    c.setAttribute('r', String(r));
    c.setAttribute('fill', nodeColor(n));
    if (n.isKeystone || n.ascendancy) c.setAttribute('stroke', '#00000055');
    c.setAttribute('stroke-width', '1.2');
    circles[n.id] = c;
    g.appendChild(c);
    if (n.isNotable && !n.ascendancy) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', String(n.x));
      t.setAttribute('y', String(n.y - r - 3));
      t.setAttribute('class', 'tnode-label');
      t.textContent = n.name;
      g.appendChild(t);
    }
  }
  // Отметить стартовые точки асценданси кольцом.
  for (const [id, asc] of Object.entries(ASC_START_NODE)) {
    const c = circles[id];
    if (c) {
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('class', 'mstart');
      ring.setAttribute('data-asc', asc);
      ring.setAttribute('cx', c.getAttribute('cx')!);
      ring.setAttribute('cy', c.getAttribute('cy')!);
      ring.setAttribute('r', String(START_R));
      g.appendChild(ring);
    }
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
  }

  // ── Фильтр по классу: подсветить узлы асценданси выбранного класса ─────────
  function applyClassFilter(selected: string): void {
    const active = new Set<string>();
    if (selected) {
      for (const [asc, base] of Object.entries(ASC_BASE_CLASS)) {
        if (base === selected) active.add(asc);
      }
    }
    for (const n of nodes) {
      const c = circles[n.id];
      if (!c) continue;
      if (!selected) {
        c.setAttribute('opacity', '1');
        c.setAttribute('fill', nodeColor(n));
      } else if (n.ascendancy && active.has(n.ascendancy)) {
        c.setAttribute('opacity', '1');
        c.setAttribute('fill', ascColor(n.ascendancy));
      } else if (!n.ascendancy) {
        c.setAttribute('opacity', '0.22');
        c.setAttribute('fill', nodeColor(n));
      } else {
        c.setAttribute('opacity', '0.12');
        c.setAttribute('fill', nodeColor(n));
      }
    }
  }
  classSel.addEventListener('change', () => applyClassFilter(classSel.value));
  applyClassFilter('');

  // ── Pan перетаскиванием ─────────────────────────────────────────────────────
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
        ${n.ascendancy ? `<span class="pill">${escAttr(ASC_BASE_CLASS[n.ascendancy] ?? '')}</span>` : ''}
        <span class="pill mono">#${n.id}</span>
      </div>
      ${stats}`;
  }
  svg.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<SVGElement>('.mnode');
    if (!el) return;
    const n = nodes.find((x) => x.id === el.getAttribute('data-id'));
    if (n) showDetail(n);
  });

  fitBtn.addEventListener('click', fit);
  window.addEventListener('resize', fit);

  fit();
}