/**
 * PoE2 Kit — Windows-оверлей.
 *
 * Прозрачное, безрамочное, всегда-поверх, кликабельно-("сквозь") окно поверх игры.
 * Глобальные хоткеи (по умолчанию Ctrl+F1..F5) читают предмет из буфера обмена
 * (в игре PoE2 предсмет копируется в клир-текст через Ctrl+C), прогоняет его через
 * единое ядро (@poe2-kit/core -> priceCheck) и показывает результат во флоат-виджете.
 *
 * В main-процессе нет CORS-ограничений браузера, поэтому ядро ходит в
 * poe.ninja / poe2scout / trade2 напрямую (то же, что и в MCP/CLI).
 */
import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  screen,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { core } from '@poe2-kit/core';
import { rendererHtml } from './rendererHtml.js';
import { findGameWindow, isGameForeground } from './win32.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Файловый лог: дублируем console в userData/overlay.log ─────────────────
// Удобно смотреть, когда окно start-overlay закрыто/не под рукой.
const LOG_MAX_BYTES = 1_000_000;

function logFilePath(): string {
  return path.join(app.getPath('userData'), 'overlay.log');
}

function rotateLogIfNeeded(file: string): void {
  try {
    const stat = fs.statSync(file);
    if (stat.size > LOG_MAX_BYTES) fs.rmSync(`${file}.1`, { force: true });
    fs.renameSync(file, `${file}.1`);
  } catch {
    /* файла ещё нет или занят — не критично */
  }
}

function teeConsoleToFile(): void {
  const stamp = (args: unknown[]): string =>
    `${new Date().toISOString()} ${args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')}\n`;
  for (const method of ['log', 'warn', 'error'] as const) {
    const orig = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      orig(...args);
      try {
        fs.mkdirSync(app.getPath('userData'), { recursive: true });
        const file = logFilePath();
        if (!fs.existsSync(file)) {
          fs.writeFileSync(file, `=== PoE2 Kit overlay log started ${new Date().toISOString()} ===\n`, 'utf8');
        }
        rotateLogIfNeeded(file);
        fs.appendFileSync(file, stamp(args), 'utf8');
      } catch {
        /* запись лога не должна ронять приложение */
      }
    };
  }
}
teeConsoleToFile();

// ─── Настройки по умолчанию ────────────────────────────────────────────────
// Хоткеи — F-клавиши с Ctrl: почти не конфликтуют ни с игрой, ни с Intel/Discord
// (Ctrl+Alt+X/Alt+B часто заняты системным софтом гейм-ПК).
const PRICE_HOTKEY = 'Control+F1';
const LEVELING_HOTKEY = 'Control+F4';
const MOVE_HOTKEY = 'Control+F5';
const BUILD_IMPORT_HOTKEY = 'Control+F3';
const BUILD_PANEL_HOTKEY = 'Control+F2';
const LEAGUE_STORAGE_KEY = 'poe2k.league';

/** Смещение оверлея относительно «закреплённой» позиции (правый верхний угол игры). */
interface OverlayOffset {
  x: number;
  y: number;
}

let activeLeague: string | null = null;
let overlayWindow: BrowserWindow | null = null;
let busy = false;
/** Режим перемещения оверлея (Ctrl+F5): окно кликабельно и таскается мышью. */
let moveUnlocked = false;
/** Пользовательское смещение (DIP) от закреплённой позиции; переживает перезапуск. */
let userOffset: OverlayOffset | null = null;

// ─── Билд-ассистент: шопинг-лист по билду ────────────────────────────────────

/** Слот билда: целевой предмет, его цена и статус сборки. */
interface BuildSlotState {
  slot: string;
  name: string;
  baseType: string;
  rarity: string;
  /** Медианная оценка (в хаосах), null — ещё не оценён. */
  median: number | null;
  confidence: string | null;
  /** todo — ещё не куплен; bought — отмечен собранным (прайс-чек совпавшего предмета). */
  status: 'todo' | 'bought';
  itemText: string;
  /** Что сейчас надето в этом слоте на персонаже (синхронизация с poe.ninja), null — нет данных. */
  worn?: string | null;
}

interface BuildSummaryState {
  worstEhpType: string | null;
  worstEhp: number | null;
  gaps: Array<{ description: string; recommendation: string }>;
  weapon: string | null;
  weaponDps: number | null;
  notes: string[];
}

interface BuildState {
  rawInput: string;
  className?: string;
  ascendancy?: string;
  level?: number;
  skills: string[];
  importedAt: number;
  slots: BuildSlotState[];
  summary: BuildSummaryState | null;
  metaSkills: Array<{ name: string; count: number }> | null;
  /** Показана ли панель билда в виджете. */
  panelVisible: boolean;
}

let buildState: BuildState | null = null;
/** Идёт ли фоновый прайсинг слотов билда. */
let buildPricing = false;

// ─── Автосинхронизация с персонажем poe.ninja ──────────────────────────────

/** Источник синхронизации: публичная страница персонажа в профиле poe.ninja. */
interface CharSyncState {
  account: string;
  league: string;
  character: string;
  /** Unix-ms последней успешной синхронизации (троттлинг запросов). */
  lastSyncAt: number;
}

/** Минимальная пауза между запросами к poe.ninja (мс). */
const CHAR_SYNC_MIN_INTERVAL_MS = 5 * 60_000;

let charSync: CharSyncState | null = null;
let charSyncing = false;

function charSyncFile(): string {
  return path.join(app.getPath('userData'), 'char-sync.json');
}

function loadCharSync(): CharSyncState | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(charSyncFile(), 'utf8'));
    const c = raw as CharSyncState;
    if (c && c.account && c.league && c.character) {
      charSync = { ...c, lastSyncAt: Number(c.lastSyncAt) || 0 };
      return charSync;
    }
  } catch {
    /* нет файла — ок */
  }
  return null;
}

