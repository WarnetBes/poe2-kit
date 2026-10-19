/**
 * Вкладка «Курсы валют» (econ): полная таблица курсов + тренды poe.ninja
 * + деталь по клику: почасовая цена/объём и дневные свечи poe2scout.
 *
 * «Мозги» core (все — уже верифицированные бесплатные API):
 *  - fetchBestCurrencyRates — best-of курсы (poe2scout + poe.ninja), chaos+divine;
 *  - fetchCurrencyHistory — poe.ninja exchange overview: totalChange (%, окно)
 *    ⚠️ sparkline-«история» — изменения, а не абсолютные цены (см. types.ts:37-55);
 *  - fetchScoutApiIds + matchScoutApiId + fetchScoutPriceHistory — почасовые логи
 *    (цена в базовой валюте лиги — exalted + объём как мера ликвидности);
 *  - fetchScoutDailyStats — дневные OHLC-свечи.
 *
 * UI: поиск, сортировка (chaos/divine/имя/тренд), клик по строке → деталь,
 * «🔄 Обновить» (clearScoutCache — у core свои TTL-кэши, это форс-сброс).
 * Никаких ₽: только игровые валюты (chaos/divine/exalted).
 */

import { core, setStatus } from './ui';
import type { CurrencyRate } from '@poe2-kit/core';

/** Манифест скачанных иконок валют (norm→true), как item_index уника. */
let currencyIconMap: Record<string, boolean> = { map: {} as never } as Record<string, boolean>;
let currencyIconLoaded = false;
async function ensureCurrencyIcons(): Promise<Record<string, boolean>> {
  if (currencyIconLoaded) return currencyIconMap;
  currencyIconLoaded = true;
  try {
    const base = import.meta.env.BASE_URL ?? '/';
    const raw = (await fetch(base + 'datasets/currency_index.json').then((r) => r.json())) as {
      map?: Record<string, boolean>;
    };
    currencyIconMap = raw.map ?? {};
  } catch {
    currencyIconMap = {};
  }
  return currencyIconMap;
}

const curFileKey = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/gu, '');

/** Иконка валюты (poe2db, GGG-арт) с жетон-фолбэком: img поверх жетона, onerror — снять img. */
function curIconHtml(name: string, map: Record<string, boolean>): string {
  const key = curFileKey(name);
  const tok = `<span class="cur-tok" aria-hidden="true">${name.slice(0, 2).toUpperCase()}</span>`;
  if (!map[key]) return `<span class="cur-icoWrap" title="${esc(name)}">${tok}</span>`;
  const base = import.meta.env.BASE_URL ?? '/';
  return `<span class="cur-icoWrap" title="${esc(name)}">${tok}<img class="cur-ico" src="${base}datasets/currency_icons/${esc(key)}.webp" onerror="this.onerror=null;this.src=this.src.replace(/\\.webp$/,'.png')" alt="" loading="lazy" /></span>`;
}

function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function fmtNum(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v >= 1000) return v.toFixed(0);
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(2);
  return v.toFixed(4);
}

/** Локальный UI-курсор: последняя валюта, чей detail открыт (переживает re-render списка). */
let selectedName: string | null = null;

interface TrendMap {
  change: number | null;
}

async function loadTrends(league: string | undefined): Promise<Map<string, TrendMap>> {
  const m = new Map<string, TrendMap>();
  try {
    const hist = await core.trade.fetchCurrencyHistory(league);
    for (const h of hist) {
      if (h.name) m.set(h.name.trim().toLowerCase(), { change: h.totalChange });
    }
  } catch {
    /* poe.ninja exchange недоступен — просто без колонки тренда */
  }
  return m;
}

function rowHtml(r: CurrencyRate, trend: TrendMap | undefined, icons: Record<string, boolean>): string {
  const ch = trend?.change;
  const chCell =
    ch == null
      ? '<td class="num dim">—</td>'
      : `<td class="num ${ch >= 0 ? 'cur-up' : 'cur-down'}">${ch >= 0 ? '▲ +' : '▼ '}${ch.toFixed(1)}%</td>`;
  const active = selectedName && r.name.toLowerCase() === selectedName.toLowerCase() ? ' cur-sel' : '';
  return `<tr data-cur="${esc(r.name)}" class="cur-row${active}"><td>${curIconHtml(r.name, icons)} ${esc(r.name)}</td><td class="num">${fmtNum(r.chaosValue)}</td><td class="num">${fmtNum(r.divineValue)}</td>${chCell}</tr>`;
}

