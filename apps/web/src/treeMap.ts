/**
 * Интерактивная карта дерева пассивок PoE2 (P2 #15).
 *
 * Базовые данные — канонические файлы пакета core (без дублей):
 *   packages/core/data/game/passive_tree/numeric_ids.json — game node ID → {name, stats, …}
 *   packages/core/data/game/passive_tree/positions.json   — game node ID → [x, y]
 * Vite отдаёт их как отдельные ассеты (?url) и подставляет URL; здесь грузим лениво
 * через fetch (только когда пользователь открыл вкладку «Дерево»).
 *
 * Рендер: SVG. Все точки размещены в игровых координатах карты внутри одного
 * трансформируемого `<g>`; полотно ведёт себя как Google Maps — перетаскивание (pan)
 * и колесо (zoom вокруг курсора).
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

export interface TreeMapItem {
  id: string;
  name: string;
  stats: string[];
  ascendancy: string;
  isKeystone: boolean;
  isNotable: boolean;
  x: number;
  y: number;
}

type Db = { nodes: Map<string, NumericEntry>; pos: Map<string, [number, number]> };

let dbPromise: Promise<Db> | null = null;

/** Лениво загрузить numeric_ids + positions (казется кэшем). */
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

/** Резолв списка node ID в элементы карты + ненайденные. Дубликаты отбрасываются. */
export async function resolveTreeMapIds(ids: string[]): Promise<{ items: TreeMapItem[]; missing: string[]; total: number }> {
  const db = await loadDb();
  const seen = new Set<string>();
  const items: TreeMapItem[] = [];
  const missing: string[] = [];
  for (const raw of ids) {
    const id = String(raw).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const node = db.nodes.get(id);
    const p = db.pos.get(id);
    if (node && p) {
      items.push({
        id,
        name: node.name,
        stats: node.stats ?? [],
        ascendancy: node.ascendancy ?? '',
        isKeystone: !!node.is_keystone,
        isNotable: !!node.is_notable,
        x: p[0],
        y: p[1],
      });
    } else {
      missing.push(id);
    }
  }
  return { items, missing, total: ids.length };
}

const TYPE_COLORS = { keystone: '#f0b53a', notable: '#7cc7ff', normal: '#8fb7ff', asc: '#c9a4ff' };
const TYPE_R = { keystone: 9, notable: 6, normal: 3.5, asc: 6.5 };

function styleOf(it: TreeMapItem): { color: string; r: number } {
  if (it.isKeystone) return { color: TYPE_COLORS.keystone, r: TYPE_R.keystone };
  if (it.isNotable) return { color: TYPE_COLORS.notable, r: TYPE_R.notable };
  if (it.ascendancy) return { color: TYPE_COLORS.asc, r: TYPE_R.asc };
  return { color: TYPE_COLORS.normal, r: TYPE_R.normal };
}

const escAttr = (s: string): string =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/**
 * Отрисовать интерактивную карту в host: взятые узлы + клик → статы.
 */
export async function renderTreeMap(host: HTMLElement, ids: string[]): Promise<void> {
  let items: TreeMapItem[];
  let missing: string[];
  try {
    const r = await resolveTreeMapIds(ids);
    items = r.items;
    missing = r.missing;
  } catch (e) {
    host.innerHTML = `<p class="err">Не удалось загрузить данные дерева: ${escAttr(e instanceof Error ? e.message : String(e))}</p>`;
    return;
  }

  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'tree-wrap';
  wrap.innerHTML = `
    <div class="tree-top">
      <span class="badge">Узлов на карте: <b>${items.length}</b></span>
      ${missing.length ? `<span class="badge warn">не найдено: <b>${missing.length}</b></span>` : ''}
      <button type="button" class="btn-fit" title="Вписать карту">⟳ Вписать</button>
    </div>
    <div class="tree-body">
      <div class="tree-canvas"></div>
      <aside class="tree-detail"><em>Кликни по узлу на карте, чтобы увидеть статы.</em></aside>
    </div>`;
  host.appendChild(wrap);

  const canvas = wrap.querySelector<HTMLDivElement>('.tree-canvas')!;
  const detail = wrap.querySelector<HTMLElement>('.tree-detail')!;
  const fitBtn = wrap.querySelector<HTMLButtonElement>('.btn-fit')!;

  if (!items.length) {
    detail.innerHTML = '<em>Нет узлов с известными координатами.</em>';
    return;
  }

  // Границы выбранных узлов.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    if (it.x < minX) minX = it.x;
    if (it.y < minY) minY = it.y;
    if (it.x > maxX) maxX = it.x;
    if (it.y > maxY) maxY = it.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);

  // SVG и трансформируемая группа.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tree-svg');
  svg.style.width = '100%';
  svg.style.height = '100%';
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(g);
  canvas.appendChild(svg);

  // Рисуем «взятые» узлы плюс подписи-точки (цикл).
  for (const it of items) {
    const st = styleOf(it);
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('class', 'tnode');
    c.setAttribute('data-id', it.id);
    c.setAttribute('cx', String(it.x));
    c.setAttribute('cy', String(it.y));
    c.setAttribute('r', String(st.r));
    c.setAttribute('fill', st.color);
    if (it.isKeystone) c.setAttribute('stroke', '#fff8');
    g.appendChild(c);

    // Подпись-имя для key-/notable.
    if (it.isKeystone || it.isNotable) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', String(it.x));
      t.setAttribute('y', String(it.y - st.r - 3));
      t.setAttribute('class', 'tnode-label');
      t.textContent = it.name;
      g.appendChild(t);
    }
  }

  // ── Трансформация: вписать bbox + pan (tx,ty) + zoom (k) ────────────────────
  let tx = 0, ty = 0, k = 1;
  let baseScale = 1;

  function fit(): void {
    const W = canvas.clientWidth || 800;
    const H = canvas.clientHeight || 600;
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
      // Точка карты под курсором остаётся под курсором.
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
  function showDetail(it: TreeMapItem): void {
    const typeBadge = it.isKeystone ? 'keystone' : it.isNotable ? 'notable' : it.ascendancy ? 'ascendancy' : 'обычный';
    const stats = it.stats.length
      ? `<ul class="tstats">${it.stats.map((s) => `<li>${escAttr(s)}</li>`).join('')}</ul>`
      : '<p class="dim">Статы не указаны.</p>';
    detail.innerHTML = `
      <div class="tname">${escAttr(it.name)}</div>
      <div class="tbadges">
        <span class="pill">${typeBadge}</span>
        ${it.ascendancy ? `<span class="pill">${escAttr(it.ascendancy)}</span>` : ''}
        <span class="pill mono">#${it.id}</span>
      </div>
      ${stats}`;
  }
  svg.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<SVGElement>('.tnode');
    if (!el) return;
    const it = items.find((i) => i.id === el.getAttribute('data-id'));
    if (it) showDetail(it);
  });

  fitBtn.addEventListener('click', fit);
  window.addEventListener('resize', fit);

  fit();
}