function saveCharSync(): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(charSyncFile(), JSON.stringify(charSync), 'utf8');
  } catch {
    /* некритично */
  }
}

// ─── Геометрия оверлея и привязка к окну игры ──────────────────────────────
const OVERLAY_WIDTH = 420;
const OVERLAY_HEIGHT = 320;
/** Минимальная высота оверлея (DIP). */
const OVERLAY_MIN_HEIGHT = 140;
/** Текущая высота оверлея — подгоняется рендерером под контент (overlay:autosize). */
let overlayHeight = OVERLAY_HEIGHT;
/** Отступ оверлея от краёв игрового окна (в DIP). */
const MARGIN = 8;
/** Подстрока заголовка окна PoE2 (без учёта регистра). */
const GAME_TITLE_KEYWORD = 'Path of Exile';
/** Частота опроса позиции/состояния окна игры (мс). */
const TRACK_INTERVAL_MS = 350;

let lastHwndKey = '';
let lastRectKey = '';
let trackerTimer: NodeJS.Timeout | null = null;

// Единственный экземпляр.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

function isPacked(): boolean {
  return app.isPackaged;
}

/** Путь к файлу с сохранённой лигой (выбор пользователя переживает перезапуск). */
function leagueStateFile(): string {
  return path.join(app.getPath('userData'), 'league.txt');
}

/** Прочитать сохранённую лигу (если пользователь её задавал), иначе null. */
function loadSavedLeague(): string | null {
  try {
    const v = fs.readFileSync(leagueStateFile(), 'utf8').trim();
    return v || null;
  } catch {
    return null;
  }
}

/** Сохранить выбранную лигу; null стирает выбор. */
function saveSavedLeague(league: string | null): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    if (league && league.trim()) fs.writeFileSync(leagueStateFile(), league.trim(), 'utf8');
    else fs.rmSync(leagueStateFile(), { force: true });
  } catch {
    /* игнорируем — выбор лиги не критичен для записи */
  }
}

/** Записываем встроенный HTML-рендерер в userData и возвращаем путь для loadFile. */
function writtenRendererPath(): string {
  const dir = app.getPath('userData');
  const file = path.join(dir, 'overlay.html');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, rendererHtml, 'utf8');
  } catch (err) {
    console.warn('[overlay] failed to write renderer:', err);
  }
  return file;
}

/** Файл со смещением оверлея (выбор пользователя переживает перезапуск). */
function offsetStateFile(): string {
  return path.join(app.getPath('userData'), 'overlay-offset.json');
}

function loadUserOffset(): OverlayOffset | null {
  try {
    const raw = JSON.parse(fs.readFileSync(offsetStateFile(), 'utf8'));
    if (typeof raw?.x === 'number' && typeof raw?.y === 'number') {
      return { x: raw.x, y: raw.y };
    }
    return null;
  } catch {
    return null;
  }
}

function saveUserOffset(offset: OverlayOffset | null): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    if (offset) fs.writeFileSync(offsetStateFile(), JSON.stringify(offset), 'utf8');
    else fs.rmSync(offsetStateFile(), { force: true });
  } catch {
    /* некритично */
  }
}

/** «Закреплённая» позиция оверлея (без пользовательского смещения), в DIP. */
function pinnedPosition(rect: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
} {
  return {
    x: Math.round(rect.x + rect.width - OVERLAY_WIDTH - MARGIN),
    y: Math.round(rect.y + MARGIN),
  };
}

/**
 * Переключить режим перемещения оверлея (Ctrl+F5):
 *  - unlock: окно становится кликабельным/фокусируемым, таскается мышью за полосу-заголовок;
 *  - lock (повторное нажатие): текущая позиция пересчитывается в смещение от
 *    закреплённой точки, сохраняется в userData и применяется трекером дальше.
 */
function toggleMoveMode(): void {
  const win = overlayWindow;
  if (!win || win.isDestroyed()) return;
  moveUnlocked = !moveUnlocked;
  if (moveUnlocked) {
    win.setFocusable(true);
    win.setIgnoreMouseEvents(false);
    win.show();
    win.focus();
  } else {
    // Считаем смещение от «закреплённой» позиции относительно текущего окна игры.
    const found = findGameWindow({ titleKeyword: GAME_TITLE_KEYWORD });
    if (found) {
      const pinned = pinnedPosition(physicalRectToDip(found.rect));
      const [wx, wy] = win.getPosition();
      userOffset = { x: wx - pinned.x, y: wy - pinned.y };
      saveUserOffset(userOffset);
      console.log(`[overlay] позиция закреплена: offset=${JSON.stringify(userOffset)}`);
      lastRectKey = ''; // форсируем следующий setBounds трекера
    }
    win.setFocusable(false);
    win.setIgnoreMouseEvents(true, { forward: true });
  }
  const payload = {
    unlocked: moveUnlocked,
    resetOffset: false,
  };
  overlayWindow?.webContents.send('move:mode', payload);
}

/** Сбросить пользовательское смещение (просто IPC из рендерера). */
function resetOverlayOffset(): void {
  userOffset = null;
  saveUserOffset(null);
  lastRectKey = '';
  console.log('[overlay] смещение сброшено');
}

// ─── Билд-ассистент: импорт из буфера, прайсинг, сопоставление ───────────────

/** Файл состояния билда (переживает перезапуск). */
function buildStateFile(): string {
  return path.join(app.getPath('userData'), 'build-state.json');
}

