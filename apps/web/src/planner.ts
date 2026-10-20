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
import { ruToEnName, normRuEnKey } from '@poe2-kit/core';

// ─── Типы ────────────────────────────────────────────────────────────────────

interface PlannerSupport { en: string; ru: string | null }
interface PlannerGroup { gem: string; supports: PlannerSupport[] }
/** План дерева (числовые GGG skill-id; контракт = treeGame mount GamePlan). */
interface TreePlan { class: string; allocated: number[]; ascendancy?: string }
interface PlannerState { groups: PlannerGroup[]; gear: Record<string, string>; tree?: TreePlan }

const LS_KEY = 'poe2kit-planner-v1';
/** Уровень персонажа (гейт гемов): локальная Viewing-настройка, паттерн poe2k.league (ui.ts). В #pl= НЕ кодируется — это не часть билда. */
const PLVL_KEY = 'poe2k.plvl';
const MAX_SUPPORTS = 5;
/** Потолок скилл-групп (как у зрелых планнеров — независимо от оружия/сетов). */
const MAX_GROUPS = 12;
/** Базовое число видимых карточек; фактический рендер — занятые группы + 1 резерв (до MAX_GROUPS). */
const BASE_GROUPS = 3;

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

// ─── Каталог базовых предметов (rare-основа, трек B: bases_catalog.json) ──────

interface BaseItem { name: string; ruName?: string | null; itemClass?: string | null; slot?: string | null }
let basesCache: BaseItem[] | null = null;
async function ensureBases(): Promise<BaseItem[]> {
  if (basesCache) return basesCache;
  try {
    const base = import.meta.env.BASE_URL ?? '/';
    const raw = (await fetch(base + 'datasets/bases_catalog.json').then((r) => r.json())) as { bases?: BaseItem[] };
    basesCache = (raw.bases ?? []).filter((b) => b && b.name);
  } catch {
    basesCache = []; // офлайн/нет датасета — секция баз просто не показывается
  }
  return basesCache;
}

/** Слот гира → slot-ключи bases_catalog (сингулярные, из «slot» базы). */
const GEAR_BASE_SLOTS: Record<string, string[]> = {
  weapon: ['weapon'], offhand: ['shield', 'quiver'], helmet: ['helmet'], body: ['body'],
  gloves: ['gloves'], boots: ['boots'], belt: ['belt'], ring1: ['ring'], ring2: ['ring'],
  amulet: ['amulet'], flask: ['flask'],
};

// ─── Импорт билда из «Билдов»/«Гайдов» (одноразовая очередь через sessionStorage) ──

export interface PlannerImport {
  /** Название билда (для статуса-строки). */
  title: string;
  /** Базовый класс display-именем GGG ('Monk'). */
  class?: string;
  /** Асценданси display-именем ('Invoker'). */
  ascendancy?: string;
  /** Скилл-группы: главный гем + саппорты (EN). */
  groups?: Array<{ gem: string; supports: string[] }>;
  /** Ключевые уники (EN) — раскладка по слотам через uniques_catalog. */
  uniques?: string[];
  /** План прокачки гайдом: гемы по уровню взятия (RU-имена из гайда). */
  leveling?: Array<{ level: number; name: string; cat?: string }>;
  /** Дерево пассивок гайда (poeshop RSC code, №582): n — базовые GGG node ids,
   *  n1/n2 — узлы наборов оружия (weapon set 1/2; на сцены уходит merge всех). */
  tree?: { a?: string; n: number[]; n1?: number[]; n2?: number[] };
}

const IMPORT_KEY = 'poe2kit-planner-import';

// 🧭 План прокачки из гайда: гемы по уровням взятия (RU-имена как в гайде).
// Модульный уровень (не state): viewing-данные импорта — в LS/share не кодируются.
let importedLeveling: Array<{ level: number; name: string; cat?: string }> = [];
/** Уники, не разложившиеся по слотам (диагностика для юзера, честно). */
let unplacedUniques: string[] = [];

/** Из карточки билда/гайда: положить билд в очередь и открыть Планнер. */
export function queuePlannerImport(q: PlannerImport): void {
  try { sessionStorage.setItem(IMPORT_KEY, JSON.stringify(q)); } catch { /* очередь недоступна — молча */ }
  const tab = document.querySelector<HTMLButtonElement>('[data-tab="planner"]');
  tab?.click();
  setStatus(`«${q.title}» → Планнер: гемы, уники по слотам${q.class ? ', класс' : ''}${q.tree?.n?.length ? ` и дерево гайда (${q.tree.n.length} узлов)` : q.class ? ' и стартовое кольцо дерева' : ''}. Качай узлы кликами.`);
}

