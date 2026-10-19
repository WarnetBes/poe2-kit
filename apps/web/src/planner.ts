/**
 * Вкладка «🛠 Планнер» (planner-волна 2): UX по poeshop.ru/planner, полностью
 * на своих датасетах и своём оформлении (их иконки/CSS/webp НЕ копируются):
 *   • скилл-группы в виде слота: большой квадрат главного гема + 6 круговых
 *     ячеек (гем + 5 саппортов) — как раскладка их планнера;
 *   • клик по ячейке → пикер с поиском: активные гемы (381 с рекомендациями),
 *     саппорты — рекомендованные сверху (мета-эталон), затем base-ранги;
 *   • клик по заполненной ячейке → замена; крестик на hover → удалить;
 *   • иконки — настоящий арт гемов из poe2db (CC BY-NC-SA, GGG-арт; тот же,
 *     что крутят poeshop-подобные планнеры) с фолбэком на цветной жетон;
 *   • гир: datalist-подсказки уников; всё в localStorage (офлайн-first).
 *
 * RU-имён активных гемов в датасетах нет — EN; саппорты RU, где есть.
 * Внешних запросов нет: только public-датасеты.
 */

import { core, setStatus } from './ui';

// ─── Типы ────────────────────────────────────────────────────────────────────

interface PlannerSupport { en: string; ru: string | null }
interface PlannerGroup { gem: string; supports: PlannerSupport[] }
interface PlannerState { groups: PlannerGroup[]; gear: Record<string, string> }

const LS_KEY = 'poe2kit-planner-v1';
const MAX_SUPPORTS = 5;
const MAX_GROUPS = 3;

/** Слоты гира: id → (RU-лейбл, категории uniques_catalog для datalist). */
const GEAR_SLOTS: Array<{ id: string; label: string; cats: string[] }> = [
  { id: 'weapon', label: 'Оружие', cats: ['maces', 'staves', 'bows', 'crossbows', 'sceptres', 'wands', 'spears'] },
  { id: 'offhand', label: 'Вторая рука', cats: ['foci', 'shield', 'quivers'] },
  { id: 'helmet', label: 'Шлем', cats: ['helmets'] },
  { id: 'body', label: 'Броня', cats: ['body'] },
  { id: 'gloves', label: 'Перчатки', cats: ['gloves'] },
  { id: 'boots', label: 'Обувь', cats: ['boots'] },
  { id: 'belt', label: 'Пояс', cats: ['belts'] },
  { id: 'ring1', label: 'Кольцо I', cats: ['rings'] },
  { id: 'ring2', label: 'Кольцо II', cats: ['rings'] },
  { id: 'amulet', label: 'Амулет', cats: ['amulets'] },
  { id: 'flask', label: 'Фляга', cats: ['flask'] },
];

interface UniquesByCategory { [cat: string]: string[] }

// ─── Утилиты ──────────────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function fetchJson(url: string): Promise<unknown> {
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`датасет не загружен (${url}: HTTP ${res.status})`);
    return res.json();
  });
}

// ─── Состояние (localStorage + share-ссылка #p=) ──────────────────────────────