function loadBuildState(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(buildStateFile(), 'utf8'));
    if (Array.isArray(raw?.slots)) {
      buildState = {
        rawInput: String(raw.rawInput ?? ''),
        className: raw.className,
        ascendancy: raw.ascendancy,
        level: raw.level,
        skills: Array.isArray(raw.skills) ? raw.skills : [],
        importedAt: Number(raw.importedAt) || Date.now(),
        slots: raw.slots as BuildSlotState[],
        summary: raw.summary ?? null,
        metaSkills: raw.metaSkills ?? null,
        panelVisible: false,
      };
      console.log(`[overlay] build restored: slots=${buildState.slots.length} (${buildState.className ?? '?'})`);
    }
  } catch {
    /* файла нет — ок */
  }
}

function saveBuildState(): void {
  if (!buildState) return;
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(buildStateFile(), JSON.stringify(buildState), 'utf8');
  } catch {
    /* некритично */
  }
}

/** Компактный payload панели билда для рендерера. */
function buildPayload(status: 'ready' | 'importing' | 'empty' = 'ready'): Record<string, unknown> {
  if (!buildState) return { status: 'empty', visible: false, build: null };
  const slots = buildState.slots;
  const priced = slots.filter((s) => s.median != null);
  const bought = slots.filter((s) => s.status === 'bought');
  const remaining = priced.filter((s) => s.status !== 'bought');
  return {
    status,
    visible: buildState.panelVisible,
    pricing: buildPricing,
    build: {
      className: buildState.className,
      ascendancy: buildState.ascendancy,
      level: buildState.level,
      skills: buildState.skills.slice(0, 4),
      importedAt: buildState.importedAt,
      slots: slots.map((s) => ({
        slot: s.slot,
        name: s.name,
        rarity: s.rarity,
        median: s.median,
        confidence: s.confidence,
        status: s.status,
        worn: s.worn ?? null,
      })),
      charSync: charSync
        ? {
            character: charSync.character,
            league: charSync.league,
            syncing: charSyncing,
            lastSyncAt: charSync.lastSyncAt,
          }
        : null,
      pricedCount: priced.length,
      totalSlots: slots.length,
      boughtCount: bought.length,
      /** Оценка бюджета: сумма цен ещё не купленных предметов. */
      budgetLeft: remaining.reduce((sum, s) => sum + (s.median ?? 0), 0),
      budgetTotal: priced.reduce((sum, s) => sum + (s.median ?? 0), 0),
      summary: buildState.summary,
      metaSkills: buildState.metaSkills,
    },
  };
}

function sendBuildUpdate(
  extra: { status?: 'ready' | 'importing' | 'empty'; error?: string; info?: string } = {},
): void {
  const payload = buildPayload(extra.status ?? 'ready');
  if (extra.error) payload.error = extra.error;
  if (extra.info) payload.info = extra.info;
  overlayWindow?.webContents.send('build:update', payload);
}