/** Мини-график: линия почасовой цены + бары объёма. SVG, без внешних либ. */
function sparkSvg(
  pts: Array<{ price: number; quantity: number }>,
  opts: { w?: number; h?: number } = {},
): string {
  if (!pts.length) return '<em class="dim">Нет точек истории.</em>';
  const W = opts.w ?? 620;
  const H = opts.h ?? 150;
  const GAP = 26; // нижняя зона под бары объёма
  const prices = pts.map((p) => p.price);
  const qs = pts.map((p) => p.quantity);
  const pMin = Math.min(...prices);
  const pMax = Math.max(...prices);
  const qMax = Math.max(...qs, 1);
  const pRange = pMax - pMin || 1;
  const x = (i: number): number => (pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W);
  const y = (p: number): number => H - GAP - ((p - pMin) / pRange) * (H - GAP - 8) - 4;
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
  const bars = pts
    .map((p, i) => {
      const bw = Math.max(1.5, W / pts.length / 3);
      const bh = (p.quantity / qMax) * (GAP - 6);
      return `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${(H - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" class="cur-vol"/>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="cur-svg" role="img" aria-label="История цены">
    <line x1="0" y1="${y(pMin)}" x2="${W}" y2="${y(pMin)}" class="cur-axis"/>
    <text x="2" y="${y(pMax) - 2}" class="cur-lbl">${fmtNum(pMax)}</text>
    <text x="2" y="${(H - GAP + 11).toFixed(0)}" class="cur-lbl">объём/час, max ${fmtNum(qMax)}</text>
    ${bars}<path d="${line}" class="cur-line"/>
  </svg>`;
}

async function renderDetail(name: string, box: HTMLElement): Promise<void> {
  box.innerHTML = '<em class="dim">Загружаю историю poe2scout…</em>';
  const league = core.trade.getLeague() ?? undefined;
  try {
    const ids = await core.trade.fetchScoutApiIds(league);
    const apiId = core.trade.matchScoutApiId(name, ids.keys());
    if (!apiId) {
      box.innerHTML = `<p class="hint">История для «${esc(name)}» не найдена в poe2scout (нет ApiId-матча). Курсы — в таблице выше.</p>`;
      return;
    }
    const [points, daily] = await Promise.all([
      core.trade.fetchScoutPriceHistory(apiId, { league, logCount: 48 }).catch(() => null),
      core.trade.fetchScoutDailyStats(apiId, { league, dayCount: 14 }).catch(() => null),
    ]);
    const pts = points ?? [];
    const days = daily ?? [];
    const last = pts.length ? pts[pts.length - 1] : null;
    const maxQ = Math.max(0, ...pts.map((p) => p.quantity));
    const avgQ = pts.length ? pts.reduce((a, p) => a + p.quantity, 0) / pts.length : 0;
    box.innerHTML = `
      <div class="cur-detail-card">
        <div class="cur-detail-head">📈 ${esc(name)}
          <span class="dim">· poe2scout ApiId: ${esc(apiId)}</span>
          ${last ? `<span class="dim">· последняя точка: ${esc(last.time)}</span>` : ''}
        </div>
        <p class="hint">Почасовые логи (48 ч): цена в базовой валюте лиги (exalted) + объём/час как мера ликвидности.</p>
        ${sparkSvg(pts.map((p) => ({ price: p.price, quantity: p.quantity })))}
        <div class="cur-detail-stats">Ликвидность: пик ${fmtNum(maxQ)} · средняя ${fmtNum(avgQ)} экз./час</div>
        ${days.length ? `<p class="hint">Дневные свечи (14 д., close): ${days.map((d) => fmtNum(d.close)).join(' → ')}</p>` : ''}
      </div>`;
  } catch (e) {
    box.innerHTML = `<p class="err">Ошибка истории: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
  }
}

export async function renderCurrencyTab(): Promise<void> {
  const el = document.getElementById('out-currency');
  if (!el) throw new Error('missing #out-currency');
  const league = core.trade.getLeague() ?? undefined;
  el.innerHTML = '<em>Загрузка курсов…</em>';
  setStatus(`Запрос курсов (лига «${league ?? '—'}»)…`);
  try {
    const [rates, trends, icons] = await Promise.all([
      core.trade.fetchBestCurrencyRates(league),
      loadTrends(league),
      ensureCurrencyIcons(),
    ]);
    const usable = rates.filter((r) => r.chaosValue != null || r.divineValue != null);
    if (!usable.length) {
      el.innerHTML = '<p class="err">Нет данных о валютах. Проверь сеть/лигу.</p>';
      setStatus('Нет данных.');
      return;
    }
    const savedSel = selectedName;
    el.innerHTML = `
      <div class="cur-toolbar">
        <input id="cur-search" class="cur-search" type="search" placeholder="🔍 поиск валюты…" autocomplete="off">
        <select id="cur-sort" class="cur-sort" title="Сортировка">
          <option value="chaos-desc">chaos ↓ (дорогие сверху)</option>
          <option value="chaos-asc">chaos ↑ (дешёвые сверху)</option>
          <option value="divine-desc">divine ↓</option>
          <option value="change-desc">тренд ↓ (растущие сверху)</option>
          <option value="name">по имени (A→Z)</option>
        </select>
        <button id="cur-refresh" class="ghost" title="Форс-сброс кэша poe2scout и перезапрос">🔄 Обновить</button>
        <span class="cur-count dim"></span>
      </div>
      <div class="cur-wrap">
        <table class="tbl cur-table"><thead><tr>
          <th data-k="name">Валюта</th><th data-k="chaos">chaos</th><th data-k="divine">divine</th><th data-k="change" title="poe.ninja sparkline, окно ~7 д., изменения в %">тренд</th>
        </tr></thead><tbody></tbody></table>
      </div>
      <div class="cur-detail"></div>
      <p class="note">Курсы: poe2scout + poe.ninja (лучший из источников) · лига «${esc(league ?? '')}». Тренд — poe.ninja exchange sparkline (изменения за окно, не абсолютные цены). Клик по строке — почасовая история/ликвидность poe2scout. Игровые валюты, никаких реальных денег.</p>`;

    const tbody = el.querySelector<HTMLTableSectionElement>('.cur-table tbody')!;
    const search = el.querySelector<HTMLInputElement>('#cur-search')!;
    const sortSel = el.querySelector<HTMLSelectElement>('#cur-sort')!;
    const count = el.querySelector<HTMLElement>('.cur-count')!;
    const detail = el.querySelector<HTMLElement>('.cur-detail')!;

    const view = (): void => {
      const q = search.value.trim().toLowerCase();
      const kind = sortSel.value;
      const rows = usable
        .filter((r) => !q || r.name.toLowerCase().includes(q))
        .sort((a, b) => {
          switch (kind) {
            case 'chaos-asc': return (a.chaosValue ?? Infinity) - (b.chaosValue ?? Infinity);
            case 'divine-desc': return (b.divineValue ?? -Infinity) - (a.divineValue ?? -Infinity);
            case 'change-desc': return (trends.get(b.name.toLowerCase())?.change ?? -Infinity) - (trends.get(a.name.toLowerCase())?.change ?? -Infinity);
            case 'name': return a.name.localeCompare(b.name);
            default: return (b.chaosValue ?? -Infinity) - (a.chaosValue ?? -Infinity);
          }
        });
      tbody.innerHTML = rows.map((r) => rowHtml(r, trends.get(r.name.toLowerCase()), icons)).join('');
      count.textContent = `${rows.length} / ${usable.length}`;
    };

    search.addEventListener('input', view);
    sortSel.addEventListener('change', view);
    el.querySelector('#cur-refresh')!.addEventListener('click', () => {
      core.trade.clearScoutCache();
      selectedName = null;
      void renderCurrencyTab();
    });
    tbody.addEventListener('click', (ev) => {
      const row = (ev.target as HTMLElement).closest<HTMLTableRowElement>('.cur-row');
      if (!row) return;
      const name = row.dataset.cur ?? '';
      if (selectedName && selectedName.toLowerCase() === name.toLowerCase()) return; // уже открыт
      selectedName = name;
      tbody.querySelectorAll('.cur-sel').forEach((n) => n.classList.remove('cur-sel'));
      row.classList.add('cur-sel');
      void renderDetail(name, detail);
    });

    view();
    setStatus(`Показано валют: ${usable.length} (клик по строке — история).`);
    if (savedSel) void renderDetail(savedSel, detail); // восстановить открытую деталь после refresh
  } catch (e) {
    el.innerHTML = `<p class="err">Ошибка: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
    setStatus('Ошибка запроса.');
  }
}

export function initCurrencyTab(): void {
  document.querySelector('#btn-currencies')?.addEventListener('click', () => void renderCurrencyTab());
}