/** URL-поделиться планом: #pl=<base64url JSON> («p» занят планом карты fullMap). */
function encodeShare(s: PlannerState): string {
  try {
    const min = s.groups.map((g) => [g.gem, g.supports.map((x) => x.en)]);
    return btoa(JSON.stringify({ g: min, gear: s.gear }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch { return ''; }
}

function decodeShare(seg: string): PlannerState | null {
  try {
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    const raw = JSON.parse(atob(b64)) as {
      g?: Array<[string, string[]]>;
      gear?: Record<string, string>;
    };
    if (!Array.isArray(raw.g)) throw new Error('схема');
    const groups = raw.g.slice(0, MAX_GROUPS).map(([gem, sup]) => ({
      gem: String(gem ?? ''),
      supports: (sup ?? []).slice(0, MAX_SUPPORTS).map((en) => ({ en: String(en), ru: null })),
    }));
    return { groups, gear: raw.gear ?? {} };
  } catch { return null; }
}

function loadState(): PlannerState {
  // ссылка-план приоритетнее localStorage: чужой план открываем, а не свой
  const m = /(?:^|[#&])pl=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (m) {
    const shared = decodeShare(m[1]);
    if (shared) {
      while (shared.groups.length < MAX_GROUPS) shared.groups.push({ gem: '', supports: [] });
      return shared;
    }
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) throw new Error('пусто');
    const parsed = JSON.parse(raw) as PlannerState;
    if (!Array.isArray(parsed.groups) || typeof parsed.gear !== 'object') throw new Error('схема');
    return { groups: parsed.groups.slice(0, MAX_GROUPS), gear: parsed.gear ?? {} };
  } catch {
    return { groups: [], gear: {} };
  }
}

function saveState(s: PlannerState): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* quota — молча */ }
  // поддерживаем #pl= синхронно с состоянием, чужие сегменты (a=, p=) сохраняем
  try {
    const enc = encodeShare(s);
    const segs = location.hash.replace(/^#/, '').split('&').filter((x) => x && !x.startsWith('pl='));
    if (enc) segs.unshift(`pl=${enc}`);
    const base = location.pathname + location.search;
    history.replaceState(null, '', segs.length ? `${base}#${segs.join('&')}` : base);
  } catch { /* replaceState недоступен (file://) — молча */ }
}

// ─── Датасеты (лениво, один раз) ──────────────────────────────────────────────

interface Box {
  activeList: string[];
  ruByEn: Map<string, string>;
  allSupports: Array<{ en: string; ru: string | null }>;
}
let supportsBox: Box | null = null;
let uniquesBox: { byCategory: UniquesByCategory } | null = null;
let gemColorsBox: Record<string, string> | null = null;

/** Ключ файла иконки уника — как в fetch-item-icons.mjs (fileKey). */
function itemFileKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/gu, '');
}

let itemIconsBox: Record<string, true> | null = null;
/** Манифест иконок уников (item_index.json) — доступен всем генераторам HTML. */
let itemIconMap: Record<string, true> = {};

async function ensureItemIcons(): Promise<Record<string, true>> {
  if (itemIconsBox) return itemIconsBox;
  const base = import.meta.env.BASE_URL ?? '/';
  try {
    const raw = (await fetchJson(base + 'datasets/item_index.json')) as { map?: Record<string, true> };
    itemIconsBox = raw.map ?? {};
  } catch {
    itemIconsBox = {}; // манифеста нет — слоты без иконок, но работают
  }
  itemIconMap = itemIconsBox;
  return itemIconsBox;
}

async function ensureSupports(): Promise<Box> {
  if (supportsBox) return supportsBox;
  const base = import.meta.env.BASE_URL ?? '/';
  const [meta, reco] = await Promise.all([
    fetchJson(base + 'datasets/meta_supports.json'),
    fetchJson(base + 'datasets/recommended_supports.json'),
  ]);
  core.dataset.installBrowserDataset('skill_gems/meta_supports.json', meta);
  core.dataset.installBrowserDataset('skill_gems/recommended_supports.json', reco);
  core.gemSupports.resetGemSupportCaches();
  const map = (reco as { map?: Record<string, Array<{ ru?: string; en: string }> | undefined> }).map ?? {};
  const ruByEn = new Map<string, string>();
  for (const list of Object.values(map)) {
    for (const r of list ?? []) if (r.ru && r.en) ruByEn.set(r.en, r.ru);
  }
  // полный пул саппортов: reco (RU) ∪ meta entries (могут быть новые тир-3/4)
  const entries = (meta as { entries?: Record<string, Array<{ supports?: string[] }>> }).entries ?? {};
  for (const lists of Object.values(entries)) {
    for (const rec of lists ?? []) for (const s of rec.supports ?? []) {
      if (!ruByEn.has(s)) ruByEn.set(s, s);
    }
  }
  const allSupports = [...ruByEn.entries()]
    .map(([en, ru]) => ({ en, ru: ru === en ? null : ru }))
    .sort((a, b) => (a.ru ?? a.en).localeCompare(b.ru ?? b.en));
  supportsBox = { activeList: Object.keys(map).sort(), ruByEn, allSupports };
  return supportsBox;
}

