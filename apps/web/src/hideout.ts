/**
 * Вкладка «Хайдоуты» (№198, web): офлайн-разбор .hideout поверх core.hideout.
 *
 * Вход: файл (drop / input — первый file-read в проекте), текст JSON или
 * share-код PoE2 Kit (zlib+base64). Выход: карточка базы, прогресс против
 * лимита 750, таблица декора с категориями (free/store-mtx/unknown), чекбоксы
 * «мой MTX» (localStorage, как .lastBuild), фильтр, мини-карта размещения
 * (canvas по x/y/r из файла) и экспорт (markdown-пост / share-код).
 *
 * Работает офлайн: core.hideout.parseHideout/summarizeHideout + датасет
 * decor.json (Vite ?url-ассет, как layout.json в fullMap.ts).
 */

import decorUrl from '../../../packages/core/data/game/hideout/decor.json?url';
import {
  core,
  HIDEOUT_DECOR_LIMIT,
  type DecorIndex,
  type HideoutSummary,
  type ParsedHideout,
  type DecorCategory,
  type DecorStat,
} from '@poe2-kit/core';
import { setStatus } from './ui';

const OWNED_KEY = 'poe2k.hideout.owned';
const LAST_KEY = 'poe2k.hideout.last';

const CAT_LABEL: Record<DecorCategory, string> = {
  free: 'бесплатно',
  'store-mtx': 'MTX (магазин)',
  'exclusive-mtx': 'MTX (эксклюзив)',
  pet: 'питомец',
  unknown: 'не классиф.',
};
const CAT_class: Record<DecorCategory, string> = {
  free: 'ok',
  'store-mtx': 'rare',
  'exclusive-mtx': 'rare',
  pet: 'magic',
  unknown: 'dim',
};

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

// ── датасет (лениво, один раз) ──────────────────────────────────────────────

let decorIndex: DecorIndex | null = null;

async function getDecorIndex(): Promise<DecorIndex> {
  if (decorIndex) return decorIndex;
  interface FileDecorEntry { category?: DecorCategory; category_source?: string }
  interface DecorFile { decor: Record<string, FileDecorEntry> }
  const file = (await (await fetch(decorUrl)).json()) as DecorFile;
  const idx: DecorIndex = {};
  for (const [k, e] of Object.entries(file.decor)) {
    idx[k] = { category: e.category ?? 'unknown', source: e.category_source ?? 'dataset' };
  }
  decorIndex = idx;
  return idx;
}

// ── состояние ───────────────────────────────────────────────────────────────

interface State {
  parsed: ParsedHideout | null;
  summary: HideoutSummary | null;
  shareCode: string | null;
  filter: string;
  hideMissing: boolean;
}

const state: State = { parsed: null, summary: null, shareCode: null, filter: '', hideMissing: false };

