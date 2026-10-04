/**
 * Вкладка «Атлас» (№215, web): SVG-карта древа атласа (atlas skills).
 *
 * Данные — `packages/core/data/game/atlas/atlas.json` (Vite ?url-ассет, как
 * layout.json в fullMap.ts): узлы (мировые координаты + CDN-иконки poe2db),
 * рёбра, корни и ветки механик (subtrees).
 *
 * Возможности (по образцу fullMap/planner):
 *  - SVG-рендер: pan (перетаскивание), zoom (колесо/двойной клик), «⟳ Вписать»;
 *  - рёбра — quadratic bezier; аллоцированные с двух концов — голубые (#5cc0ff);
 *  - узлы: circle + CDN-иконка (onerror → иконка скрыта, узел остаётся кружком);
 *    keystone крупнее notable, notable крупнее мелких; тонировка по ветке;
 *  - hover-тултип (имя + статы) + клик → карточка в side-панели;
 *  - аллокация кликом: только рядом с корнем/взятым узлом, бюджет 40 очков,
 *    клик по взятому — снятие (refund без ограничений);
 *  - persist: hash `#a=<ids>` (приоритетнее localStorage `poe2k.atlasPlan`
 *    при открытии); пересборка hash сохраняет прочие параметры (напр. `#p=`);
 *  - поиск по имени/id/статам (паттерн treeSearch, свой инпут).
 */

import atlasUrl from '../../../packages/core/data/game/atlas/atlas.json?url';
import layoutUrl from '../../../packages/core/data/game/passive_tree/layout.json?url';
import {
  aggregateStats,
  calcRowToHtml,
  foreignCalcs,
  hasCalc,
  mergeRows,
  publishCalc,
  publishCalcIfAbsent,
  subscribeCalc,
  tagRows,
} from './calcSummary';
import { setStatus } from './ui';

const STORE_KEY = 'poe2k.atlasPlan';

interface AtlasNode {
  id: string;
  name: string;
  ks: boolean;
  not: boolean;
  root: boolean;
  subtree: string;
  stats: string[];
  icon: string;
  x: number;
  y: number;
}

interface AtlasFile {
  version?: string;
  totalPoints?: number;
  roots?: (string | number)[];
  nodes?: Record<string, AtlasNode>;
  edges?: (readonly (string | number)[])[];
  subtrees?: Record<string, (string | number)[]>;
}

const esc = (s: string): string =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** Палитра веток (индекс по отсортированному реестру subtrees, как ASC_COLORS). */
const SUBTREE_COLORS: string[] = [
  '#e09156', '#56d0d0', '#9ed056', '#6a56d0', '#d056a8', '#e0c956', '#d0566e', '#568ed0',
];

let atlasRendered = false;
let planLoaded = false;

// ── hash / localStorage ─────────────────────────────────────────────────────