async function ensureUniques(): Promise<{ byCategory: UniquesByCategory }> {
  if (uniquesBox) return uniquesBox;
  const base = import.meta.env.BASE_URL ?? '/';
  const raw = (await fetchJson(base + 'datasets/uniques_catalog.json')) as { byCategory?: UniquesByCategory };
  if (!raw.byCategory) throw new Error('в датасете нет byCategory');
  uniquesBox = { byCategory: raw.byCategory };
  return uniquesBox;
}

async function ensureGemColors(): Promise<Record<string, string>> {
  if (gemColorsBox) return gemColorsBox;
  const base = import.meta.env.BASE_URL ?? '/';
  const raw = (await fetchJson(base + 'datasets/gem_colors.json')) as { map?: Record<string, string> };
  gemColorsBox = raw.map ?? {};
  return gemColorsBox;
}

const HEX_BY_ATTR: Record<string, string> = { red: '#d05555', blue: '#5588d0', green: '#55a066' };

/** Цвет гема: gem_colors map ('ice strike' → 'green,blue') → hex первого атрибута. */
function gemHex(name: string, colors: Record<string, string>): string {
  const k = name.trim().toLowerCase().replace(/\s+/g, ' ');
  const attrs = colors[k];
  if (!attrs) return '';
  return HEX_BY_ATTR[attrs.split(',')[0]] ?? '';
}

let iconIndexBox: Record<string, true> | null = null;
/** Манифест скачанных иконок (icon_index.json) — доступен всем генераторам HTML. */
let iconMap: Record<string, true> = {};

async function ensureIconUrls(): Promise<Record<string, true>> {
  if (iconIndexBox) return iconIndexBox;
  const base = import.meta.env.BASE_URL ?? '/';
  try {
    const raw = (await fetchJson(base + 'datasets/icon_index.json')) as { map?: Record<string, true> };
    iconIndexBox = raw.map ?? {};
  } catch {
    iconIndexBox = {}; // офлайн-катастрофа — все гемы на цветных жетонах
  }
  return iconIndexBox;
}

function iconUrl(en: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return base + 'datasets/gem_icons/' + en.replace(/[^a-z0-9 ]/gu, '') + '.webp';
}

/**
 * Тайл гема: настоящая иконка камня (poe2db, GGG-арт) если скачана,
 * иначе цветной жетон-инициалы (фолбэк).
 */
function initialsOf(name: string): string {
  return (name.replace(/[^\p{L}\p{N} ]/gu, '').match(/\S+/g) ?? [name]).map((w) => w[0]).slice(0, 2).join('');
}

function gemIcon(en: string, colors: Record<string, string>, cls: string, title = ''): string {
  const norm = en.trim().toLowerCase().replace(/\s+/g, ' ');
  if (iconMap[norm]) {
    return `<img class="pl-tile-img ${cls}" src="${iconUrl(norm)}" alt="${esc(en)}" title="${esc(title || en)}" loading="lazy" />`;
  }
  return gemTile(en, colors, cls, title);
}

/** Жетон гема: круг/квадрат цвета атрибута с инициалами (свои иконки, не их webp). */
function gemTile(name: string, colors: Record<string, string>, cls: string, title = ''): string {
  const c = gemHex(name, colors) || 'rgba(140,140,150,.6)';
  return `<span class="pl-tile ${cls}" style="border-color:${c};background:radial-gradient(circle at 30% 25%, ${c}26, ${c}66 60%, ${c}26)" title="${esc(title || name)}">${esc(initialsOf(name))}</span>`;
}

// ─── Рендер слот-группы (poeshop-раскладка: квадрат + 6 ячеек) ────────────────