function normName(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/ё/g, 'е')
    .replace(/[''`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ─── Словарь ru↔en: базовые типы и имена уников (poe2db) ────────────────────
// ru-клиент игры даёт русские имена, PoB-билд — английские. Словарь строится
// один раз со страниц ~30 классов снаряжения poe2db и кэшируется в userData
// (ru-en-dict.json). Пока строится — матчинг работает по уже загруженным
// записям (мапы наполняются по мере загрузки страниц).

const EQUIPMENT_CLASS_SLUGS = [
  'Claws', 'Daggers', 'Wands', 'One_Hand_Swords', 'One_Hand_Axes', 'One_Hand_Maces',
  'Sceptres', 'Spears', 'Flails', 'Bows', 'Staves', 'Two_Hand_Swords', 'Two_Hand_Axes',
  'Two_Hand_Maces', 'Quarterstaves', 'Crossbows', 'Traps', 'Talismans', 'Quivers',
  'Shields', 'Bucklers', 'Foci', 'Gloves', 'Boots', 'Body_Armours', 'Helmets',
  'Amulets', 'Rings', 'Belts', 'Jewels',
] as const;

const RU_EN_DICT_VERSION = 1;
const ruEnBases = new Map<string, string>();
const ruEnUniques = new Map<string, string>();
let ruEnDictLoaded = false;
let ruEnDictPromise: Promise<void> | null = null;

function ruEnDictFile(): string {
  return path.join(app.getPath('userData'), 'ru-en-dict.json');
}

function saveRuEnDict(): void {
  try {
    const data = {
      version: RU_EN_DICT_VERSION,
      bases: Object.fromEntries(ruEnBases),
      uniques: Object.fromEntries(ruEnUniques),
    };
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(ruEnDictFile(), JSON.stringify(data), 'utf8');
  } catch {
    /* некритично — в худшем случае пересоберём при следующем запуске */
  }
}

/** Загрузить кэш словаря с диска, если он есть. */
function loadRuEnDict(): boolean {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(ruEnDictFile(), 'utf8'));
    const data = raw as { version?: number; bases?: Record<string, string>; uniques?: Record<string, string> };
    if (data.version !== RU_EN_DICT_VERSION) return false;
    for (const [k, v] of Object.entries(data.bases ?? {})) ruEnBases.set(normName(k), v);
    for (const [k, v] of Object.entries(data.uniques ?? {})) ruEnUniques.set(normName(k), v);
    if (!ruEnBases.size && !ruEnUniques.size) return false;
    console.log(`[overlay] ru-en dict loaded: ${ruEnBases.size} bases, ${ruEnUniques.size} uniques`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Построить словарь ru→en в фоне (один раз): последовательно обходим страницы
 * классов снаряжения poe2db (rate-limiter ядра держит паузу), мапы наполняются
 * по ходу — матчинг может пользоваться частичным словарём уже сейчас.
 */
function ensureRuEnDict(): Promise<void> {
  if (ruEnDictLoaded || ruEnDictPromise) return ruEnDictPromise ?? Promise.resolve();
  ruEnDictPromise = (async () => {
    try {
      for (const slug of EQUIPMENT_CLASS_SLUGS) {
        try {
          const tr = await core.poe2db.fetchClassTranslations(slug, 'ru');
          for (const [k, v] of tr.bases) ruEnBases.set(normName(k), v);
          for (const [k, v] of tr.uniques) ruEnUniques.set(normName(k), v);
          saveRuEnDict(); // прогресс сохраняем по ходу
        } catch (err) {
          console.warn(`[overlay] ru-en dict: ${slug} failed: ${err instanceof Error ? err.message : err}`);
        }
      }
      ruEnDictLoaded = true;
      console.log(`[overlay] ru-en dict built: ${ruEnBases.size} bases, ${ruEnUniques.size} uniques`);
    } finally {
      ruEnDictPromise = null;
    }
  })();
  return ruEnDictPromise;
}

/** Перевести локализованное имя в английское, если есть в словаре (иначе — как есть). */
function toEn(kind: 'base' | 'unique', s: string): string {
  if (!/[а-яё]/i.test(s)) return s; // уже не русское — нечего переводить
  const dict = kind === 'base' ? ruEnBases : ruEnUniques;
  return dict.get(normName(s)) ?? s;
}

/**
 * Сопоставить предмет из игры (клир-текст) со слотом билда.
 * Уники — по имени, остальные — по базовому типу. Русские имена из ru-клиента
 * переводятся в английские словарём poe2db (ru-en-dict.json), так что билд
 * из PoB (en) сопоставляется и в русском клиенте.
 */
function matchBuildSlot(parsedName: string, parsedBase: string): BuildSlotState | null {
  if (!buildState) return null;
  // Русский текст и словарь ещё пуст — подтолкнём фоновую загрузку.
  if (/[а-яё]/i.test(parsedName + parsedBase) && !ruEnDictLoaded) void ensureRuEnDict();
  const n = normName(toEn('unique', parsedName));
  const b = normName(toEn('base', parsedBase));
  if (!n && !b) return null;
  for (const s of buildState.slots) {
    const sn = normName(s.name);
    const sb = normName(s.baseType);
    if ((n && (n === sn || n === sb)) || (b && (b === sn || b === sb))) return s;
  }
  return null;
}

// ─── Автосинхронизация: персонаж профиля poe.ninja ─────────────────────────

/**
 * Скачать эквип с публичной страницы персонажа poe.ninja, отметить совпадающие
 * слоты билда собранными и запомнить, что надето в остальных. Троттлится
 * интервалом CHAR_SYNC_MIN_INTERVAL_MS, best-effort.
 */
async function syncCharacterGear(force = false): Promise<void> {
  if (!charSync || !buildState || charSyncing) return;
  if (!force && Date.now() - charSync.lastSyncAt < CHAR_SYNC_MIN_INTERVAL_MS) return;
  charSyncing = true;
  sendBuildUpdate(); // индикация «синхронизируется…» в панели
  try {
    const gear = await withTimeout(
      core.build.fetchProfileCharacterGear(charSync),
      20_000,
      'fetchProfileCharacterGear',
    );
    charSync.lastSyncAt = Date.now();
    saveCharSync();

    // Сбрасываем «надето», затем заполняем по-новой из профиля.
    for (const s of buildState.slots) s.worn = null;
    let owned = 0;
    for (const g of gear) {
      let name = g.name;
      let base = '';
      try {
        const p = core.parse.parseItemText(g.itemText);
        base = p.baseType;
        name = core.parse.itemDisplayName(p) || g.name;
      } catch {
        /* не распарсился — используем имя как есть */
      }
      // Тот же слот по имени (Gloves→Gloves, Ring 1→Ring 1), с fallback на
      // матчинг по имени/базе.
      const target =
        buildState.slots.find((s) => s.slot === g.slot) ?? matchBuildSlot(name, base);
      if (!target) continue; // персонаж носит то, чего в целевом билде нет (напр. посохи)
      target.worn = name;
      const same =
        normName(name) === normName(target.name) ||
        normName(name) === normName(target.baseType) ||
        (base && normName(base) === normName(target.baseType));
      if (same && target.status !== 'bought') {
        target.status = 'bought';
        owned++;
      }
    }
    saveBuildState();
    console.log(
      `[overlay] char sync ok: ${charSync.character} (${charSync.league}), совпало слотов: ${owned}`,
    );
  } catch (err) {
    console.warn('[overlay] char sync failed:', err instanceof Error ? err.message : err);
    sendBuildUpdate({
      error: `Синхронизация с poe.ninja не удалась: ${err instanceof Error ? err.message : err}`,
    });
    return;
  } finally {
    charSyncing = false;
  }
  sendBuildUpdate();
}

/**
 * Импортировать билд из буфера обмена (PoB share-код / XML / ссылка / .build JSON),
 * оценить каждый слот в фоне и показать панель билда.
 */
async function runBuildImport(): Promise<void> {
  if (buildPricing) {
    console.warn('[overlay] build import skipped: ещё идёт прайсинг предыдущего билда');
    return;
  }
  const input = clipboard.readText().trim();
  if (!input) {
    sendBuildUpdate({ error: 'Буфер пуст. Скопируйте PoB share-код (Ctrl+C в PoB → «Export»), затем Ctrl+F3.' });
    return;
  }

  // Ссылка на страницу персонажа poe.ninja = настройка автосинхронизации,
  // а НЕ импорт целевого билда. Билд не трогаем.
  const profileRef = core.build.parseProfileCharacterUrl(input);
  if (profileRef) {
    if (!buildState) {
      sendBuildUpdate({
        error: 'Сначала импортируйте целевой билд (PoB-код → Ctrl+F3), затем добавьте персонажа.',
      });
      return;
    }
    charSync = { ...profileRef, lastSyncAt: 0 };
    saveCharSync();
    console.log(`[overlay] char sync source: ${profileRef.character} (${profileRef.league})`);
    buildState.panelVisible = true;
    sendBuildUpdate({
      info: `🧍 Автосинхронизация включена: ${profileRef.character} (${profileRef.league}). Эквип сверяется с билдом автоматически.`,
    });
    void syncCharacterGear(true);
    return;
  }

  buildPricing = true;
  try {
    console.log(`[overlay] build import: ${input.length} chars from clipboard`);
    sendBuildUpdate({ status: 'importing' });

    const imported = await withTimeout(core.build.importBuild(input), 20_000, 'importBuild');
    const gear = await withTimeout(core.build.buildCodeToGear(input), 20_000, 'buildCodeToGear');
    if (!gear.length) throw new Error('в билде не найдено снаряжения');

    buildState = {
      rawInput: input,
      className: imported.class,
      ascendancy: imported.ascendancy,
      level: imported.level,
      skills: imported.skills ?? [],
      importedAt: Date.now(),
      slots: gear.map((g) => {
        let rarity = 'other';
        let baseType = '';
        try {
          const p = core.parse.parseItemText(g.itemText);
          rarity = p.rarity;
          baseType = p.baseType;
        } catch {
          /* не распарсился — билд-таргет с синтетическим текстом */
        }
        return {
          slot: g.slot,
          name: g.name,
          baseType: baseType || g.name,
          rarity,
          median: null,
          confidence: null,
          status: 'todo' as const,
          itemText: g.itemText,
        };
      }),
      summary: null,
      metaSkills: null,
      panelVisible: true,
    };
    saveBuildState();
    sendBuildUpdate({ status: 'ready' });
    console.log(
      `[overlay] build imported: ${buildState.slots.length} slots, class=${buildState.className ?? '?'} @${buildState.ascendancy ?? '?'}`,
    );

    // Живая панель: EHP/дыры защиты и мета — считаем в фоне, не мешая прайсингу.
    void refreshBuildEstimate();
    void refreshBuildMeta();
    // Автосинхронизация с персонажем poe.ninja (если настроена) — тоже в фоне.
    void syncCharacterGear();

    // Прайсинг слотов: строго последовательно (trade2 — 8 req/min под капотом ядра).
    for (const slot of buildState.slots) {
      if (slot.median != null) continue;
      try {
        const res = await withTimeout(core.trade.priceCheck(slot.itemText), HOTKEY_TIMEOUT_MS, 'priceCheck');
        slot.median = res.estimate?.median ?? null;
        slot.confidence = res.estimate?.confidence ?? null;
        if (slot.median != null) {
          slot.name = res.itemName ?? slot.name;
        }
      } catch (err) {
        console.warn(
          `[overlay] build price failed: slot=${slot.slot} item="${slot.name}": ${err instanceof Error ? err.message : err}`,
        );
      }
      sendBuildUpdate({ status: 'ready' });
    }
    saveBuildState();
    sendBuildUpdate({ status: 'ready' });
    console.log('[overlay] build pricing done');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[overlay] build import failed:', msg);
    sendBuildUpdate({
      error: `Импорт не удался: ${msg}. Нужен PoB share-код, XML, ссылка или .build JSON.`,
    });
  } finally {
    buildPricing = false;
    sendBuildUpdate({ status: 'ready' });
  }
}

/** Оценка собранного комплекта (EHP/дыры) — фон, best-effort. */
async function refreshBuildEstimate(): Promise<void> {
  if (!buildState) return;
  try {
    const est = await withTimeout(
      core.estimate.estimateBuild(buildState.slots.map((s) => ({ slot: s.slot, name: s.name, itemText: s.itemText }))),
      30_000,
      'estimateBuild',
    );
    buildState.summary = {
      worstEhpType: est.worstEhp?.damageType ?? null,
      worstEhp: est.worstEhp ? Math.round(est.worstEhp.effectiveHp) : null,
      gaps: est.gaps.slice(0, 3).map((g) => ({ description: g.description, recommendation: g.recommendation })),
      weapon: est.weapon?.weapon ?? null,
      weaponDps: est.weapon ? Math.round(est.weapon.totalDps) : null,
      notes: est.notes.slice(0, 2),
    };
    saveBuildState();
    sendBuildUpdate();
    console.log(`[overlay] build estimate: worstEhp=${buildState.summary.worstEhp} (${buildState.summary.worstEhpType})`);
  } catch (err) {
    console.warn('[overlay] build estimate failed:', err instanceof Error ? err.message : err);
  }
}

/** Мета-скиллы топа ладдера текущей лиги — фон, best-effort. */
async function refreshBuildMeta(): Promise<void> {
  if (!buildState) return;
  try {
    const leagues = await withTimeout(core.ladder.listLadderLeagues(), 15_000, 'listLadderLeagues');
    const slug = leagues.find((l) => /hardcore/i.test(l))
      ? leagues[0]
      : leagues[0];
    if (!slug) return;
    const rows = await withTimeout(
      core.ladder.topLadderBuilds(slug, { limit: 100 }),
      30_000,
      'topLadderBuilds',
    );
    buildState.metaSkills = core.ladder.popularSkills(rows, 5);
    saveBuildState();
    sendBuildUpdate();
    console.log(`[overlay] build meta: ${buildState.metaSkills.slice(0, 3).map((s) => `${s.name}×${s.count}`).join(', ')}`);
  } catch (err) {
    console.warn('[overlay] build meta failed:', err instanceof Error ? err.message : err);
  }
}

/** Ctrl+F2: показать/скрыть панель билда (или импортировать, если билда нет). */
function toggleBuildPanel(): void {
  if (!buildState) {
    void runBuildImport();
    return;
  }
  buildState.panelVisible = !buildState.panelVisible;
  // Открыли панель — подтянем свежий эквип персонажа (троттлится внутри).
  if (buildState.panelVisible) void syncCharacterGear();
  sendBuildUpdate();
}

/** Сбросить билд (IPC). */
function resetBuild(): void {
  buildState = null;
  try {
    fs.rmSync(buildStateFile(), { force: true });
  } catch {
    /* нет файла — ок */
  }
  sendBuildUpdate({ status: 'empty' });
  console.log('[overlay] build reset');
}

function markSlotBought(slot: BuildSlotState): void {
  slot.status = 'bought';
  saveBuildState();
  sendBuildUpdate();
  console.log(`[overlay] build slot bought: ${slot.slot} (${slot.name})`);
}

async function createOverlayWindow(): Promise<void> {
  overlayWindow = new BrowserWindow({
    // Прозрачное безрамочное окно поверх всего. Позицию/видимость задаёт трекер
    // окна игры (см. trackGameWindow), поэтому стартуем скрытым в углу экрана.
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    x: -OVERLAY_WIDTH,
    y: -OVERLAY_HEIGHT,
    show: false,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Клик проходит «сквозь» оверлей в игру, кроме случая, когда открыты
    // интерактивные элементы (см. ipc «interact:set»).
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  // Отключаем выделение/нужные события в оверлее.
  overlayWindow.webContents.on('before-input-event', (event) => {
    event.preventDefault();
  });

  overlayWindow.loadFile(writtenRendererPath());

  // По умолчанию клики проходят в игру сквозь оверлей.
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  // Держим оверлей выше обычного «нормального» слоя, чтобы он был над окном игры.
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces?.(true);
}

/** Конвертирует физические пиксели (GetWindowRect) в DIP для Electron-окна. */
function physicalRectToDip(
  r: { left: number; top: number; right: number; bottom: number },
): { x: number; y: number; width: number; height: number } {
  const cx = Math.round((r.left + r.right) / 2);
  const cy = Math.round((r.top + r.bottom) / 2);
  let disp;
  try {
    disp = screen.getDisplayNearestPoint({ x: cx, y: cy });
  } catch {
    disp = screen.getPrimaryDisplay();
  }
  const sf = disp.scaleFactor || 1;
  return {
    x: r.left / sf,
    y: r.top / sf,
    width: (r.right - r.left) / sf,
    height: (r.bottom - r.top) / sf,
  };
}

/**
 * Трекер окна игры: периодически ищет окно PoE2, привязывает оверлей к его
 * правому верхнему углу и прячет оверлей, когда игра свёрнута или не активна.
 */
function trackGameWindow(): void {
  const win = overlayWindow;
  if (!win || win.isDestroyed()) return;

  const found = findGameWindow({ titleKeyword: GAME_TITLE_KEYWORD });

  if (!found) {
    // Игра/окно не найдено — прячем оверлей (кроме режима перемещения).
    if (!moveUnlocked && win.isVisible()) win.hide();
    return;
  }

  // Игра не в фокусе или свёрнута — прячем оверлей (кроме режима перемещения).
  const active = isGameForeground(found);
  if (!active && !moveUnlocked) {
    if (win.isVisible()) win.hide();
    return;
  }

  if (moveUnlocked) {
    // Пользователь тащит окно — не дёргаем позицию и не прячем его.
    if (!win.isVisible()) win.show();
    return;
  }

  // Позиция (DIP): правый верхний угол окна игры + сохранённое смещение.
  const pinned = pinnedPosition(physicalRectToDip(found.rect));
  const x = pinned.x + (userOffset?.x ?? 0);
  const y = pinned.y + (userOffset?.y ?? 0);

  // Если сменился HWND игры (перезапуск PoE2) — форсируем обновление позиции.
  const hwndKey = String(found.hwnd);
  if (lastHwndKey !== hwndKey) {
    lastHwndKey = hwndKey;
    lastRectKey = '';
  }

  // Перемещаем оверлей только если позиция/размер реально изменились (меньше дерганий).
  const key = `${x},${y},${overlayHeight}`;
  if (lastRectKey !== key) {
    lastRectKey = key;
    win.setBounds({
      x,
      y,
      width: OVERLAY_WIDTH,
      height: overlayHeight,
    });
  }

  if (!win.isVisible()) win.show();
}

function startGameTracker(): void {
  if (trackerTimer) return;
  trackerTimer = setInterval(trackGameWindow, TRACK_INTERVAL_MS);
  // Быстрый первый тик, чтобы оверлей появился сразу после старта.
  trackGameWindow();
}

function stopGameTracker(): void {
  if (trackerTimer) {
    clearInterval(trackerTimer);
    trackerTimer = null;
  }
}

/**
 * Главное действие: прайс-чек предмета из буфера обмена.
 * Возвращает результат ядра (или распарсенный вариант, если оценка не удалась).
 */
const hotkeyAction = (): void => {
  console.log('[overlay] hotkey fired: Ctrl+F1 (прайс-чек)');
  void runPriceCheck();
};

const hotkeyLevelAction = (): void => {
  console.log('[overlay] hotkey fired: Ctrl+F4 (прокачка)');
  void runLevelingContext();
};

const HOTKEY_TIMEOUT_MS = 45_000;

/** Обёртка-«страховка»: даже если priceCheck зависнет (сеть), отпустим busy по таймауту. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms),
    ),
  ]);
}

async function runPriceCheck(): Promise<unknown> {
  if (busy) {
    console.warn('[overlay] pricecheck skipped: busy=true (предыдущий запрос ещё не завершился)');
    return null;
  }
  busy = true;
  try {
    const itemText = clipboard.readText();
    console.log(`[overlay] clipboard: ${itemText.length} chars`);
    if (itemText.trim()) {
      console.log(`[overlay] clipboard head: ${JSON.stringify(itemText.slice(0, 80))}`);
    } else {
      console.warn('[overlay] clipboard is empty — Ctrl+C в игре по наведённому предмету?');
    }
    await overlayWindow?.webContents.send('price:busy', true);

    let result;
    try {
      result = await withTimeout(
        core.trade.priceCheck(itemText),
        HOTKEY_TIMEOUT_MS,
        'priceCheck',
      );
      const itemName = (result as { itemName?: string } | undefined)?.itemName ?? '?';
      console.log(
        `[overlay] price done: item="${itemName}" estimate=${JSON.stringify(
          (result as { estimate?: unknown } | undefined)?.estimate ?? null,
        )} listings=${
          (result as { listings?: unknown[] } | undefined)?.listings?.length ?? 0
        }`,
      );
    } catch (err) {
      console.warn('[overlay] priceCheck failed:', err instanceof Error ? err.message : err);
      // Если priceCheck упал (сетевой/API) — пытаемся хотя бы распарсить локально.
      const parsed = core.parse.parseItemText(itemText);
      result = {
        itemName: core.parse.itemDisplayName(parsed) || 'Неизвестный предмет',
        rarity: parsed.rarity.toLowerCase(),
        estimate: null,
        listings: [],
        sources: [],
        updatedAt: Date.now(),
        parseOnly: true,
        parseError: err instanceof Error ? err.message : String(err),
      };
    }

    // Билд-ассистент: сопоставить предмет со слотом билда и отметить собранным.
    if (buildState && itemText.trim()) {
      try {
        const parsed = core.parse.parseItemText(itemText);
        const displayName = core.parse.itemDisplayName(parsed);
        const matched = matchBuildSlot(displayName, parsed.baseType);
        if (matched) {
          console.log(
            `[overlay] build slot matched: ${matched.slot} (item="${displayName}", base="${parsed.baseType}")`,
          );
          (result as { buildMatch?: unknown }).buildMatch = { slot: matched.slot, name: matched.name };
          markSlotBought(matched);
        }
      } catch {
        /* предмет из игры не парсится — ничего не сопоставляем */
      }
    }

    await overlayWindow?.webContents.send('price:result', result);
    return result;
  } finally {
    busy = false;
    await overlayWindow?.webContents.send('price:busy', false);
  }
}

/**
 * Действие «контекст прокачки»: состояние клиента из Client.txt + заметки
 * текущей зоны/акта + следующие зоны (core.zoneNotes.getLevelingContext).
 * Возвращает компактный объект для оверлей-виджета.
 */
/**
 * Явный путь к логу игры, если пользователь задал его в userData/game-log-path.txt
 * (например, нестандартная установка). Иначе — автодетект по всем дискам.
 */
function gameLogOverride(): string | null {
  try {
    const v = fs.readFileSync(path.join(app.getPath('userData'), 'game-log-path.txt'), 'utf8').trim();
    return v || null;
  } catch {
    return null;
  }
}

async function runLevelingContext(): Promise<unknown> {
  if (busy) return null;
  busy = true;
  try {
    const override = gameLogOverride();
    const state = core.log.getClientState(override ? { logPath: override } : {});
    console.log(`[overlay] game log: ${state.logPath ?? 'не найден'}`);
    const reason = state.available ? null : state.reason ?? 'лог недоступен';
    const ctx = core.zoneNotes.getLevelingContext(state.available ? state : null);
    const payload = {
      summary: ctx.summary,
      zone: ctx.zone ? { code: ctx.zone.areaCode, name: ctx.zone.zoneName } : null,
      available: ctx.available,
      reason,
      hints: ctx.hints,
      nextZones: ctx.nextZones.slice(0, 3).map((z) => ({
        zone: z.zone,
        monsterLevel: z.monsterLevel,
        levelDelta: z.levelDelta,
        rewards: z.rewardList,
      })),
    };
    await overlayWindow?.webContents.send('level:result', payload);
    return payload;
  } finally {
    busy = false;
  }
}

function registerHotkeys(): void {
  const ok = globalShortcut.register(PRICE_HOTKEY, hotkeyAction);
  const okL = globalShortcut.register(LEVELING_HOTKEY, hotkeyLevelAction);
  const okM = globalShortcut.register(MOVE_HOTKEY, () => {
    console.log('[overlay] hotkey fired: Ctrl+F5 (перемещение оверлея)');
    toggleMoveMode();
  });
  const okBI = globalShortcut.register(BUILD_IMPORT_HOTKEY, () => {
    console.log('[overlay] hotkey fired: Ctrl+F3 (импорт билда из буфера)');
    void runBuildImport();
  });
  const okBP = globalShortcut.register(BUILD_PANEL_HOTKEY, () => {
    console.log(`[overlay] hotkey fired: ${BUILD_PANEL_HOTKEY} (панель билда)`);
    toggleBuildPanel();
  });
  console.log(`[overlay] hotkey ${PRICE_HOTKEY} registered=${ok}`);
  console.log(`[overlay] hotkey ${LEVELING_HOTKEY} registered=${okL}`);
  console.log(`[overlay] hotkey ${MOVE_HOTKEY} registered=${okM}`);
  console.log(`[overlay] hotkey ${BUILD_IMPORT_HOTKEY} registered=${okBI}`);
  console.log(`[overlay] hotkey ${BUILD_PANEL_HOTKEY} registered=${okBP}`);
}

function setupIPC(): void {
  ipcMain.handle('price:check', () => runPriceCheck());

  ipcMain.handle('level:check', () => runLevelingContext());

  ipcMain.handle('league:get', () => {
    return activeLeague ?? null;
  });

  ipcMain.handle('league:set', (_evt, league: string) => {
    const v = typeof league === 'string' ? league.trim() : '';
    activeLeague = v || null;
    if (activeLeague) core.trade.setLeague(activeLeague);
    saveSavedLeague(activeLeague);
    return activeLeague;
  });

  ipcMain.handle('hotkey:get', () => PRICE_HOTKEY);

  // Перемещение оверлея: переключение режима и сброс смещения из рендерера.
  ipcMain.handle('move:toggle', () => {
    toggleMoveMode();
    return moveUnlocked;
  });

  ipcMain.handle('move:reset', () => {
    resetOverlayOffset();
    return true;
  });

  // Билд-ассистент.
  ipcMain.handle('build:import', () => {
    void runBuildImport();
    return true;
  });

  ipcMain.handle('build:toggle', () => {
    toggleBuildPanel();
    return buildState?.panelVisible ?? false;
  });

  ipcMain.handle('build:reset', () => {
    resetBuild();
    return true;
  });

  ipcMain.handle('build:get', () => buildPayload());

  // Переключатель «кликабельности» оверлея из рендерера.
  ipcMain.handle('interact:set', (_evt, interact: boolean) => {
    overlayWindow?.setIgnoreMouseEvents(!interact, { forward: true });
    return interact;
  });

  // Авторазмер: рендерер меряет контент панели и просит подогнать высоту окна
  // (в DIP; ширина фиксирована). Позицию не трогаем — она за трекером игры.
  ipcMain.handle('overlay:autosize', (_evt, px: number) => {
    const win = overlayWindow;
    if (!win || win.isDestroyed()) return overlayHeight;
    let h = Math.round(Number(px));
    if (!Number.isFinite(h) || h <= 0) return overlayHeight;
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    h = Math.min(h, wa.height - 2 * MARGIN);
    h = Math.max(h, OVERLAY_MIN_HEIGHT);
    const b = win.getBounds();
    if (h !== b.height) {
      overlayHeight = h;
      win.setBounds({ x: b.x, y: b.y, width: OVERLAY_WIDTH, height: h });
      console.log(`[overlay] autosize: height=${h}`);
    }
    return overlayHeight;
  });
}

const IS_SMOKE = process.argv.includes('--smoke');

app.whenReady().then(async () => {
  // Восстанавливаем сохранённое смещение оверлея (если пользователь его двигал).
  userOffset = loadUserOffset();
  console.log(`[overlay] saved offset: ${userOffset ? JSON.stringify(userOffset) : 'нет (штатная позиция)'}`);

  // Лига: если пользователь раньше выбрал свою — используем её; иначе берём
  // актуальную текущую лигу из poe2scout (а не устаревший хардкод).
  activeLeague = loadSavedLeague();
  if (!activeLeague) {
    try {
      activeLeague = await core.trade.currentDefaultLeague();
    } catch {
      activeLeague = null;
    }
  }
  if (activeLeague) core.trade.setLeague(activeLeague);
  // Диагностика: где нашли лог игры (Client.txt) до первого нажатия Ctrl+F4.
  {
    const o = gameLogOverride();
    const r = core.log.resolveClientLogPath(o ? { overridePath: o } : {});
    console.log(`[overlay] game log autodetect: ${r.logPath ?? 'НЕ НАЙДЕН (см. game-log-path.txt)'}`);
  }
  // Восстанавливаем сохранённый билд (если импортировали раньше) — панель скрыта до Ctrl+F2.
  loadBuildState();
  // Источник автосинхронизации с персонажем poe.ninja (если настраивали раньше).
  loadCharSync();
  console.log(
    `[overlay] char sync source: ${charSync ? `${charSync.character} (${charSync.league})` : 'не задан'}`,
  );
  // Словарь ru↔en для сопоставления слотов: кэш с диска, недостающее — докачиваем в фоне.
  if (!loadRuEnDict()) void ensureRuEnDict();
  setupIPC();
  void createOverlayWindow().then(() => {
    startGameTracker();
    // После создания окна — выслать текущее состояние билда (если есть).
    if (buildState) {
      buildState.panelVisible = false;
      sendBuildUpdate();
    }
    // Первичная синхронизация с персонажем poe.ninja — пауза, чтобы не мешать старту.
    if (buildState && charSync) setTimeout(() => void syncCharacterGear(), 15_000);
  });
  registerHotkeys();

  if (IS_SMOKE) {
    // Smoke-тест запуска: окно создано + обработчики повешаны — выходим.
    setTimeout(async () => {
      await overlayWindow?.webContents.send('price:busy', true);
      await overlayWindow?.webContents.send('price:busy', false);
      const parsed = core.parse.parseItemText('Rarity: Unique\nBrutal Grenaade\nMace');
      console.log(`[smoke] windows=${BrowserWindow.getAllWindows().length}`);
      console.log(`[smoke] hotkey_ok=${globalShortcut.isRegistered(PRICE_HOTKEY)}`);
      console.log(`[smoke] parse_ok=${core.parse.itemDisplayName(parsed)} (${parsed.rarity})`);
      console.log('[smoke] SMOKE OK');
      app.exit(0);
    }, 2500);
    return;
  }

  app.on('activate', () => {
    void createOverlayWindow();
  });
});

// Повторный запуск — фокус на существующее окно.
app.on('second-instance', () => {
  if (overlayWindow) {
    overlayWindow.focus();
  }
});

app.on('will-quit', () => {
  stopGameTracker();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Оверлей держим в трее до ручного выхода.
  if (process.platform !== 'darwin') {
    // не завершаем приложение
  }
  void app;
});

// Пусть процесс живёт, пока у оверлея есть окно.
export { isPacked };