function loadOwned(): Set<string> {
  try {
    const raw = localStorage.getItem(OWNED_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveOwned(set: Set<string>): void {
  try {
    localStorage.setItem(OWNED_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

// ── разбор входа ────────────────────────────────────────────────────────────

function isJsonStart(text: string): boolean {
  return text.replace(/^\uFEFF/, '').trimStart().startsWith('{');
}

async function parseInput(text: string): Promise<void> {
  if (!text.trim()) throw new Error('пусто: вставь текст .hideout или перетащи файл');
  let parsed: ParsedHideout;
  if (isJsonStart(text)) {
    parsed = core.hideout.parseHideout(text);
  } else {
    parsed = core.hideout.decodeHideoutCode(text.trim());
  }
  const idx = await getDecorIndex();
  state.parsed = parsed;
  state.summary = core.hideout.summarizeHideout(parsed, { decorIndex: idx });
  const share = core.hideout.encodeHideoutCode(parsed);
  state.shareCode = share;
  try {
    localStorage.setItem(LAST_KEY, share);
  } catch {
    /* ignore */
  }
  render();
}

export async function showHideout(text: string): Promise<void> {
  try {
    await parseInput(text);
    const s = state.summary!;
    setStatus(`Хайдоут разобран: ${s.base}, декораций ${s.totalPlacements}/${s.limit}.`);
  } catch (e) {
    const out = document.querySelector('#out-hideout');
    if (out) {
      out.innerHTML = `<div class="hd-error">${esc(e instanceof Error ? e.message : String(e))}</div>`;
    }
    setStatus('Не удалось разобрать .hideout.');
  }
}

// ── рендер ──────────────────────────────────────────────────────────────────

function catBadge(cat: DecorCategory): string {
  return `<span class="pill hd-cat hd-cat-${CAT_class[cat]!}">${CAT_LABEL[cat]}</span>`;
}

function canBuildPercent(summary: HideoutSummary, owned: Set<string>): number {
  let have = 0;
  for (const s of summary.decor) {
    if (s.category === 'free' || (s.category !== 'unknown' && owned.has(s.name.toLowerCase()))) have += s.count;
  }
  return Math.round((have / summary.totalPlacements) * 100);
}

function visibleDecor(summary: HideoutSummary, owned: Set<string>): DecorStat[] {
  const q = state.filter.trim().toLowerCase();
  return summary.decor.filter((s) => {
    if (q && !s.name.toLowerCase().includes(q)) return false;
    if (state.hideMissing) {
      // скрываем то, что точно доступно (free или подтверждённый MTX, отмеченный как купленный)
      if (s.category === 'free') return false;
      if (s.category !== 'unknown' && owned.has(s.name.toLowerCase())) return false;
    }
    return true;
  });
}

function render(): void {
  const out = document.querySelector<HTMLElement>('#out-hideout');
  const summary = state.summary;
  if (!out || !summary) return;
  const owned = loadOwned();
  const pct = Math.round((summary.totalPlacements / summary.limit) * 100);
  const buildable = canBuildPercent(summary, owned);

  let html = `
    <div class="hd-head">
      <div class="hd-base">
        <h3>${esc(summary.base)}</h3>
        <div class="hd-meta">hash ${summary.baseHash}${summary.music ? ` · музыка: ${esc(summary.music)}` : ''}</div>
      </div>
      <div class="hd-score">
        <div class="hd-progress"><div class="hd-progress-fill${summary.overLimit ? ' over' : ''}" style="width:${Math.min(100, pct)}%"></div></div>
        <div class="hd-progress-num">${summary.totalPlacements} / ${HIDEOUT_DECOR_LIMIT}${summary.overLimit ? ' ⚠ ПРЕВЫШЕН' : ''}</div>
        <div class="hd-buildable">Можно собрать: <b>${buildable}%</b> <small>(free ${summary.byCategory['free']}${summary.byCategory['store-mtx'] + summary.byCategory['exclusive-mtx'] > 0 ? ` + твой MTX` : ''})</small></div>
        <div class="hd-cats">${(Object.keys(summary.byCategory) as DecorCategory[])
          .filter((c) => summary.byCategory[c] > 0)
          .map((c) => `<span class="hd-catcount">${catBadge(c)} ×${summary.byCategory[c]}</span>`)
          .join(' ')}</div>
      </div>
    </div>`;

  if (summary.warnings.length) {
    html += `<div class="hd-warn">⚠ ${summary.warnings.map(esc).join(' · ')}</div>`;
  }

  if (state.parsed && state.parsed.doodads.length) {
    html += `<canvas id="hd-canvas" class="hd-canvas" width="940" height="440"></canvas>
      <p class="hint">Мини-карта размещения (x, y из файла); луч — поворот r×360/65536. Золото — MTX, зелёный — функциональные, серый — прочие.</p>`;
  }

  const rows = visibleDecor(summary, owned);
  html += `<table class="hd-table">
    <thead><tr><th>Декор</th><th>×Кол-во</th><th>Категория</th><th>Есть у меня</th></tr></thead>
    <tbody>
    ${rows
      .map((s) => {
        const key = esc(s.name.toLowerCase());
        const has = owned.has(s.name.toLowerCase());
        const ownable = s.category === 'store-mtx' || s.category === 'exclusive-mtx' || s.category === 'pet';
        return `<tr>
        <td>${esc(s.name)}${s.hashes.length > 1 ? ` <small class="dim">(${s.hashes.length} вариантов)</small>` : ''}</td>
        <td>${s.count}</td>
        <td>${catBadge(s.category)}${s.categorySource === 'heuristic-possessive' ? ' <small class="dim">эвристика</small>' : ''}</td>
        <td>${
          ownable
            ? `<input type="checkbox" class="hd-own" data-name="${key}"${has ? ' checked' : ''} />`
            : '<span class="dim">—</span>'
        }</td>
      </tr>`;
      })
      .join('')}
    </tbody>
  </table>
  <p class="hint">Показано ${rows.length} из ${summary.decor.length} имён декора. Классификация неполная (${summary.coverage.unknown} без категории) — датасет decor.json растёт из learn-журнала. «Есть у меня» сохраняется в браузере.</p>`;

  out.innerHTML = html;

  // canvas-мини-карта
  const canvas = out.querySelector<HTMLCanvasElement>('#hd-canvas');
  if (canvas && state.parsed) drawMiniMap(canvas, state.parsed);

  // чекбоксы «есть у меня»
  out.querySelectorAll<HTMLInputElement>('.hd-own').forEach((cb) => {
    cb.addEventListener('change', () => {
      const set = loadOwned();
      const name = cb.dataset.name!;
      if (cb.checked) set.add(name);
      else set.delete(name);
      saveOwned(set);
      render(); // пересчёт «можно собрать»
    });
  });
}

// ── мини-карта (canvas) ────────────────────────────────────────────────────

const MAP_COLORS: Record<DecorCategory, string> = {
  free: '#7fb95a',
  'store-mtx': '#f0d190',
  'exclusive-mtx': '#f0d190',
  pet: '#9d9dff',
  unknown: '#77716a',
};

function drawMiniMap(canvas: HTMLCanvasElement, parsed: ParsedHideout): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  const pad = 24;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#101018';
  ctx.fillRect(0, 0, W, H);

  const ds = parsed.doodads;
  const xs = ds.map((d) => d.x), ys = ds.map((d) => d.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);

  const idx = decorIndex;
  for (const d of ds) {
    const px = pad + (d.x - minX) * scale;
    const py = H - pad - (d.y - minY) * scale; // y инвертирован (в файле — сверху вниз)
    const cat = idx ? core.hideout.classifyDecor(d.name, idx).category : 'unknown';
    ctx.fillStyle = MAP_COLORS[cat];
    const size = 2.5 + Math.min(2, d.hash % 3); // лёгкая вариация размера (визуальная)
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
    // тик поворота: r 0..65535 ≈ 0..360°
    const angle = (d.r * 2 * Math.PI) / 65536;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(angle) * size * 3, py + Math.sin(angle) * size * 3);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ── экспорт в буфер ─────────────────────────────────────────────────────────

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Скопировано в буфер.');
  } catch {
    setStatus('Не удалось скопировать — буфер недоступен без фокуса на странице.');
  }
}

export function copyHideoutShare(): void {
  if (!state.shareCode) {
    setStatus('Сначала разбери .hideout.');
    return;
  }
  void copyText(state.shareCode);
}

export function copyHideoutMarkdown(): void {
  if (!state.summary) {
    setStatus('Сначала разбери .hideout.');
    return;
  }
  void copyText(core.hideout.formatHideoutPost(state.summary, { owned: loadOwned() }));
}

// ── ввод: файл (drop / input) ────────────────────────────────────────────────

export function initHideoutTab(): void {
  const pane = document.querySelector<HTMLElement>('#pane-hideout');
  if (!pane) return;

  const drop = pane.querySelector<HTMLElement>('#hideout-drop')!;
  const fileInput = pane.querySelector<HTMLInputElement>('#hideout-file')!;
  const textarea = pane.querySelector<HTMLTextAreaElement>('#hideout-input')!;

  async function readAndParse(file: File): Promise<void> {
    const text = await file.text();
    textarea.value = text;
    await showHideout(text);
  }

  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('drag');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
    const file = e.dataTransfer?.files[0];
    if (file) void readAndParse(file);
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void readAndParse(file);
  });

  const filter = pane.querySelector<HTMLInputElement>('#hideout-filter')!;
  filter.addEventListener('input', () => {
    state.filter = filter.value;
    if (state.summary) render();
  });
  const hideMissing = pane.querySelector<HTMLInputElement>('#hideout-owned-only')!;
  hideMissing.addEventListener('change', () => {
    state.hideMissing = hideMissing.checked;
    if (state.summary) render();
  });

  // восстановить последний разбор (share-код) — как poe2k.lastBuild
  const last = (() => {
    try {
      return localStorage.getItem(LAST_KEY);
    } catch {
      return null;
    }
  })();
  if (last) void showHideout(last);
}