interface RecoLite { en: string; tier: 'meta' | 'base'; rank: number | null; note: string | null }

interface PickerTarget { group: number; kind: 'gem' | 'support'; index: number | null }

let picker: PickerTarget | null = null;

function cellHtml(
  filledName: string | null,
  colors: Record<string, string>,
  attrs: string,
  label: string,
): string {
  const inner = filledName
    ? gemIcon(filledName, colors, 'pl-tile-filled')
    : `<span class="pl-tile pl-tile-empty"><b>+</b></span>`;
  return `<button type="button" class="pl-cell ${attrs}" title="${filledName ? 'клик — заменить' : label}">
    ${inner}
    ${filledName ? '<s class="pl-cell-x" data-x title="убрать">✕</s>' : ''}
  </button>`;
}

function groupHtml(
  groupIdx: number,
  state: PlannerState,
  recos: RecoLite[],
  colors: Record<string, string>,
  ruByEn: Map<string, string>,
): string {
  const g = state.groups[groupIdx];
  const gem = g?.gem ?? '';
  const supports = g?.supports ?? [];

  const supportCells = Array.from({ length: MAX_SUPPORTS }, (_, i) => {
    const s = supports[i];
    return cellHtml(
      s ? s.en : null,
      colors,
      `pl-cell-sup${s ? ' pl-cell-on' : ''}`,
      `саппорт ${i + 1}`,
    );
  }).join('');

  const gemNameRu = gem ? '' : '';
  const summaryLine = gem
    ? `<b>${esc(gem)}</b>${supports.length ? ' — ' + supports.map((s) => esc(s.ru ?? s.en)).join(' + ') : '<span class="dim"> — добавь саппорты</span>'}`
    : '<span class="dim">Пусто: кликни по ячейкам, чтобы выбрать гем и саппорты.</span>';

  const recoChips = gem && recos.length
    ? recos.slice(0, 8).map((r) =>
        `<button type="button" class="pl-reco-chip${r.tier === 'meta' ? ' pl-reco-meta' : ''}" data-quick-support="${esc(r.en)}" title="${r.tier === 'meta' ? 'мета-эталон' : `base-ранг ${r.rank ?? '?'}`} — клик добавит">${esc(ruByEn.get(r.en) ?? r.en)}</button>`,
      ).join('')
    : '';

  return `<div class="pl-slot-card" data-group="${groupIdx}">
    <div class="pl-slot-head"><span class="pl-slot-num">${groupIdx + 1}</span></div>
    <div class="pl-slot-group">
      <div class="pl-cell-big-wrap">
        ${cellHtml(gem || null, colors, 'pl-cell-main' + (gem ? ' pl-cell-on' : ''), 'главный гем')}
      </div>
      <div class="pl-cells">${cellHtml(gem || null, colors, 'pl-cell-gem' + (gem ? ' pl-cell-on' : ''), 'главный гем')}${supportCells}</div>
    </div>
    <p class="pl-slot-summary">${gemNameRu}${summaryLine}</p>
    ${recoChips ? `<div class="pl-recos">${recoChips}</div>` : ''}
  </div>`;
}