function readImportQueue(): PlannerImport | null {
  try {
    const raw = sessionStorage.getItem(IMPORT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(IMPORT_KEY); // очередь одноразовая
    const q = JSON.parse(raw) as PlannerImport;
    if (!q || typeof q !== 'object') return null;
    return q;
  } catch { return null; }
}

/** Уник → слот по категориям uniques_catalog (первый свободный подходящий). */
function slotForUnique(name: string, byCategory: UniquesByCategory, occupied: Set<string>): (typeof GEAR_SLOTS)[number] | null {
  const lower = name.trim().toLowerCase();
  for (const slot of GEAR_SLOTS) {
    if (occupied.has(slot.id)) continue;
    if (slot.cats.some((c) => (byCategory[c] ?? []).some((n) => n.trim().toLowerCase() === lower))) return slot;
  }
  return null;
}

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
    // дерево: t=[class, asc|'', allocated] — компактно, v1-читатели игнорируют
    const t = s.tree ? [s.tree.class, s.tree.ascendancy ?? '', s.tree.allocated] : undefined;
    return btoa(JSON.stringify({ g: min, gear: s.gear, ...(t ? { t } : {}) }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch { return ''; }
}

function decodeShare(seg: string): PlannerState | null {
  try {
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    const raw = JSON.parse(atob(b64)) as {
      g?: Array<[string, string[]]>;
      gear?: Record<string, string>;
      t?: [string, string, number[]];
    };
    if (!Array.isArray(raw.g)) throw new Error('схема');
    const groups = raw.g.slice(0, MAX_GROUPS).map(([gem, sup]) => ({
      gem: String(gem ?? ''),
      supports: (sup ?? []).slice(0, MAX_SUPPORTS).map((en) => ({ en: String(en), ru: null })),
    }));
    // v2-дерево: валидируем форму, чтобы битые ссылки не роняли планнер
    let tree: TreePlan | undefined;
    if (raw.t && typeof raw.t[0] === 'string' && Array.isArray(raw.t[2])) {
      tree = { class: raw.t[0], allocated: raw.t[2].filter((n) => Number.isInteger(n) && n > 0) };
      if (raw.t[1]) tree.ascendancy = raw.t[1];
    }
    return { groups, gear: raw.gear ?? {}, ...(tree ? { tree } : {}) };
  } catch { return null; }
}

function loadState(): PlannerState {
  // ссылка-план приоритетнее localStorage: чужой план открываем, а не свой
  const m = /(?:^|[#&])pl=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (m) {
    const shared = decodeShare(m[1]);
    if (shared) {
      while (shared.groups.length < BASE_GROUPS) shared.groups.push({ gem: '', supports: [] });
      return shared;
    }
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) throw new Error('пусто');
    const parsed = JSON.parse(raw) as PlannerState;
    if (!Array.isArray(parsed.groups) || typeof parsed.gear !== 'object') throw new Error('схема');
    // v2: сохранённый tree-план (числовые id из treeGame mount)
    let tree: TreePlan | undefined;
    if (parsed.tree && typeof parsed.tree.class === 'string' && Array.isArray(parsed.tree.allocated)) {
      tree = {
        class: parsed.tree.class,
        allocated: parsed.tree.allocated.filter((n) => Number.isInteger(n) && n > 0),
        ...(parsed.tree.ascendancy ? { ascendancy: parsed.tree.ascendancy } : {}),
      };
    }
    return {
      groups: parsed.groups.slice(0, MAX_GROUPS),
      gear: parsed.gear ?? {},
      ...(tree ? { tree } : {}),
    };
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

// ─── Уровень персонажа (гейт гемов по требованию ступени) ──────────────────────

function loadCharLevel(): number {
  const n = Number(localStorage.getItem(PLVL_KEY));
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : 100;
}

let charLevel = loadCharLevel();

function saveCharLevel(n: number): void {
  try { localStorage.setItem(PLVL_KEY, String(n)); } catch { /* quota — молча */ }
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

// Браузерный RU→EN-словарь уников (№581): core.ruToEnName читает items_ru.json
// через node:fs, в браузере HAS_DISK=false → карты пустые → RU-имена из карточек
// гайдов не резолвятся. Компактный JSON (ключи уже нормализованы как normRuEnKey)
// кладёт copy-datasets.mjs → datasets/ru_en_uniques.json.
let ruEnDictBox: Map<string, string> | null = null;
async function ensureRuEnDict(): Promise<Map<string, string>> {
  if (ruEnDictBox) return ruEnDictBox;
  try {
    const base = import.meta.env.BASE_URL ?? '/';
    const raw = (await fetchJson(base + 'datasets/ru_en_uniques.json')) as { uniques?: Record<string, string> };
    ruEnDictBox = new Map(Object.entries(raw.uniques ?? {}));
  } catch {
    ruEnDictBox = new Map(); // офлайн/нет датасета — фолбэк молчит, уники честно в «Не разложено»
  }
  return ruEnDictBox;
}

async function ensureGemColors(): Promise<Record<string, string>> {
  if (gemColorsBox) return gemColorsBox;
  const base = import.meta.env.BASE_URL ?? '/';
  const raw = (await fetchJson(base + 'datasets/gem_colors.json')) as { map?: Record<string, string> };
  gemColorsBox = raw.map ?? {};
  return gemColorsBox;
}

// ─── Гейт гемов: unlock-уровень из skill_gems_v2 (levels[].levelRequirement) ──

/**
 * Ключ имени гема для сопоставления с датасетом: пул планнера — слаги poe2db
 * ('wind serpents fury', 'companion%3a %7b0%7d'), датасет — display-имена
 * ('Wind Serpent's Fury', 'Companion: {0}'). Нормализация: lower + снятие
 * апострофов + URL-decode слэгов.
 */
function gemNameKey(s: string): string {
  const norm = (x: string): string => x.trim().toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ');
  let n = norm(s);
  try {
    const d = decodeURIComponent(n);
    if (d) n = norm(d);
  } catch { /* '%' без кодирования — оставляем как есть */ }
  return n;
}

interface RawGemLevel { levelRequirement?: number }
interface RawGemV2 { name?: string; levels?: Array<RawGemLevel> | Record<string, RawGemLevel> }

let unlocksBox: Map<string, number | null> | null = null;

/**
 * unlock-уровень гема. Поля unlockLevel в датасетах НЕТ — только ступени
 * levels[].levelRequirement; канон проекта = core dataset.ts (GemSource.unlockLevel):
 * первая ступень с требованием > 0, иначе ступень 1, иначе null (не гейтим:
 * саппорт-записи без ступеней, внутренние гемы, слаги вне датасета).
 */
async function ensureUnlocks(): Promise<Map<string, number | null>> {
  if (unlocksBox) return unlocksBox;
  const byName = new Map<string, number | null>();
  try {
    const base = import.meta.env.BASE_URL ?? '/';
    const raw = await fetchJson(base + 'datasets/skill_gems_v2.json') as { skills?: Record<string, RawGemV2> };
    core.dataset.installBrowserDataset('skill_gems/skill_gems_v2.json', raw);
    for (const g of Object.values(raw.skills ?? {})) {
      if (!g?.name || !g.levels) continue;
      // levels бывает и массивом, и объектом {lvl: {...}} (Cast on Melee Stun) — как в core rawGems
      const rawLevels: unknown = g.levels;
      const stages: RawGemLevel[] = Array.isArray(rawLevels)
        ? (rawLevels as RawGemLevel[])
        : Object.entries((rawLevels as Record<string, RawGemLevel>)
            ).sort(([a], [b]) => Number(a) - Number(b)).map(([, lv]) => lv);
      const reqs = stages.map((l) => l?.levelRequirement).filter((x): x is number => typeof x === 'number');
      byName.set(gemNameKey(g.name), reqs.find((x) => x > 0) ?? reqs[0] ?? null);
    }
  } catch { /* офлайн/датасета нет — гейт не активен, пикер работает как раньше */ }
  unlocksBox = byName;
  return byName;
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
  unlocks: Map<string, number | null>,
): string {
  const isGem = t.kind === 'gem';
  const pool: Array<{ en: string; ru: string | null; meta?: boolean }> = isGem
    ? box.activeList.map((en) => ({ en, ru: null }))
    : box.allSupports.map((s) => ({ ...s }));
  /** Замок по unlock-уровню: attrs = data-unlock для живого тоггла (без ререндера), badge показывается CSS-ом только у залоченных. */
  const lockOf = (en: string): { cls: string; attrs: string; badge: string } => {
    const un = unlocks.get(gemNameKey(en));
    if (un == null) return { cls: '', attrs: '', badge: '' };
    const locked = un > charLevel;
    return {
      cls: locked ? ' pl-locked' : '',
      attrs: ` data-unlock="${un}"`,
      badge: `<i class="pl-lock" title="требуется ур. ${un}">🔒 ур. ${un}</i>`,
    };
  };
  // для саппортов: рекомендованные первым блоком
  const recoByEn = new Map(recos.map((r) => [r.en, r]));
  const recosPart = !isGem
    ? `<div class="pl-picker-sec">Рекомендованные для ${esc(state.groups[t.group]?.gem ?? '')}</div>` +
      recos.map((r) => {
        const l = lockOf(r.en);
        return `<button type="button" class="pl-picker-item${r.tier === 'meta' ? ' pl-reco-meta' : ''}${l.cls}" data-pick="${esc(r.en)}" data-pick-ru="${esc(box.ruByEn.get(r.en) ?? '')}"${l.attrs}>
           ${gemIcon(r.en, colors, '')}<span>${esc(box.ruByEn.get(r.en) ?? r.en)}</span><i>${r.tier === 'meta' ? 'мета' : `ранг ${r.rank ?? '?'}`}</i>${l.badge}
         </button>`;
      }).join('')
    : '';
  return `<div class="pl-picker" data-picker>
    <div class="pl-picker-top">
      <b>${isGem ? 'Выбор активного гема' : 'Выбор саппорта'}</b>
      <button type="button" class="pl-picker-close" data-picker-close>✕</button>
    </div>
    <input class="pl-picker-search" placeholder="поиск (EN/RU)…" data-picker-search autocomplete="off" />
    ${recosPart}
    <div class="pl-picker-sec">Все (${pool.length}${charLevel < 100 ? ` · ур. перса ${charLevel}` : ''})</div>
    <div class="pl-picker-list">
      ${pool.map((p) => {
        const l = lockOf(p.en);
        return `<button type="button" class="pl-picker-item${l.cls}" data-pick="${esc(p.en)}" data-pick-ru="${esc(p.ru ?? '')}"${l.attrs} data-search="${esc((p.ru ?? '') + ' ' + p.en).toLowerCase()}">
           ${gemIcon(p.en, colors, '')}<span>${esc(p.ru ?? p.en)}${p.ru ? ` <em>${esc(p.en)}</em>` : ''}</span>${l.badge}
         </button>`;
      }).join('')}
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

function gearPickerHtml(slotId: string, state: PlannerState, byCategory: UniquesByCategory, bases: BaseItem[]): string {
  const slot = GEAR_SLOTS.find((s) => s.id === slotId);
  if (!slot) return '';
  const names = [...new Set(slot.cats.flatMap((c) => byCategory[c] ?? []))].sort((a, b) => a.localeCompare(b));
  const baseSlots = GEAR_BASE_SLOTS[slotId] ?? [];
  const baseItems = [...new Set(bases.filter((b) => b.slot && baseSlots.includes(b.slot)))]
    .sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="pl-picker" data-gear-picker data-slot="${esc(slotId)}">
    <div class="pl-picker-top">
      <b>${esc(slot.label)}: выбор предмета</b>
      <button type="button" class="pl-picker-close" data-picker-close>✕</button>
    </div>
    <input class="pl-picker-search" placeholder="поиск уника/базы (EN/RU)…" data-picker-search autocomplete="off" />
    ${itemIconImg(state.gear[slotId] ?? '', 'pl-item-ico pl-item-cur')}
    <div class="pl-picker-list">
      ${names.map((n) =>
        `<button type="button" class="pl-picker-item" data-gear-pick="${esc(n)}" data-search="${esc(n).toLowerCase()}">
           ${itemIconImg(n, 'pl-item-ico') || `<span class="pl-item-ph pl-item-ph-mini">${esc(n.slice(0, 2))}</span>`}<span>${esc(n)}</span>
         </button>`).join('')}
      ${baseItems.length ? `<div class="pl-bases-head dim">базовые предметы (rare-основа):</div>` : ''}
      ${baseItems.map((b) =>
        `<button type="button" class="pl-picker-item pl-item-base" data-gear-pick="${esc(b.name)}" data-search="${esc(((b.ruName ?? '') + ' ' + b.name + ' ' + (b.itemClass ?? '')).toLowerCase())}">
           <span class="pl-item-ph pl-item-ph-mini">${esc(b.name.slice(0, 2))}</span><span>${esc(b.name)}${b.ruName ? ` <span class="dim">· ${esc(b.ruName)}</span>` : ''}</span>
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
  if (state.tree?.allocated.length) {
    lines.push(`Дерево: ${state.tree.class}${state.tree.ascendancy ? ` (${state.tree.ascendancy})` : ''} — ${state.tree.allocated.length} очков`);
  }
  return lines.join('\n') || 'Планнер пуст.';
}

// ─── Вкладка ──────────────────────────────────────────────────────────────────

export function initPlannerTab(): void {
  let rendered = false;
  type PlannerGame = import('./treeGame/mount').GameHandle;
  type NodeInfo = import('./treeGame/mount').GameNodeInfo;
  let game: PlannerGame | null = null;
  /** Стабильный DOM узла дерева: живёт вне innerHTML-перерендеров (appendChild переносит, контекст WebGL не теряется). */
  let treeUI: HTMLElement | null = null;
  const btn = document.querySelector<HTMLButtonElement>('[data-tab="planner"]');
  const out = () => document.getElementById('out-planner');
  const state = loadState();
  // каркас минимум — при рендере число групп пересчитывается (занятые + 1 резерв)
  while (state.groups.length < BASE_GROUPS) state.groups.push({ gem: '', supports: [] });

  // ── Дерево пассивных (D1): WebGL mount из treeGame-чанка ────────────────────

  /** Клик по узлу: взять/снять с path-валидацией (паттерн fullMap handlePlanClick). */
  const handleTreeNodeClick = (info: NodeInfo | null, skill: number): void => {
    if (!game) return;
    const hint = document.querySelector<HTMLElement>('[data-pl-tree-hint]');
    if (!info) { if (hint) hint.textContent = 'структурный узел без имени — не аллоцируется'; return; }
    if (info.isMastery) { if (hint) hint.textContent = 'мастерство — не отдельное очко'; return; }
    if (!state.tree) {
      // первый клик: автостарт от асценданси узла (если есть) или выбранного класса
      const clsSel = document.querySelector<HTMLSelectElement>('[data-pl-class]');
      let cls = info.ascendancy
        ? ([...game.ascByClass.entries()].find(([, ascs]) => ascs.includes(info.ascendancy!))?.[0]
          ?? clsSel?.value ?? 'Monk')
        : (clsSel?.value || 'Monk');
      game.initPlan(cls, info.ascendancy);
      state.tree = { class: cls, allocated: [] };
    }
    const r = game.toggleNode(skill);
    if (r.ok && r.plan) {
      state.tree = { class: r.plan.className, allocated: r.plan.allocated, ...(r.plan.ascendancy ? { ascendancy: r.plan.ascendancy } : {}) };
      // Перекраска сцены (как fullMap applyAllocation): без setBuild WebGL молчит
      game.setBuild(r.plan.allocated.length ? { allocated: r.plan.allocated, ascendId: r.plan.ascendancy || undefined } : null);
      if (hint) hint.textContent = '';
      saveState(state); // план дерева — в общий LS+hash, гемы/гир не трогаем
      refreshTreeUI();
    } else if (hint) {
      hint.textContent = r.hint ?? 'не удалось изменить план';
    }
  };

  /** Счётчик очков + подпись класса/асценданси в UI дерева (и факт-плитка вкладки). */
  function refreshTreeUI(): void {
    const pts = document.querySelector<HTMLElement>('[data-pl-points]');
    if (pts) pts.textContent = String(state.tree?.allocated.length ?? 0);
    const fact = document.querySelector<HTMLElement>('#pl-fact-tree');
    if (fact) fact.textContent = String(state.tree?.allocated.length ?? 0);
    const clsSel = document.querySelector<HTMLSelectElement>('[data-pl-class]');
    const ascSel = document.querySelector<HTMLSelectElement>('[data-pl-asc]');
    if (clsSel && state.tree) clsSel.value = state.tree.class;
    if (ascSel && state.tree?.ascendancy) ascSel.value = state.tree.ascendancy;
  }

  /** Ленивый монтаж WebGL-дерева (один раз на вкладку; Pixi живёт в стаб-узле). */
  async function ensureTreeUI(): Promise<void> {
    const el = out();
    if (!el || treeUI) return;
    treeUI = document.createElement('div');
    treeUI.className = 'pl-tree-ui';
    treeUI.innerHTML = `
      <h3>Пассивное дерево</h3>
      <div class="pl-tree-ctl">
        <label>класс <select data-pl-class></select></label>
        <label>асценданси <select data-pl-asc><option value="">—</option></select></label>
        <span class="pl-tree-pts">очков: <b data-pl-points>0</b></span>
        <button type="button" class="tab" data-pl-tree-reset>♻ Сброс дерева</button>
      </div>
      <div class="pl-tree-mount" data-pl-tree-mount><span class="dim">⏳ грузим WebGL-данные дерева…</span></div>
      <p class="hint" data-pl-tree-hint>Клик по узлу — взять очко (с достройкой пути от старта класса), повторный — снять. План дерева входит в общий план (localStorage + ссылка).</p>`;
    el.appendChild(treeUI);

    const host = treeUI.querySelector<HTMLElement>('[data-pl-tree-mount]')!;
    const clsSel = treeUI.querySelector<HTMLSelectElement>('[data-pl-class]')!;
    const ascSel = treeUI.querySelector<HTMLSelectElement>('[data-pl-asc]')!;
    try {
      const mod = await import('./treeGame/mount');
      game = await mod.mountGameTree(host, { onNodeClick: handleTreeNodeClick, allocation: null });
      // race: вкладку могли покинуть, пока шёл async-mount → host уже оторван от DOM.
      // Незамедлительно демонтируем, иначе Pixi-контекст повиснет на detached-узле.
      if (!host.isConnected) { game.unmount(); game = null; return; }
      // селекторы: классы/асценданси из GGG data.json
      clsSel.innerHTML = [...game.ascByClass.keys()].sort().map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      const fillAsc = (cls: string) => {
        const ascs = game?.ascByClass.get(cls) ?? [];
        const cur = ascSel.value;
        ascSel.innerHTML = ['<option value="">—</option>', ...ascs.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`)].join('');
        if (ascs.includes(cur)) ascSel.value = cur;
      };
      clsSel.addEventListener('change', () => { fillAsc(clsSel.value); if (game) game.setClass(clsSel.value || undefined); });
      ascSel.addEventListener('change', () => {
        if (!game) return;
        if (state.tree) {
          game.planSetAscendancy(ascSel.value || undefined);
          const p = game.getPlan();
          if (p) {
            state.tree = { class: p.className, allocated: p.allocated, ...(p.ascendancy ? { ascendancy: p.ascendancy } : {}) };
            game.setBuild(p.allocated.length ? { allocated: p.allocated, ascendId: p.ascendancy || undefined } : null); // перекраска под новую ветку
            saveState(state);
          }
        } else game.setAscendancy(ascSel.value || undefined);
        refreshTreeUI();
      });
      // восстановить сохранённый план (LS/ссылка) в живое дерево
      if (state.tree && state.tree.allocated.length) {
        const ok = game.restorePlan({ className: state.tree.class, allocated: state.tree.allocated, ascendancy: state.tree.ascendancy });
        if (ok) { fillAsc(state.tree.class); game.setClass(state.tree.class); }
        // и сразу подсветить взятые узлы (иначе план восстановлен, а сцена пуста)
        game.setBuild({ allocated: state.tree.allocated, ascendId: state.tree.ascendancy || undefined });
      } else {
        const cls = state.tree?.class ?? 'Monk';
        game.setClass(clsSel.value = cls);
        fillAsc(cls);
        // пустой план с выбранным классом (импорт из Билдов/Гайдов): кольцо + диск ветки сразу
        if (state.tree?.ascendancy) {
          game.setAscendancy(state.tree.ascendancy);
          ascSel.value = state.tree.ascendancy;
        }
      }
      refreshTreeUI();
      treeUI.querySelector('[data-pl-tree-reset]')?.addEventListener('click', () => {
        game?.resetPlan();
        game?.setBuild(null); // снять подсветку всех узлов
        state.tree = undefined;
        saveState(state);
        refreshTreeUI();
        const hint = treeUI?.querySelector<HTMLElement>('[data-pl-tree-hint]');
        if (hint) hint.textContent = '';
      });
    } catch (e) {
      host.innerHTML = `<p class="note">⚠ Дерево не загрузилось: ${esc(String(e))}</p>`;
    }
  }


  async function render(): Promise<void> {
    const el = out();
    if (!el) return;
    const box = await ensureSupports();
    const { byCategory } = await ensureUniques();
    const bases = await ensureBases();
    const colors = await ensureGemColors();
    const unlocks = await ensureUnlocks();
    iconMap = await ensureIconUrls();
    await ensureItemIcons();

    const groupHtmls: string[] = [];
    // динамический счётчик карточек: занятые + одна свободная под набор, минимум BASE_GROUPS
    const filled = state.groups.filter((g) => g.gem || g.supports.length).length;
    const renderCount = Math.min(MAX_GROUPS, Math.max(BASE_GROUPS, filled + 1));
    while (state.groups.length < renderCount) state.groups.push({ gem: '', supports: [] });
    for (let i = 0; i < renderCount; i++) {
      const gem = state.groups[i]?.gem ?? '';
      const recos: RecoLite[] = gem ? core.gemSupports.supportsForActive(gem) : [];
      groupHtmls.push(groupHtml(i, state, recos, colors, box.ruByEn));
    }

    let pickerPart = '';
    if (picker) {
      const recos: RecoLite[] = picker.kind === 'support' && state.groups[picker.group]?.gem
        ? core.gemSupports.supportsForActive(state.groups[picker.group].gem)
        : [];
      pickerPart = pickerHtml(picker, state, colors, box, recos, unlocks);
    }

    el.innerHTML = `
      <div class="sim-facts">
        <div class="sim-fact"><b>${box.activeList.length}</b><span>активных гемов с рекомендациями</span></div>
        <div class="sim-fact"><b>${box.allSupports.length}</b><span>саппортов в пикере</span></div>
        <div class="sim-fact"><b>${state.groups.filter((g) => g.gem).length}/${MAX_GROUPS}</b><span>скилл-групп занято</span></div>
        <div class="sim-fact"><b>${GEAR_SLOTS.filter((s) => state.gear[s.id]).length}/${GEAR_SLOTS.length}</b><span>слотов гира заполнено</span></div>
        <div class="sim-fact"><b id="pl-fact-tree">${state.tree?.allocated.length ?? 0}</b><span>очков дерева взято</span></div>
        <div class="sim-fact pl-lvl-fact">
          <label class="pl-lvl">ур. перса <input type="number" min="1" max="100" step="1" value="${charLevel}" data-pl-lvl autocomplete="off" /></label>
          <span>гейт гемов по unlock (уровень локальный, в ссылку не входит)</span>
        </div>
      </div>
      <div class="pl-groups">${groupHtmls.join('')}</div>
      ${levelingHtml()}
      ${pickerPart}
      <h3>Экипировка</h3>
      <p class="hint">Клик по слоту — выбор уника (пикер, иконки = poe2db-арт GGG); внизу пикера — своё имя/Rare. ✕ на hover — очистить. Иконки догружаются фоном (харвест волне №565).</p>
      ${unplacedUniques.length ? `<p class="note">⚠ Не разложено по слотам: ${unplacedUniques.map(esc).join(', ')} — имени нет в каталоге уников (проверь вручную в пикере).</p>` : ''}
      ${gearHtml(state)}
      ${gearPicker ? gearPickerHtml(gearPicker.slot, state, byCategory, bases) : ''}
      <div class="lvset" style="margin-top:12px"><button id="pl-copy" class="tab">📋 Копировать сводку</button> <button id="pl-share" class="tab">🔗 Поделиться планом</button></div>
      <p class="dim" id="pl-summary-note"></p>`;
    // стаб-узел дерева переживает innerHTML: appendChild переносит тот же DOM (+WebGL-контекст)
    if (treeUI) el.appendChild(treeUI);
  }

  /** 🧭 Блок «Как прокачиваться» — план по уровням из импортированного гайда. */
  function levelingHtml(): string {
    if (!importedLeveling.length) return '';
    const rows = importedLeveling
      .map(
        (s) =>
          `<tr><td class="num">ур. ${s.level}</td><td>${esc(s.name)}${s.cat ? ` <span class="dim">· ${esc(s.cat)}</span>` : ''}</td></tr>`,
      )
      .join('');
    return `
      <h3>🧭 Как прокачиваться (план из гайда)</h3>
      <p class="hint">Гемы по уровню взятия — из датасета гайда (как в его скилл-таблице). Дерево планнера — под твой класс${state.tree?.ascendancy ? `/${esc(state.tree.ascendancy)}` : ''}; авто-узлов из гайда нет (у карточек нет PoB-кода) — ветку берись по приоритету скиллов ниже.</p>
      <div class="pl-leveling"><table class="tbl"><thead><tr><th>Уровень</th><th>Гем</th></tr></thead><tbody>${rows}</tbody></table></div>`;
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

  /**
   * Освободить WebGL-дерево при уходе со вкладки (риск «память ×2», D1).
   * GameHandle.unmount → React-cleanup TreeView → app.destroy(true,{children:true})
   * (контекст/тикер/листенеры чистятся, await-init-guard защищает быстрый switch).
   * Модульный кэш mount.ts (данные+атласы) НЕ сбрасываем: он общий с вкладкой «Карта»
   * и делает повторный mount быстрым — резидентская цена принята осознанно.
   */
  function teardownTree(): void {
    if (!game && !treeUI) return;
    try { game?.unmount(); } catch { /* React-18 warns на setState после unmount — не критично */ }
    game = null;
    treeUI?.remove();
    treeUI = null;
    // восстановленный план дерева не теряется: он в state.tree → LS/hash
  }

  // Уход со вкладки ловим MutationObserver'ом класса #pane-planner: это закрывает ВСЕ пути
  // (клики по табам и selectGroup('now'), который скрывает панели напрямую, без tab-click).
  const pane = document.getElementById('pane-planner');
  if (pane) {
    new MutationObserver(() => {
      if (!pane.classList.contains('active')) teardownTree();
    }).observe(pane, { attributes: true, attributeFilter: ['class'] });
  }

  /** Применить импорт из очереди к текущему состоянию (перезаписывает план). */
  async function applyImport(q: PlannerImport): Promise<void> {
    const groups = (q.groups ?? []).slice(0, MAX_GROUPS).map((g) => ({
      gem: String(g.gem ?? ''),
      supports: (g.supports ?? []).slice(0, MAX_SUPPORTS).map((en) => ({ en: String(en), ru: null })),
    }));
    while (groups.length < BASE_GROUPS) groups.push({ gem: '', supports: [] });
    state.groups = groups;
    state.gear = {};
    unplacedUniques = [];
    if (q.uniques?.length) {
      const [{ byCategory }, ruEnDict] = await Promise.all([ensureUniques(), ensureRuEnDict()]);
      const occupied = new Set<string>();
      for (const n of q.uniques) {
        // карточки гайдов дают RU-имена уников — резолвим в EN (core ruLocale);
        // в браузере FS недоступна → fallback на браузерный словарь ru_en_uniques.json
        const en = slotForUnique(n, byCategory, occupied) ? n : ruToEnName(n) || (ruEnDict.get(normRuEnKey(n)) ?? '');
        const slot = en ? slotForUnique(en, byCategory, occupied) : null;
        if (slot) { state.gear[slot.id] = en; occupied.add(slot.id); }
        else unplacedUniques.push(n);
      }
    }
    // 🧭 план прокачки: гемы гайда по уровню взятия (сортировка по возрастанию)
    importedLeveling = (q.leveling ?? [])
      .filter((s) => Number.isFinite(s.level) && s.name)
      .slice()
      .sort((a, b) => a.level - b.level);
    // класс/асценданси: дерево гайда (poeshop RSC code, №582) — приоритетный
    // источник узлов; если у гайда дерева нет — прежний префилл из PoB того же
    // класса, который ранее импортировался через вкладку «Древо» (честно: без
    // PoB/дерева гайда узлов нет, только стартовое кольцо)
    if (q.class) {
      let pre: number[] = [];
      try {
        const saved = JSON.parse(localStorage.getItem('poe2k.plan') ?? '') as { c?: string; n?: number[] };
        if (saved && typeof saved.c === 'string' && saved.c.toLowerCase() === q.class.toLowerCase() && Array.isArray(saved.n)) {
          pre = saved.n.filter((x) => Number.isInteger(x)).map(Number);
        }
      } catch { /* битый LS — не падаем, просто без префилла */ }
      // дерево гайда: базовые узлы + наборы оружия (n/n1/n2 merge, dedupe);
      // привязка узлов к наборам (weaponSets-подсветка) — отдельная волна, №582+
      const tn = q.tree;
      const guideNodes = tn
        ? [...new Set([...(Array.isArray(tn.n) ? tn.n : []), ...(Array.isArray(tn.n1) ? tn.n1 : []), ...(Array.isArray(tn.n2) ? tn.n2 : [])])]
            .filter((x) => Number.isInteger(x))
            .map(Number)
        : [];
      state.tree = {
        class: q.class,
        allocated: guideNodes.length ? guideNodes : pre,
        ...(q.ascendancy ? { ascendancy: q.ascendancy } : {}),
      };
    }
    saveState(state);
  }

  btn?.addEventListener('click', () => {
    // очередь импорта из карточек билдов/гайдов — приоритетнее обычного открытия
    const q = readImportQueue();
    const mountTree = (): void => { if (!treeUI) void ensureTreeUI(); };
    if (q) {
      void applyImport(q).then(() => { rendered = true; persistAndRender(); mountTree(); });
      return;
    }
    if (rendered) {
      // возврат после unmount-on-leave: дерево монтируем заново (данные в module-кэше — быстро)
      mountTree();
      return;
    }
    rendered = true;
    persistAndRender();
    mountTree();
    setStatus('Планнер открыт: клик по ячейке — выбор гема/саппорта, рекомендованные сверху. Дерево пассивных внизу вкладки. Сохраняется локально.');

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
        // гейт: gem unlock > текущего уровня персонажа — выбор запрещён, пикер жив (пользователь видит, что откроется)
        const un = Number(pick.dataset.unlock);
        if (pick.dataset.unlock !== undefined && Number.isFinite(un) && un > charLevel) {
          setStatus(`«${ru || en}» открывается с ур. ${un} (твой уровень: ${charLevel}) — подними уровень в панели счетчиков.`);
          return;
        }
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
      // уровень персонажа: живой тоггл замков пикера без ререндера (фокус/поиск не теряются)
      const lvlIn = t.closest<HTMLInputElement>('[data-pl-lvl]');
      if (lvlIn) {
        const n = Math.max(1, Math.min(100, Math.round(Number(lvlIn.value) || 1)));
        lvlIn.value = String(n);
        if (n !== charLevel) {
          charLevel = n;
          saveCharLevel(n);
          el0.querySelectorAll<HTMLElement>('.pl-picker-item[data-unlock]').forEach((item) => {
            item.classList.toggle('pl-locked', Number(item.dataset.unlock) > charLevel);
          });
        }
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