/** Идентификаторы из `#a=1,2,3` (числа, без мусора); null — параметра нет. */
function readHashIds(): number[] | null {
  const m = /(?:^|[#&])a=([^&]*)/.exec(location.hash);
  if (!m) return null;
  return decodeURIComponent(m[1])
    .split(',')
    .map(Number)
    .filter(Number.isInteger);
}

function readStoredIds(): number[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.map(Number).filter(Number.isInteger) : [];
  } catch {
    return [];
  }
}

function persist(ids: number[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

/** Пересобрать hash: заменить/убрать `a=`, сохранив прочие параметры (напр. `p=`). */
function syncHash(ids: number[]): void {
  const parts: string[] = [];
  for (const seg of location.hash.replace(/^#/, '').split('&')) {
    if (!seg || seg.startsWith('a=')) continue;
    parts.push(seg);
  }
  if (ids.length) parts.push(`a=${[...ids].sort((a, b) => a - b).join(',')}`);
  const base = `${location.pathname}${location.search}`;
  history.replaceState(null, '', parts.length ? `${base}#${parts.join('&')}` : base);
}

// ── рендер ──────────────────────────────────────────────────────────────────

export function renderAtlas(container: HTMLElement): void {
  if (atlasRendered) return;
  atlasRendered = true;
  void buildAtlas(container);
}

async function buildAtlas(container: HTMLElement): Promise<void> {
  let file: AtlasFile;
  try {
    const r = await fetch(atlasUrl);
    if (!r.ok) throw new Error(`atlas HTTP ${r.status}`);
    file = (await r.json()) as AtlasFile;
  } catch (e) {
    container.innerHTML = `<p class="err">Не удалось загрузить данные атласа: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
    return;
  }

  const nodes = new Map<number, AtlasNode>();
  for (const [k, n] of Object.entries(file.nodes ?? {})) {
    const id = Number(k);
    if (!Number.isInteger(id) || !n) continue;
    nodes.set(id, {
      id: n.id,
      name: n.name ?? '',
      ks: !!n.ks,
      not: !!n.not,
      root: !!n.root,
      subtree: n.subtree ?? '',
      stats: Array.isArray(n.stats) ? n.stats : [],
      icon: n.icon ?? '',
      x: n.x,
      y: n.y,
    });
  }
  const roots = new Set<number>((file.roots ?? []).map(Number).filter(Number.isInteger));
  const MAX_POINTS = Number.isInteger(file.totalPoints) && (file.totalPoints ?? 0) > 0
    ? (file.totalPoints as number)
    : 40;

  // Смежность (для правил аллокации).
  const adj = new Map<number, number[]>();
  for (const pair of file.edges ?? []) {
    const a = Number(pair[0]);
    const b = Number(pair[1]);
    if (!nodes.has(a) || !nodes.has(b) || a === b) continue;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }

  // Ветки механик: реестр из данных + детерминированная палитра.
  const subtreeNames = [...new Set([...nodes.values()].map((n) => n.subtree).filter(Boolean))].sort();
  const subtreeColor = (name: string): string => {
    const i = subtreeNames.indexOf(name);
    return i >= 0 ? SUBTREE_COLORS[i % SUBTREE_COLORS.length]! : '#8d9cbb';
  };

  // Нормализация координат: атласные мировые координаты (~±5500) непригодны
  // для кругов r=3.6 — приводим span к ~700 юнитам дерева fullMap.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes.values()) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const SCALE = 700 / Math.max(spanX, spanY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const wx = (n: AtlasNode): number => (n.x - cx) * SCALE;
  const wy = (n: AtlasNode): number => (n.y - cy) * SCALE;

  // ── разметка (панель по образцу fullMap) ───────────────────────────────────
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'tree-wrap';
  wrap.innerHTML = `
    <div class="tree-top">
      <span class="badge">Атлас: узлов <b>${nodes.size}</b> · связей: <b>${adj.size ? [...adj.values()].reduce((s, l) => s + l.length, 0) / 2 | 0 : 0}</b>${file.version ? ` · v${esc(file.version)}` : ''}</span>
      <div class="tree-search atlas-search">
        <input class="tree-search-input" type="text" placeholder="поиск узла атласа…" autocomplete="off" spellcheck="false">
        <div class="tree-search-drop" hidden></div>
      </div>
      <span class="plan-badge" title="Взято очков атласа: клик по узлу берёт/снимает очко">Очки: <b class="atlas-pts">0</b> / ${MAX_POINTS}</span>
      <button type="button" class="btn-fit atlas-fit" title="Вписать карту в окно">⟳ Вписать</button>
      <button type="button" class="btn-fit atlas-link" title="Скопировать ссылку с планом атласа — открывающий увидит ту же раскладку">🔗 Ссылка</button>
      <button type="button" class="btn-fit atlas-clear" title="Снять все взятые узлы атласа">🧹 Очистить</button>
    </div>
    <div class="tree-body">
      <div class="tree-canvas atlas-canvas">
        <div class="atlas-tip" hidden></div>
      </div>
      <aside class="tree-detail">
        <div class="atlas-calc" hidden><div class="atlas-calc-title">Сводка взятых умений <span class="atlas-calc-n"></span></div><ul class="atlas-calc-list"></ul></div>
        <div class="atlas-node-detail"><em>Клик по узлу — статы; клик берёт/снимает очко атласа.</em></div>
      </aside>
    </div>`;
  container.appendChild(wrap);

  const canvas = wrap.querySelector<HTMLDivElement>('.tree-canvas')!;
  const detail = wrap.querySelector<HTMLElement>('.atlas-node-detail')!;
  const tip = wrap.querySelector<HTMLElement>('.atlas-tip')!;
  const ptsBadge = wrap.querySelector<HTMLElement>('.atlas-pts')!;

  const SVGNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'tree-svg atlas-svg');
  svg.style.width = '100%';
  svg.style.height = '100%';
  const g = document.createElementNS(SVGNS, 'g');
  svg.appendChild(g);
  canvas.appendChild(svg);

  // ── рёбра: quadratic bezier (контроль = середина + перпендикуляр ~10%) ─────
  const edgeEls: [SVGPathElement, number, number][] = [];
  const seenEdges = new Set<string>();
  for (const pair of file.edges ?? []) {
    const a = Number(pair[0]);
    const b = Number(pair[1]);
    if (!nodes.has(a) || !nodes.has(b) || a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    const na = nodes.get(a)!;
    const nb = nodes.get(b)!;
    const x1 = wx(na), y1 = wy(na), x2 = wx(nb), y2 = wy(nb);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    // перпендикулярное смещение ~10% длины
    const qx = mx + (-dy / len) * len * 0.1;
    const qy = my + (dx / len) * len * 0.1;
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', `M ${x1} ${y1} Q ${qx} ${qy} ${x2} ${y2}`);
    p.setAttribute('class', 'aedge');
    edgeEls.push([p, a, b]);
    g.appendChild(p);
  }

  // ── узлы: circle + CDN-иконка; hit-круг поверх (клики по спрайту «проваливаются») ──
  const nodeR = (n: AtlasNode): number => (n.ks ? 9.5 : n.not ? 6.6 : n.root ? 6 : 3.6);
  const nodeEls = new Map<number, SVGElement[]>();
  const nodeFill = (n: AtlasNode): string =>
    n.ks ? '#e8b84a' : n.not ? '#7cc7ff' : n.root ? '#b8cf8a' : '#7e8fb3';

  for (const [id, n] of nodes) {
    const x = wx(n), y = wy(n);
    const r = nodeR(n);
    const els: SVGElement[] = [];
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('class', 'tnode anode');
    c.setAttribute('data-id', String(id));
    c.setAttribute('cx', String(x));
    c.setAttribute('cy', String(y));
    c.setAttribute('r', String(r));
    c.setAttribute('fill', nodeFill(n));
    const tint = n.subtree ? subtreeColor(n.subtree) : '#5b6472';
    c.setAttribute('stroke', tint);
    c.setAttribute('stroke-width', '1.1');
    els.push(c);
    g.appendChild(c);

    if (n.icon) {
      const s = nodeR(n) * 2.2; // размер иконки в юнитах сцены, пропорционально узлу (раньше был /SCALE — гигантские хиты перекрывали соседей)
      const img = document.createElementNS(SVGNS, 'image');
      img.setAttribute('class', 'anode-img');
      img.setAttribute('x', String(x - s / 2));
      img.setAttribute('y', String(y - s / 2));
      img.setAttribute('width', String(s));
      img.setAttribute('height', String(s));
      img.setAttribute('href', n.icon);
      img.addEventListener('error', () => {
        img.style.display = 'none';
      });
      els.push(img);
      g.appendChild(img);
      // невидимый hit-круг поверх иконки (клики по прозрачным пикселям спрайта)
      const h = document.createElementNS(SVGNS, 'circle');
      h.setAttribute('class', 'tnode anode mhit');
      h.setAttribute('data-id', String(id));
      h.setAttribute('cx', String(x));
      h.setAttribute('cy', String(y));
      h.setAttribute('r', String(r + 1.4)); // чуть больше визуального узла, но меньше половины межузлового расстояния
      h.setAttribute('fill', 'none');
      els.push(h);
      g.appendChild(h);
    }
    nodeEls.set(id, els);
  }

  // ── состояние: аллокация ───────────────────────────────────────────────────
  const allocated = new Set<number>();

  const restore = (): void => {
    if (planLoaded) return;
    planLoaded = true;
    const fromHash = readHashIds();
    const ids = fromHash ?? readStoredIds();
    for (const id of ids) {
      if (allocated.size >= MAX_POINTS) break;
      if (nodes.has(id)) allocated.add(id);
    }
    persist([...allocated]); // расшаренная ссылка переживает и localStorage
  };

  const applyAllocation = (): void => {
    for (const [p, a, b] of edgeEls) {
      p.classList.toggle('alloc', allocated.has(a) && allocated.has(b));
    }
    for (const [id, els] of nodeEls) {
      const on = allocated.has(id);
      for (const el of els) if (el.tagName !== 'image') el.classList.toggle('alloc', on);
    }
    svg.classList.toggle('afull', allocated.size >= MAX_POINTS);
    ptsBadge.textContent = String(allocated.size);
  };

  // ── калькулятор: суммарные модификаторы взятых узлов (общий модуль) ─────
  const calcBox = wrap.querySelector<HTMLElement>('.atlas-calc')!;
  const calcList = wrap.querySelector<HTMLUListElement>('.atlas-calc-list')!;
  const calcN = wrap.querySelector<HTMLElement>('.atlas-calc-n')!;

  /** Свои (атласные) агрегированные ряды — кэш, чтобы не пересчитывать на чужое событие. */
  let ownAtlasRows = aggregateStats([...allocated].map((id) => nodes.get(id)?.stats));

  const renderCalc = (): void => {
    const rest = foreignCalcs('atlas');
    const all = mergeRows([ownAtlasRows, ...rest.map((x) => x.rows)]);
    calcN.textContent = rest.length
      ? `(${[`Атлас: ${allocated.size}`, ...rest.map((x) => x.label)].join(' + ')})`
      : `(${allocated.size})`;
    calcBox.hidden = all.length === 0;
    calcList.innerHTML = all
      .slice(0, 50)
      .map((r) => calcRowToHtml(r, esc))
      .join('');
  };

  const updateCalc = (): void => {
    ownAtlasRows = tagRows('atlas', aggregateStats([...allocated].map((id) => nodes.get(id)?.stats)));
    publishCalc('atlas', ownAtlasRows, `Дерево атласа: ${allocated.size}`);
    renderCalc();
  };
  // чужой калькулятор (дерево пассивок) обновился — перерисовать объединённую сводку
  subscribeCalc((src) => {
    if (src !== 'atlas') renderCalc();
  });
  updateCalc();

  // lazy-bootstrap: дерево пассивок ещё не публиковалось (вкладка «Карты» не
  // открывалась) — агрегируем его план из localStorage прямо здесь.
  if (!hasCalc('passives')) {
    try {
      const stored = JSON.parse(localStorage.getItem('poe2k.plan') ?? 'null') as { n?: number[] } | null;
      const ids = stored?.n ?? [];
      if (ids.length) {
        void fetch(layoutUrl)
          .then((r) => r.json())
          .then((lay: { nodes?: Record<string, { stats?: string[] }> }) => {
            // вкладка карт успела открыться и опубликовать точные данные — не спорим
            if (hasCalc('passives')) return;
            const rows = tagRows('passives', aggregateStats(ids.map((id) => lay.nodes?.[String(id)]?.stats)));
            if (publishCalcIfAbsent('passives', rows, `Дерево пассивок: ${ids.length}`)) renderCalc();
          })
          .catch(() => undefined);
      }
    } catch {
      /* чужой localStorage кривой — игнорируем */
    }
  }

  const commit = (): void => {
    const ids = [...allocated];
    persist(ids);
    syncHash(ids);
    applyAllocation();
    updateCalc();
  };

  const reachable = (id: number): boolean => {
    const n = nodes.get(id);
    if (!n) return false;
    if (n.root) return true;
    for (const m of adj.get(id) ?? []) {
      if (allocated.has(m) || roots.has(m)) return true;
    }
    return false;
  };

  const showDetail = (id: number, hint = ''): void => {
    const n = nodes.get(id);
    if (!n) return;
    const type = n.ks ? 'keystone' : n.not ? 'notable' : n.root ? 'старт' : 'обычный';
    const stats = n.stats.length
      ? `<ul class="tstats">${n.stats.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`
      : '<p class="dim">Статы не указаны.</p>';
    const inPlan = allocated.has(id)
      ? '<p class="plan-mark ok">✅ Взято — клик снимет очко (refund)</p>'
      : allocated.size >= MAX_POINTS
        ? '<p class="plan-mark hint">Очки атласа закончились — сначала сними что-то</p>'
        : reachable(id)
          ? '<p class="plan-mark hint">Клик возьмёт узел в план</p>'
          : '<p class="plan-mark hint">Не смежен со стартом/взятыми — аллокация запрещена</p>';
    detail.innerHTML = `
      <div class="tname">${n.name ? esc(n.name) : `<span class="dim">(старт · #${id})</span>`}</div>
      <div class="tbadges">
        <span class="pill">${type}</span>
        ${n.subtree ? `<span class="pill" style="color:${subtreeColor(n.subtree)}">${esc(n.subtree)}</span>` : ''}
        ${n.root ? '<span class="pill">стартовая точка</span>' : ''}
        <span class="pill mono">#${id}</span>
        ${n.id ? `<span class="pill mono">${esc(n.id)}</span>` : ''}
      </div>
      ${stats}
      ${inPlan}
      ${hint ? `<p class="plan-mark hint">${esc(hint)}</p>` : ''}`;
  };

  // ── transform: fit + pan + zoom (механизм fullMap) ───────────────────────────
  let tx = 0, ty = 0, k = 1;
  let baseScale = 1;

  const apply = (): void => {
    g.setAttribute('transform', `translate(${tx} ${ty}) scale(${baseScale * k})`);
  };

  const fit = (): void => {
    const W = canvas.clientWidth || 800;
    const H = canvas.clientHeight || 520;
    const pad = 60;
    baseScale = Math.min((W - pad * 2) / (spanX * SCALE), (H - pad * 2) / (spanY * SCALE));
    if (!Number.isFinite(baseScale) || baseScale <= 0) baseScale = 1;
    k = 1;
    tx = W / 2;
    ty = H / 2;
    apply();
  };

  const focusAt = (x: number, y: number): void => {
    const W = canvas.clientWidth || 800;
    const H = canvas.clientHeight || 520;
    if (baseScale > 0) k = Math.min(30, Math.max(0.05, 1.6 / baseScale));
    const sk = baseScale * k;
    tx = W / 2 - sk * x;
    ty = H / 2 - sk * y;
    apply();
  };

  // ── пан/зум (pointer capture, колесо вокруг курсора, dblclick) ─────────────
  // ── пан/зум (pointer capture, dblclick) ──────────────
  let dragging = false, lastX = 0, lastY = 0;
  let downX = 0, downY = 0;
  let downTarget: Element | null = null;

  // ⚠️ click-event не годится: setPointerCapture на pointerdown перенаправляет его target на svg,
  // из-за чего делегирование closest('.anode') теряет узел. Клики разбираем сами на down/up паре.
  const nodeClick = (el: Element): void => {
    const holder = el.closest<SVGElement>('.anode');
    if (!holder) return;
    const id = Number(holder.getAttribute('data-id'));
    const n = nodes.get(id);
    if (!n) return;
    if (allocated.has(id)) {
      allocated.delete(id);
      commit();
      showDetail(id);
    } else if (allocated.size >= MAX_POINTS) {
      showDetail(id, 'Достигнут лимит очков атласа — сперва сними какое-то умение.');
    } else if (reachable(id)) {
      allocated.add(id);
      commit();
      showDetail(id);
      setStatus(`Атлас: взято ${allocated.size}/${MAX_POINTS} умений.`);
    } else {
      showDetail(id, 'Умение не связано со стартовой точкой и взятыми узлами.');
    }
  };

  svg.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = downX = e.clientX;
    lastY = downY = e.clientY;
    downTarget = e.target as Element;
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
  const endDrag = (e: PointerEvent): void => {
    dragging = false;
    svg.classList.remove('panning');
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    // клик = down/up в одной точке (< 4 px); цель берём с pointerdown, до capture
    if (Math.hypot(e.clientX - downX, e.clientY - downY) <= 4 && downTarget) nodeClick(downTarget);
    downTarget = null;
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

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
    const k2 = Math.min(30, k * 1.6);
    const sk = baseScale * k2;
    const s0 = baseScale * k;
    tx = mx - ((mx - tx) * sk) / s0;
    ty = my - ((my - ty) * sk) / s0;
    k = k2;
    apply();
  });

  // ── hover-тултип: имя + статы ───────────────────────────────────────────────
  const moveTip = (e: PointerEvent): void => {
    const el = (e.target as Element).closest<SVGElement>('.anode');
    const id = el ? Number(el.getAttribute('data-id')) : NaN;
    const n = Number.isInteger(id) ? nodes.get(id) : undefined;
    if (!n) {
      tip.hidden = true;
      return;
    }
    const title = n.name ? esc(n.name) : `Старт #${id}`;
    const stats = n.stats.map((s) => `<div class="atlas-tip-stat">${esc(s)}</div>`).join('');
    tip.innerHTML = `<div class="atlas-tip-name">${title}</div>${stats}`;
    tip.hidden = false;
    const rect = canvas.getBoundingClientRect();
    let left = e.clientX - rect.left + 14;
    let top = e.clientY - rect.top + 14;
    const maxLeft = rect.width - tip.offsetWidth - 8;
    const maxTop = rect.height - tip.offsetHeight - 8;
    if (left > maxLeft) left = Math.max(8, maxLeft);
    if (top > maxTop) top = Math.max(8, maxTop);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  svg.addEventListener('pointermove', moveTip);
  svg.addEventListener('pointerleave', () => {
    tip.hidden = true;
  });

  // ── тулбар ────────────────────────────────────────────────────────────────
  wrap.querySelector<HTMLButtonElement>('.atlas-fit')!.addEventListener('click', fit);
  window.addEventListener('resize', () => fit());

  wrap.querySelector<HTMLButtonElement>('.atlas-link')!.addEventListener('click', async () => {
    syncHash([...allocated]); // адрес всегда актуален
    const url = location.href;
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, url.length);
        ok = document.execCommand('copy');
        ta.remove();
      } catch {
        ok = false;
      }
    }
    setStatus(ok ? 'Ссылка на план атласа скопирована.' : 'Не удалось скопировать — адрес в строке браузера.');
  });

  wrap.querySelector<HTMLButtonElement>('.atlas-clear')!.addEventListener('click', () => {
    allocated.clear();
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
    syncHash([]); // снимает только `a=`, прочие параметры (напр. `p=`) не трогаем
    applyAllocation();
    detail.innerHTML = '<em>План атласа очищен. Клик по узлу — статы и аллокация.</em>';
    setStatus('План атласа очищен.');
  });

  // ── поиск (паттерн treeSearch: индекс + дропдаун, фокус + метка) ────────────
  {
    const searchWrap = wrap.querySelector<HTMLElement>('.atlas-search')!;
    const input = searchWrap.querySelector<HTMLInputElement>('.tree-search-input')!;
    const drop = searchWrap.querySelector<HTMLElement>('.tree-search-drop')!;

    interface Hit { id: number; n: AtlasNode; rank: number }
    const idx: Hit[] = [];
    for (const [id, n] of nodes) {
      if (!n.name) continue;
      idx.push({ id, n, rank: 0 });
    }
    const hay = new Map<number, string>();
    for (const h of idx) {
      hay.set(h.id, `${h.n.name}\n#${h.id}\n${h.n.id}\n${h.n.stats.join('\n')}`.toLowerCase());
    }

    const hideDrop = (): void => {
      drop.hidden = true;
      drop.innerHTML = '';
    };

    let marked = '';
    const markNode = (id: number): void => {
      nodeEls.get(Number(marked))?.forEach((el) => el.classList.remove('mfocus'));
      marked = String(id);
      nodeEls.get(id)?.forEach((el) => {
        if (el.tagName !== 'image') el.classList.add('mfocus');
      });
    };

    const focusHit = (h: Hit): void => {
      markNode(h.id);
      focusAt(wx(h.n), wy(h.n));
      showDetail(h.id);
    };

    const search = (): void => {
      const q = input.value.trim().toLowerCase();
      if (!q) {
        hideDrop();
        return;
      }
      const hits: Hit[] = [];
      for (const h of idx) {
        const hayStr = hay.get(h.id)!;
        const posName = h.n.name.toLowerCase().indexOf(q);
        if (posName >= 0) h.rank = posName === 0 ? 0 : 1;
        else if (hayStr.includes(q)) h.rank = 2;
        else continue;
        hits.push(h);
      }
      hits.sort((a, b) => a.rank - b.rank || a.n.name.length - b.n.name.length);
      const shown = hits.slice(0, 30);
      if (!shown.length) {
        drop.hidden = false;
        drop.innerHTML = '<div class="tree-search-note">ничего не найдено</div>';
        return;
      }
      const extra = hits.length > shown.length ? `<div class="tree-search-note">…и ещё ${hits.length - shown.length}</div>` : '';
      drop.hidden = false;
      drop.innerHTML =
        shown
          .map(
            (h) => `
        <button type="button" class="tree-search-item" data-id="${h.id}">
          <span class="tree-search-name">${esc(h.n.name)}</span>
          <span class="tree-search-type">${h.n.ks ? 'keystone' : h.n.not ? 'notable' : h.n.subtree || 'обычный'} · #${h.id}</span>
        </button>`,
          )
          .join('') + extra;
    };

    input.addEventListener('input', search);
    input.addEventListener('focus', search);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.blur();
        hideDrop();
      }
    });
    searchWrap.addEventListener('focusout', (e) => {
      if (!searchWrap.contains(e.relatedTarget as Node | null)) hideDrop();
    });
    drop.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const btn = (e.target as Element).closest<HTMLElement>('.tree-search-item');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      const h = idx.find((x) => x.id === id);
      if (h) focusHit(h);
    });
  }

  // ── инициализация ─────────────────────────────────────────────────────────
  restore();
  applyAllocation();
  updateCalc();
  fit();
}

// ── вкладка: lazy-рендер при первом открытии (образец — панель map) ───────────

export function initAtlasTab(): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-tab="atlas"]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const out = document.querySelector<HTMLElement>('#out-atlas');
    if (out) renderAtlas(out);
  });
}