/** Панель пикера: поиск + сетка жетонов (для выбранной ячейки). */
function pickerHtml(
  t: PickerTarget,
  state: PlannerState,
  colors: Record<string, string>,
  box: Box,
  recos: RecoLite[],
): string {
  const isGem = t.kind === 'gem';
  const pool: Array<{ en: string; ru: string | null; meta?: boolean }> = isGem
    ? box.activeList.map((en) => ({ en, ru: null }))
    : box.allSupports.map((s) => ({ ...s }));
  // для саппортов: рекомендованные первым блоком
  const recoByEn = new Map(recos.map((r) => [r.en, r]));
  const recosPart = !isGem
    ? `<div class="pl-picker-sec">Рекомендованные для ${esc(state.groups[t.group]?.gem ?? '')}</div>` +
      recos.map((r) =>
        `<button type="button" class="pl-picker-item${r.tier === 'meta' ? ' pl-reco-meta' : ''}" data-pick="${esc(r.en)}" data-pick-ru="${esc(box.ruByEn.get(r.en) ?? '')}">
           ${gemIcon(r.en, colors, '')}<span>${esc(box.ruByEn.get(r.en) ?? r.en)}</span><i>${r.tier === 'meta' ? 'мета' : `ранг ${r.rank ?? '?'}`}</i>
         </button>`).join('')
    : '';
  return `<div class="pl-picker" data-picker>
    <div class="pl-picker-top">
      <b>${isGem ? 'Выбор активного гема' : 'Выбор саппорта'}</b>
      <button type="button" class="pl-picker-close" data-picker-close>✕</button>
    </div>
    <input class="pl-picker-search" placeholder="поиск (EN/RU)…" data-picker-search autocomplete="off" />
    ${recosPart}
    <div class="pl-picker-sec">Все (${pool.length})</div>
    <div class="pl-picker-list">
      ${pool.map((p) =>
        `<button type="button" class="pl-picker-item" data-pick="${esc(p.en)}" data-pick-ru="${esc(p.ru ?? '')}" data-search="${esc((p.ru ?? '') + ' ' + p.en).toLowerCase()}">
           ${gemIcon(p.en, colors, '')}<span>${esc(p.ru ?? p.en)}${p.ru ? ` <em>${esc(p.en)}</em>` : ''}</span>
         </button>`).join('')}
    </div>
  </div>`;
}

// ─── Гир (клик-слоты poeshop-стайл: иконка уника из poe2db-арта + пикер) ────────

let gearPicker: { slot: string } | null = null;

function itemIconImg(name: string, cls: string): string {
  const key = itemFileKey(name);
  if (!itemIconMap[key]) return '';
  const base = import.meta.env.BASE_URL ?? '/';
  // харвест пишет .png для пары старых артов — webp с onerror-фолбэком на png
  return `<img class="${cls}" src="${base}datasets/item_icons/${key}.webp" onerror="this.onerror=null;this.src=this.src.replace(/\.webp$/,'.png')" alt="${esc(name)}" title="${esc(name)}" loading="lazy" />`;
}

function gearHtml(state: PlannerState): string {
  const slots = GEAR_SLOTS.map((slot) => {
    const name = state.gear[slot.id] ?? '';
    const inner = name
      ? `${itemIconImg(name, 'pl-item-ico') || `<span class="pl-item-ph pl-item-ph-set">${esc(name.slice(0, 2))}</span>`}<b class="pl-item-name">${esc(name)}</b>`
      : '<span class="pl-item-ph">+</span><b class="pl-item-name dim">пусто</b>';
    return `<button type="button" class="pl-item-slot${name ? ' pl-item-on' : ''}" data-gear-slot="${esc(slot.id)}" title="${esc(slot.label)}: ${name ? 'клик — заменить' : 'выбрать предмет'}">
      <span class="pl-item-label">${esc(slot.label)}</span>
      ${inner}
      ${name ? '<s class="pl-cell-x pl-gear-x" data-gear-x title="убрать">✕</s>' : ''}
    </button>`;
  }).join('');
  return `<div class="pl-gear2">${slots}</div>`;
}

function gearPickerHtml(slotId: string, state: PlannerState, byCategory: UniquesByCategory): string {
  const slot = GEAR_SLOTS.find((s) => s.id === slotId);
  if (!slot) return '';
  const names = [...new Set(slot.cats.flatMap((c) => byCategory[c] ?? []))].sort((a, b) => a.localeCompare(b));
  return `<div class="pl-picker" data-gear-picker data-slot="${esc(slotId)}">
    <div class="pl-picker-top">
      <b>${esc(slot.label)}: выбор предмета</b>
      <button type="button" class="pl-picker-close" data-picker-close>✕</button>
    </div>
    <input class="pl-picker-search" placeholder="поиск уника…" data-picker-search autocomplete="off" />
    ${itemIconImg(state.gear[slotId] ?? '', 'pl-item-ico pl-item-cur')}
    <div class="pl-picker-list">
      ${names.map((n) =>
        `<button type="button" class="pl-picker-item" data-gear-pick="${esc(n)}" data-search="${esc(n).toLowerCase()}">
           ${itemIconImg(n, 'pl-item-ico') || `<span class="pl-item-ph pl-item-ph-mini">${esc(n.slice(0, 2))}</span>`}<span>${esc(n)}</span>
         </button>`).join('')}
    </div>
    <div class="pl-gear-custom">
      <span class="dim">не-уник / своё:</span>
      <input data-gear-custom autocomplete="off" placeholder="Rare, кастомное имя…" value="${esc(state.gear[slotId] ?? '')}" />
      <button type="button" class="tab" data-gear-custom-save>OK</button>
    </div>
  </div>`;
}

function summaryText(state: PlannerState): string {
  const lines: string[] = [];
  state.groups.forEach((g, i) => {
    if (!g.gem) return;
    const sup = g.supports.map((s) => s.ru ?? s.en).join(' + ');
    lines.push(`Группа ${i + 1}: ${g.gem}${sup ? ` — ${sup}` : ''}`);
  });
  const gear = GEAR_SLOTS.filter((s) => state.gear[s.id]).map((s) => `${s.label}: ${state.gear[s.id]}`);
  if (gear.length) lines.push('Гир: ' + gear.join('; '));
  return lines.join('\n') || 'Планнер пуст.';
}

// ─── Вкладка ──────────────────────────────────────────────────────────────────

export function initPlannerTab(): void {
  let rendered = false;
  const btn = document.querySelector<HTMLButtonElement>('[data-tab="planner"]');
  const out = () => document.getElementById('out-planner');
  const state = loadState();
  while (state.groups.length < MAX_GROUPS) state.groups.push({ gem: '', supports: [] });

  async function render(): Promise<void> {
    const el = out();
    if (!el) return;
    const box = await ensureSupports();
    const { byCategory } = await ensureUniques();
    const colors = await ensureGemColors();
    iconMap = await ensureIconUrls();
    await ensureItemIcons();

    const groupHtmls: string[] = [];
    for (let i = 0; i < MAX_GROUPS; i++) {
      const gem = state.groups[i]?.gem ?? '';
      const recos: RecoLite[] = gem ? core.gemSupports.supportsForActive(gem) : [];
      groupHtmls.push(groupHtml(i, state, recos, colors, box.ruByEn));
    }

    let pickerPart = '';
    if (picker) {
      const recos: RecoLite[] = picker.kind === 'support' && state.groups[picker.group]?.gem
        ? core.gemSupports.supportsForActive(state.groups[picker.group].gem)
        : [];
      pickerPart = pickerHtml(picker, state, colors, box, recos);
    }

    el.innerHTML = `
      <div class="sim-facts">
        <div class="sim-fact"><b>${box.activeList.length}</b><span>активных гемов с рекомендациями</span></div>
        <div class="sim-fact"><b>${box.allSupports.length}</b><span>саппортов в пикере</span></div>
        <div class="sim-fact"><b>${state.groups.filter((g) => g.gem).length}/${MAX_GROUPS}</b><span>скилл-групп занято</span></div>
        <div class="sim-fact"><b>${GEAR_SLOTS.filter((s) => state.gear[s.id]).length}/${GEAR_SLOTS.length}</b><span>слотов гира заполнено</span></div>
      </div>
      <div class="pl-groups">${groupHtmls.join('')}</div>
      ${pickerPart}
      <h3>Экипировка</h3>
      <p class="hint">Клик по слоту — выбор уника (пикер, иконки = poe2db-арт GGG); внизу пикера — своё имя/Rare. ✕ на hover — очистить. Иконки догружаются фоном (харвест волне №565).</p>
      ${gearHtml(state)}
      ${gearPicker ? gearPickerHtml(gearPicker.slot, state, byCategory) : ''}
      <div class="lvset" style="margin-top:12px"><button id="pl-copy" class="tab">📋 Копировать сводку</button> <button id="pl-share" class="tab">🔗 Поделиться планом</button></div>
      <p class="dim" id="pl-summary-note"></p>`;
  }

  function persistAndRender(): void {
    saveState(state);
    render().catch((e: unknown) => {
      const el = out();
      if (el) el.innerHTML = `<p class="note">⚠ Датасеты планнера не загрузились: ${esc(String(e))}</p>`;
    });
  }

  function pickGem(gi: number, en: string, ru: string | null): void {
    const g = state.groups[gi];
    if (!g) return;
    if (g.gem !== en) g.gem = en; // саппорты сохраняются (как в их планнере)
    picker = null;
    persistAndRender();
  }

  function pickSupport(gi: number, idx: number | null, en: string, ru: string | null): void {
    const g = state.groups[gi];
    if (!g) return;
    const ruName = ru && ru !== en ? ru : supportsBox?.ruByEn.get(en) ?? null;
    const dup = g.supports.findIndex((s) => s.en === en);
    if (idx == null) {
      // в первый свободный слот; дубликат не добавляем
      if (dup >= 0) return;
      if (g.supports.length < MAX_SUPPORTS) g.supports.push({ en, ru: ruName });
    } else {
      // замена конкретного слота (дубликат из другого слота убираем)
      if (dup >= 0) g.supports.splice(dup, 1);
      if (idx >= g.supports.length) g.supports.push({ en, ru: ruName });
      else g.supports[idx] = { en, ru: ruName };
    }
    picker = null;
    persistAndRender();
  }

  btn?.addEventListener('click', () => {
    if (rendered) return;
    rendered = true;
    persistAndRender();
    setStatus('Планнер открыт: клик по ячейке — выбор гема/саппорта, рекомендованные сверху. Сохраняется локально.');

    const el0 = out();
    el0?.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;

      // закрытие пикера (гем/gear)
      if (t.closest('[data-picker-close]')) { picker = null; gearPicker = null; persistAndRender(); return; }

      // гир: очистка слота (✕)
      const gx = t.closest<HTMLElement>('[data-gear-x]');
      if (gx) {
        const slotBtn = gx.closest<HTMLElement>('[data-gear-slot]');
        if (slotBtn) { state.gear[slotBtn.dataset.gearSlot!] = ''; gearPicker = null; persistAndRender(); }
        return;
      }

      // гир: выбор уника из пикера
      const gpick = t.closest<HTMLElement>('[data-gear-pick]');
      if (gpick && gearPicker) {
        state.gear[gearPicker.slot] = gpick.dataset.gearPick!;
        gearPicker = null;
        persistAndRender();
        return;
      }

      // гир: сохранить своё имя/Rare
      const gsave = t.closest<HTMLElement>('[data-gear-custom-save]');
      if (gsave && gearPicker) {
        const input = el0?.querySelector<HTMLInputElement>('[data-gear-custom]');
        state.gear[gearPicker.slot] = (input?.value ?? '').trim();
        gearPicker = null;
        persistAndRender();
        return;
      }

      // гир: клик по слоту → открыть пикер предмета
      const gslot = t.closest<HTMLElement>('[data-gear-slot]');
      if (gslot) {
        gearPicker = { slot: gslot.dataset.gearSlot! };
        picker = null;
        persistAndRender();
        return;
      }

      // выбор из пикера
      const pick = t.closest<HTMLElement>('[data-pick]');
      if (pick && picker) {
        const gi = picker.group;
        const en = pick.dataset.pick!;
        const ru = pick.dataset.pickRu || null;
        if (picker.kind === 'gem') pickGem(gi, en, ru);
        else if (picker.index == null) pickSupport(gi, null, en, ru);
        else pickSupport(gi, picker.index, en, ru);
        return;
      }

      // крестик удаления на ячейке
      const x = t.closest<HTMLElement>('[data-x]');
      if (x) {
        const card = x.closest<HTMLElement>('[data-group]')!;
        const cell = x.closest<HTMLElement>('.pl-cell')!;
        const gi = Number(card.dataset.group);
        if (cell.classList.contains('pl-cell-main') || cell.classList.contains('pl-cell-gem')) {
          state.groups[gi] = { gem: '', supports: [] };
        } else {
          const cells = [...card.querySelectorAll('.pl-cell-sup')];
          state.groups[gi]?.supports.splice(cells.indexOf(cell), 1);
        }
        picker = null;
        persistAndRender();
        return;
      }

      // клик по ячейке → открыть пикер
      const cell = t.closest<HTMLElement>('.pl-cell');
      if (cell) {
        const card = cell.closest<HTMLElement>('[data-group]')!;
        const gi = Number(card.dataset.group);
        if (cell.classList.contains('pl-cell-main') || cell.classList.contains('pl-cell-gem')) {
          picker = { group: gi, kind: 'gem', index: null };
        } else {
          const cells = [...card.querySelectorAll('.pl-cell-sup')];
          const idx = cells.indexOf(cell);
          const filled = Boolean(state.groups[gi]?.supports[idx]);
          picker = { group: gi, kind: 'support', index: filled ? idx : null };
        }
        persistAndRender();
        return;
      }

      // быстрое добавление рекомендованного саппорта
      const quick = t.closest<HTMLElement>('[data-quick-support]');
      if (quick) {
        const gi = Number(quick.closest<HTMLElement>('[data-group]')?.dataset.group);
        const g = state.groups[gi];
        const en = quick.dataset.quickSupport!;
        if (g?.gem && g.supports.length < MAX_SUPPORTS && !g.supports.some((s) => s.en === en)) {
          g.supports.push({ en, ru: supportsBox?.ruByEn.get(en) ?? null });
          persistAndRender();
        }
        return;
      }

      if (t.id === 'pl-share') {
        const url = location.href;
        void navigator.clipboard?.writeText(url).then(() => {
          const note = document.getElementById('pl-summary-note');
          if (note) note.textContent = 'Ссылка с планом в буфере — откроется точно с этим билдом (план в URL, приоритетнее local).';
        });
        return;
      }

      if (t.id === 'pl-copy') {
        void navigator.clipboard?.writeText(summaryText(state)).then(() => {
          const note = document.getElementById('pl-summary-note');
          if (note) note.textContent = 'Сводка в буфере — вставь куда нужно.';
        });
      }
    });

    // Escape — закрыть открытые пикеры (гем/саппорт/предмет), не меняя план
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape' || !out()) return;
      if (!picker && !gearPicker) return;
      picker = null;
      gearPicker = null;
      persistAndRender();
    });

    // поиск в пикере (живой фильтр, без ререндера!)
    el0?.addEventListener('input', (ev) => {
      const t = ev.target as HTMLElement;
      const search = t.closest<HTMLElement>('[data-picker-search]');
      if (search) {
        const q = (search as HTMLInputElement).value.trim().toLowerCase();
        el0.querySelectorAll<HTMLElement>('.pl-picker-item').forEach((item) => {
          if (!item.dataset.pick && !item.dataset.gearPick) return;
          const name = item.dataset.pick ?? item.dataset.gearPick ?? '';
          const s = (item.dataset.search ?? '') + ' ' + name.toLowerCase();
          item.style.display = q && !s.includes(q) ? 'none' : '';
        });
        return;
      }
      if ('gearCustom' in ((t as HTMLInputElement).dataset ?? {})) return; // сохранение по OK/Enter
    });
    // Enter в поле «своё имя/Rare» — сохранить и закрыть
    el0?.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      const input = (ev.target as HTMLElement).closest<HTMLInputElement>('[data-gear-custom]');
      if (!input || !gearPicker) return;
      state.gear[gearPicker.slot] = input.value.trim();
      gearPicker = null;
      persistAndRender();
    });
  });
}
