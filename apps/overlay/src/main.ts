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
  Notification,
  screen,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { core } from '@poe2-kit/core';
import { rendererHtml } from './rendererHtml.js';
import { GEMS_RU_EN } from './gemsRuEn.js';
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
    // Ротация по размеру: активный лог ≤1МБ, храним два бэкапа (.1, .2),
    // суммарный потолок ~3МБ — детально, но никогда не растёт в гигабайты.
    if (stat.size > LOG_MAX_BYTES) {
      fs.rmSync(`${file}.2`, { force: true });
      if (fs.existsSync(`${file}.1`)) fs.renameSync(`${file}.1`, `${file}.2`);
      fs.renameSync(file, `${file}.1`);
    }
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

// ─── Аварийная телеметрия: необработанные ошибки в лог, а не в никуда ────────
// Падение main-процесса без записи в лог означает «окно исчезло и причина
// неизвестна». С этими обработчиками причина остаётся в overlay.log.
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  console.error('[overlay] uncaughtException:', err?.stack ?? String(err));
});
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[overlay] unhandledRejection:', String(reason));
});

// ─── Настройки по умолчанию ────────────────────────────────────────────────
// Хоткеи — F-клавиши с Ctrl: почти не конфликтуют ни с игрой, ни с Intel/Discord
// (Ctrl+Alt+X/Alt+B часто заняты системным софтом гейм-ПК).
const PRICE_HOTKEY = 'Control+F1';
const LEVELING_HOTKEY = 'Control+F4';
const MOVE_HOTKEY = 'Control+F5';
const BUILD_IMPORT_HOTKEY = 'Control+F3';
const BUILD_PANEL_HOTKEY = 'Control+F2';
const SETTINGS_HOTKEY = 'Control+F6';
const LEAGUE_STORAGE_KEY = 'poe2k.league';

/** Смещение оверлея относительно «закреплённой» позиции (угол окна игры). */
interface OverlayOffset {
  x: number;
  y: number;
}

/** Угол окна игры, к которому прикрепляется оверлей. */
type OverlayCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

/** Полностью настраиваемые параметры оверлея (переживают перезапуск). */
interface OverlaySettings {
  /** Угол прикрепления к окну игры. */
  corner: OverlayCorner;
  /** Непрозрачность фона панели, 0.25–1.0. */
  opacity: number;
  /** Масштаб текста/элементов, 0.7–1.4. */
  scale: number;
  /** Ширина оверлея (DIP). */
  width: number;
  /** Высота оверлея (DIP) — ручной режим (autoHeight=false, по умолчанию):
   *  окно фиксировано и НЕ меняет размер при переключении панелей; длинный
   *  контент скроллится внутри (№60–61). Жалоба №62: высота «скачет»
   *  при переключении панелей — авто-режим теперь opt-in. */
  height: number;
  /** Автоподбор высоты под контент (бывшее поведение): окно растёт/прыгает
   *  при каждой смене панели. По умолчанию выключено. */
  autoHeight?: boolean;
  /** Переопределения хоткеев (по умолчанию пусто = стандартные Ctrl+F1..F6). */
  hotkeys: Partial<Record<HotkeyAction, string>>;
  /** Opt-in журнал обучения: запоминать структуру проверенных предметов
   *  (локально; вклад — только по кнопке «Поделиться». См. PRIVACY/README). */
  learn?: boolean;
  /** Привязка к окну игры через Win32 (read-only user32-вызовы). false =
   *  «осторожный режим»: позиция по углу рабочей области экрана, оверлей
   *  всегда видим, ни одного вызова user32.dll. */
  bindWindow?: boolean;
  /** Opt-in автопрайс-чек: опрос буфера обмена 500мс с дедупом; срабатывает
   *  только на клир-текст предметов (якорь «Rarity:»). Выключено по умолчанию
   *  — приватность: иначе непрерывно читается буфер (см. PRIVACY). */
  autoClipboard?: boolean;
  /** Язык имён камней в панели билда и рекомендациях: 'ru' (кли ru-клиента) | 'en'. */
  gemLang?: 'ru' | 'en';
}

type HotkeyAction =
  | 'price'
  | 'leveling'
  | 'move'
  | 'buildImport'
  | 'buildPanel'
  | 'settings';

const DEFAULT_SETTINGS: OverlaySettings = {
  corner: 'top-right',
  opacity: 0.86,
  scale: 1,
  width: 420,
  height: 480,
  autoHeight: false,
  hotkeys: {},
  bindWindow: true,
  gemLang: 'ru',
};

/** Стандартные хоткеи для действия (если пользователь не переопределил). */
const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = {
  price: PRICE_HOTKEY,
  leveling: LEVELING_HOTKEY,
  move: MOVE_HOTKEY,
  buildImport: BUILD_IMPORT_HOTKEY,
  buildPanel: BUILD_PANEL_HOTKEY,
  settings: SETTINGS_HOTKEY,
};

/** Активные настройки оверлея. */
let settings: OverlaySettings = { ...DEFAULT_SETTINGS, hotkeys: {} };

let activeLeague: string | null = null;
let overlayWindow: BrowserWindow | null = null;
let busy = false;
/** Режим перемещения оверлея (Ctrl+F5): окно кликабельно и таскается мышью. */
let moveUnlocked = false;
/** Пользовательское смещение (DIP) от закреплённой позиции; переживает перезапуск. */
let userOffset: OverlayOffset | null = null;

// ─── Watchlist: следить за ценой предмета, алерт при падении ─────────────────

/** Одна отслеживаемая позиция (база/уникалка/валюта) — перепроверяется в фоне. */
interface WatchEntry {
  id: string;
  /** Человекочитаемое имя для уведомлений. */
  label: string;
  rarity?: string;
  /** Полный клир-текст предмета из игры — то, что шлём в priceCheck при каждом поллинге. */
  itemText: string;
  /** Последняя известная медианная оценка (в хаосах), null — ещё не проверялся. */
  lastPrice: number | null;
  /** Уже уведомили о текущем падении (базовая линия не двигалась). */
  alerted: boolean;
  enabled: boolean;
  /** Время последнего успешного поллинга (ms). 0 — нужно проверить сразу. */
  updatedAt: number;
  /** Период проверки (ms). */
  pollMs: number;
}

/** Тик фонового поллинга watchlist. */
const WATCH_TICK_MS = 60_000;
/** Период проверки одной позиции по умолчанию (5 мин). */
const WATCH_POLL_DEFAULT_MS = 5 * 60_000;

let watchlist: WatchEntry[] = [];
let watchBusy = false;
let watchTimer: NodeJS.Timeout | null = null;

function watchlistFile(): string {
  return path.join(app.getPath('userData'), 'watchlist.json');
}

function loadWatchlist(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(watchlistFile(), 'utf8'));
    if (Array.isArray(raw)) {
      watchlist = raw
        .filter((e) => e && typeof e.itemText === 'string' && e.itemText.length > 0)
        .map((e) => ({
          id:
            typeof e.id === 'string' && e.id
              ? e.id
              : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          label: typeof e.label === 'string' && e.label ? e.label : 'Предмет',
          rarity: typeof e.rarity === 'string' ? e.rarity : undefined,
          itemText: e.itemText,
          lastPrice: typeof e.lastPrice === 'number' ? e.lastPrice : null,
          alerted: !!e.alerted,
          enabled: e.enabled !== false,
          updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : 0,
          pollMs: typeof e.pollMs === 'number' ? e.pollMs : WATCH_POLL_DEFAULT_MS,
        }));
      // Prune: записи, не прошедшие новую валидацию (PoB-код, огрызки буфера),
      // иначе они так и прайсились бы вечно (живой кейс 29.09: 3 из 13 позиций).
      const valid = watchlist.filter((e) =>
        /^\s*(Rarity|Редкость|Item Class|Класс предмета)\s*:/im.test(String(e.itemText ?? '')),
      );
      if (valid.length !== watchlist.length) {
        console.warn(
          `[overlay] watchlist: удалено ${watchlist.length - valid.length} мусорных записей (не предмет)`,
        );
        watchlist = valid;
        saveWatchlist();
      }
      console.log(`[overlay] watchlist: загружено ${watchlist.length} позиций`);
    }
  } catch {
    watchlist = [];
  }
}

function saveWatchlist(): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(watchlistFile(), JSON.stringify(watchlist), 'utf8');
  } catch {
    /* некритично */
  }
}

/** Публичное представление для рендерера (по умолчанию без сырого itemText). */
function watchlistPublic(includeItemText = false): unknown[] {
  return watchlist.map((e) => {
    const o: Record<string, unknown> = {
      id: e.id,
      label: e.label,
      rarity: e.rarity,
      lastPrice: e.lastPrice,
      alerted: e.alerted,
      enabled: e.enabled,
      updatedAt: e.updatedAt,
      pollMs: e.pollMs,
    };
    if (includeItemText) o.itemText = e.itemText;
    return o;
  });
}

function addWatchEntry(p: { itemText?: string; label?: string; rarity?: string }): {
  ok: boolean;
  entries: unknown[];
} {
  const text = typeof p?.itemText === 'string' ? p.itemText.trim() : '';
  if (!text) return { ok: false, entries: watchlistPublic() };
  // Валидация: в ватчлист — только текст предмета (строка Rarity/Редкость).
  // Живой кейс 29.09: буфером могли быть PoB-код, огрызок подсказки или текст
  // вклада — они попадали в список и прайсились (400) каждые poll-минуты.
  if (!/^\s*(Rarity|Редкость|Item Class|Класс предмета)\s*:/im.test(text)) {
    console.warn('[overlay] watchlist: отклонено — текст не похож на предмет (нет строки Rarity)');
    return { ok: false, entries: watchlistPublic() };
  }
  // Дедупликация: тот же предмет уже в списке — ничего не меняем.
  if (watchlist.some((e) => e.itemText === text)) {
    return { ok: true, entries: watchlistPublic() };
  }
  const label =
    (typeof p?.label === 'string' && p.label.trim()) ||
    core.parse.itemDisplayName(core.parse.parseItemText(text)) ||
    'Предмет';
  watchlist.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    rarity: typeof p?.rarity === 'string' ? p.rarity : undefined,
    itemText: text,
    lastPrice: null,
    alerted: false,
    enabled: true,
    updatedAt: 0,
    pollMs: WATCH_POLL_DEFAULT_MS,
  });
  saveWatchlist();
  console.log(`[overlay] watchlist: добавлено "${label}" (всего ${watchlist.length})`);
  return { ok: true, entries: watchlistPublic() };
}

function removeWatchEntry(id: string): { ok: boolean; entries: unknown[] } {
  watchlist = watchlist.filter((e) => e.id !== id);
  saveWatchlist();
  return { ok: true, entries: watchlistPublic() };
}

function toggleWatchEntry(id: string): { ok: boolean; entries: unknown[] } {
  const e = watchlist.find((x) => x.id === id);
  if (e) {
    e.enabled = !e.enabled;
    saveWatchlist();
  }
  return { ok: true, entries: watchlistPublic() };
}

// ─── Агентский канал (№85): очередь команд MCP-агента → оверлей ──────────────
// MCP-туры (poe2_overlay_notify / poe2_overlay_watch_add / poe2_overlay_watch_remove)
// дописывают JSON в agent-queue.json; overlay — единственный применяющий:
// один писатель watchlist = нет race. Поллим файл: fs.watch на SMB/личных
// дисках капризнее таймера. Две точки очереди (№85-бис):
//  1) userData/agent-queue.json — локальный агент на том же ПК;
//  2) agent-queue.json рядом с dist (__dirname/../) — удалённый агент: зеркало
//     userData на шаре друга read-only, а деплой-каталог (F:\...\apps\overlay)
//     доступен агенту на запись по UNC и оверлею на чтение локально.
// Формат: { notify: [{title?, text}], watchAdd: [{itemText, label?}], watchRemove: [id] }
const AGENT_QUEUE_FILE = 'agent-queue.json';
const AGENT_QUEUE_POLL_MS = 2000;

function agentQueueFiles(): string[] {
  return [
    path.join(app.getPath('userData'), AGENT_QUEUE_FILE),
    path.resolve(__dirname, '..', AGENT_QUEUE_FILE),
  ];
}

function applyAgentQueue(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const q = raw as { notify?: unknown[]; watchAdd?: unknown[]; watchRemove?: unknown[] };
  if (Array.isArray(q.notify)) {
    for (const item of (q.notify as unknown[]).slice(0, 5)) {
      const o = (item ?? {}) as { title?: unknown; text?: unknown };
      if (typeof o.text !== 'string' || !o.text.trim()) continue;
      const title = typeof o.title === 'string' && o.title.trim() ? o.title : '🤖 Агент';
      console.log(`[overlay] agent notify: ${title}: ${o.text.slice(0, 120)}`);
      overlayWindow?.webContents.send('agent:notify', {
        title,
        text: o.text.slice(0, 500),
      });
    }
  }
  if (Array.isArray(q.watchAdd)) {
    for (const item of (q.watchAdd as unknown[]).slice(0, 10)) {
      const o = (item ?? {}) as { itemText?: unknown; label?: unknown };
      if (typeof o.itemText !== 'string') continue;
      const r = addWatchEntry({
        itemText: o.itemText,
        label: typeof o.label === 'string' ? o.label : undefined,
      });
      if (!r.ok) console.warn('[overlay] agent watchAdd: отклонено (не предмет/дубль)');
    }
  }
  if (Array.isArray(q.watchRemove)) {
    for (const id of (q.watchRemove as unknown[]).slice(0, 20)) {
      if (typeof id === 'string') removeWatchEntry(id);
    }
  }
}

function startAgentQueuePolling(): void {
  setInterval(() => {
    for (const file of agentQueueFiles()) {
      try {
        if (!fs.existsSync(file)) continue;
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.rmSync(file, { force: true }); // применяем ровно один раз
        applyAgentQueue(raw);
      } catch (err) {
        // Битый/полузаписанный JSON — удаляем, чтобы очередь не залипала.
        try {
          fs.rmSync(file, { force: true });
        } catch {
          /* ничего */
        }
        if (err instanceof Error && err.message && !/ENOENT|JSON/.test(err.message)) {
          console.warn('[overlay] agent queue:', err.message);
        }
      }
    }
  }, AGENT_QUEUE_POLL_MS);
  console.log(`[overlay] agent queue: polling ${AGENT_QUEUE_FILE} (userData + рядом с dist) каждые ${AGENT_QUEUE_POLL_MS} мс`);
}

function fmtChaos(v: number): string {
  return Number.isFinite(v) ? Number(v).toFixed(1) : String(v);
}

/** Всплывающее уведомление о падении цены: системный тост Windows + инлайн-тост в оверлее. */
function notifyWatchDrop(entry: WatchEntry, from: number, to: number): void {
  const body = `${entry.label}: ${fmtChaos(from)} → ${fmtChaos(to)} chaos`;
  console.log(`[overlay] watchlist ALERT: ${body}`);
  try {
    if (Notification.isSupported()) {
      new Notification({ title: '📉 Цена упала', body }).show();
    } else {
      console.warn('[overlay] watchlist: системные уведомления не поддерживаются — только тост в оверлей');
    }
  } catch {
    /* уведомления недоступны — всё равно шлём тост в оверлей ниже */
  }
  overlayWindow?.webContents.send('watch:alert', {
    id: entry.id,
    label: entry.label,
    from,
    to,
    ts: Date.now(),
  });
}

/** Проверить одну позицию: обновить цену, при падении от базовой линии — алерт. */
async function pollWatchEntry(entry: WatchEntry): Promise<void> {
  let result: Record<string, unknown> | undefined;
  try {
    result = await checkPriceItem(entry.itemText);
  } catch {
    result = undefined;
  }
  const m = (result?.estimate as { median?: number } | undefined)?.median;
  if (m == null) {
    // Цены нет (не торгуется / сети нет) — базу не двигаем, но время обновляем,
    // чтобы не молотить один и тот же неуспех каждый тик.
    entry.updatedAt = Date.now();
    return;
  }
  if (entry.lastPrice == null) {
    // Первое наблюдение — ставим базовую линию, алерта здесь быть не должно.
    entry.lastPrice = m;
    entry.alerted = false;
    entry.updatedAt = Date.now();
    return;
  }
  const dropped = m < entry.lastPrice;
  if (dropped && !entry.alerted) {
    // Падение от базовой линии: уведомляем один раз, базу не двигаем,
    // следующий алерт возможен после восстановления цены.
    entry.alerted = true;
    notifyWatchDrop(entry, entry.lastPrice, m);
  } else if (!dropped) {
    // Цена выросла/равна — новая базовая линия, алерт снова можно выдавать.
    entry.alerted = false;
    if (m > entry.lastPrice) entry.lastPrice = m;
  }
  entry.updatedAt = Date.now();
}

/** Фоновый поллинг watchlist, строго последовательно (rate-limit trade2 под капотом). */
async function runWatchPoll(force = false): Promise<void> {
  if (watchBusy) return;
  if (busy && !force) return; // идёт ручной прайс-чек — не сталкиваемся по rate-limit
  watchBusy = true;
  try {
    const now = Date.now();
    let touched = false;
    for (const e of watchlist) {
      if (!e.enabled) continue;
      // Ручной Ctrl+F1 приоритетнее фоновой очереди: между записями отдаём
      // глобальный троттл trade2 пользовательскому прайс-чеку (иначе hotkey
      // ждал за всеми due-записями ватчлиста — до timeout 45 с, №58).
      if (busy && !force) break;
      const due = force || e.updatedAt === 0 || now - e.updatedAt >= e.pollMs;
      if (!due) continue;
      try {
        await pollWatchEntry(e);
        touched = true;
      } catch (err) {
        console.warn(
          `[overlay] watchlist poll failed: "${e.label}": ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    if (touched) saveWatchlist();
  } finally {
    watchBusy = false;
  }
}

function startWatchTimer(): void {
  if (watchTimer) return;
  // Прошли один раз сразу (задать базовые цены), дальше — по тику.
  void runWatchPoll();
  watchTimer = setInterval(() => void runWatchPoll(), WATCH_TICK_MS);
  console.log(
    `[overlay] watchlist: timer запущен (tick=${WATCH_TICK_MS}ms, pollDefault=${WATCH_POLL_DEFAULT_MS}ms)`,
  );
}

function stopWatchTimer(): void {
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
}

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
  /** №92: подсказка «что искать» (стартовые билды — из гайда класса). */
  note?: string;
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
  /** №85: советы ядра (core.advice.adviseBuild): диагноз, чек-лист, топ-приоритеты. */
  advice: {
    classification: string;
    summary: string;
    totals: { blocking: number; high: number; medium: number; low: number };
    checklist: string[];
    items: Array<{ priority: string; title: string; action: string }>;
  } | null;
  /** Сетапы камней билда: активный + поддержки + подсказка «куда вставлять». */
  gemSetups: Array<{
    active: string;
    activeLevel: number | null;
    supports: string[];
    source: 'socket' | 'passive';
    where: string;
  }> | null;
  /** Показана ли панель билда в виджете. */
  panelVisible: boolean;
  /** №92: доп-данные стартового билда (если rawInput = starter:Class). */
  starter: {
    ascendancies: Array<{ id: string; name: string }>;
    treePriorities: Array<{ priority: string; term: string; notables: string[] }>;
    ascPicked?: string;
    ascKeystones?: string[];
  } | null;
  /** Дерево билда из PoB-импорта: кейнстоуны/нотабли и счётчики. */
  tree: {
    version: string | null;
    total: number;
    resolved: number;
    missing: number;
    keystones: Array<{ name: string; stats: string[] }>;
    notables: Array<{ name: string; stats: string[] }>;
  } | null;
  /** Чек-лист камней: ключ — normName(EN-имя), значение из Ctrl+C гема в игре. */
  gemSeen: Record<string, { level: number | null; native: number | null; ru: string; at: number }> | null;
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
const DEFAULT_OVERLAY_WIDTH = 420;
const OVERLAY_HEIGHT = 320;
/** Минимальная высота оверлея (DIP). */
const OVERLAY_MIN_HEIGHT = 140;
/** Текущая высота оверлея — подгоняется рендерером под контент (overlay:autosize). */
let overlayHeight = OVERLAY_HEIGHT;
/** Текущая ширина оверлея (DIP) — следует за настройками пользователя. */
let overlayWidth = DEFAULT_OVERLAY_WIDTH;
/** Отступ оверлея от краёв игрового окна (в DIP). */
const MARGIN = 8;
/** Подстрока заголовка окна PoE2 (без учёта регистра). */
const GAME_TITLE_KEYWORD = 'Path of Exile';
/** Частота опроса позиции/состояния окна игры (мс). */
const TRACK_INTERVAL_MS = 350;

let lastHwndKey = '';
let lastRectKey = '';
let trackerTimer: NodeJS.Timeout | null = null;
/** Троттлинг HiDPI-лога позиционирования: максимум одна строка в N мс. */
const HIDPI_LOG_INTERVAL_MS = 5000;
let lastHiDpiLogTs = 0;
/** Гистерезис скрытия: прячем окно только после N плохих тиков подряд
 *  (~0.7 с при TRACK_INTERVAL_MS=350), иначе единичный промах EnumWindows
 *  или краткая потеря фокуса игрой мигает окном (show/hide-хлопки). */
const HIDE_AFTER_TICKS = 2;
let missTicks = 0;
let inactiveTicks = 0;

// Единственный экземпляр. Если прошлый процесс ещё жив (зомби после краша) —
// новый старт мгновенно завершается; пишем причину, чтобы это было видно.
if (!app.requestSingleInstanceLock()) {
  console.warn(
    '[overlay] другой экземпляр оверлея уже запущен (или висит зомби-процесс electron.exe) — этот завершается. Закройте старый (Диспетчер задач → electron.exe) и запустите заново.',
  );
  // Приложение падает в консоль/лог ДО инициализации окна — если лог пустой
  // ниже по файлу, значит дело именно в этом (зомби-процесс).
  app.quit();
  // quit() асинхронен — синхронная инициализация ниже успевает прокрутиться
  // и запутать лог (hotkey=false, GPU-cache 0x5, «окно закрыто»). Выходим сразу.
  process.exit(0);
} else {
  console.log('[overlay] single-instance lock получен — этот процесс главный');
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

/** Файл настроек оверлея (переживает перезапуск). */
function settingsFile(): string {
  return path.join(app.getPath('userData'), 'overlay-settings.json');
}

function loadSettings(): OverlaySettings {
  const base: OverlaySettings = { ...DEFAULT_SETTINGS, hotkeys: {} };
  try {
    // BOM-толерантность: файл иногда правят PowerShell-ом (Set-Content -Encoding utf8
    // в Windows PowerShell = UTF-8 с BOM) — JSON.parse с '\uFEFF' падает, и overlay
    // молча уходил в дефолты. BOM срезаем перед парсингом.
    let text = fs.readFileSync(settingsFile(), 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const raw = JSON.parse(text);
    if (raw && typeof raw === 'object') {
      const corners: OverlayCorner[] = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
      if (corners.includes(raw.corner)) base.corner = raw.corner;
      if (typeof raw.opacity === 'number') base.opacity = clamp(raw.opacity, 0.25, 1);
      if (typeof raw.scale === 'number') base.scale = clamp(raw.scale, 0.7, 1.4);
      if (typeof raw.width === 'number') base.width = clamp(Math.round(raw.width), 280, 640);
      if (raw.hotkeys && typeof raw.hotkeys === 'object') base.hotkeys = { ...raw.hotkeys };
      if (typeof raw.learn === 'boolean') base.learn = raw.learn;
      if (typeof raw.bindWindow === 'boolean') base.bindWindow = raw.bindWindow;
      if (typeof raw.autoClipboard === 'boolean') base.autoClipboard = raw.autoClipboard;
    }
  } catch {
    /* нет файла или он битый — берём настройки по умолчанию */
  }
  return base;
}

function saveSettings(s: OverlaySettings): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(s), 'utf8');
  } catch {
    /* некритично */
  }
}

function hotkeyFor(action: HotkeyAction): string {
  return settings.hotkeys[action] ?? DEFAULT_HOTKEYS[action];
}

/** Синхронизировать env POE2K_LEARN с галкой «журнал обучения» в настройках.
 *  core-функции проверяют env при каждом вызове — достаточно выставить его
 *  до первого прайс-чека (и при смене галки). */
function syncLearnEnv(): void {
  // Метка источника данных для журнала обучения (overlay/mcp/…).
  if (!process.env['POE2K_LEARN_SOURCE']) process.env['POE2K_LEARN_SOURCE'] = 'overlay';
  if (settings.learn) process.env['POE2K_LEARN'] = '1';
  else delete process.env['POE2K_LEARN'];
  console.log(`[overlay] learn log: ${settings.learn ? 'ON (opt-in)' : 'off'}`);
}

// ─── Автопрайс-чек из буфера (opt-in): слежение 500мс + дедуп ───────────────
// Приём из ExileOracle clipboard-monitor.ts: опрос буфера каждые 500мс,
// дедуп по последнему тексту, реакция только на клир-текст предметов.
// Приватность: выключено по умолчанию; когда включено — читает буфер постоянно,
// но реагирует лишь на текст с заголовком «Rarity:/Редкость:».

const CLIPBOARD_POLL_MS = 500;
let clipboardLastText = '';
let clipboardWatcher: ReturnType<typeof setInterval> | null = null;

/** Один тик слежения: дедуп → фильтр «похоже на предмет» → прайс-чек. */
async function autoClipboardTick(): Promise<void> {
  try {
    const text = clipboard.readText();
    if (!text || text === clipboardLastText) return; // дедуп: новое ≠ прошлое
    clipboardLastText = text;
    // Только клир-текст предметов (тот же якорь, что splitClipboardItems):
    // обычные копипасты (ссылки, код, PoB) игнорируются.
    if (!/^\s*(Rarity|Редкость)\s*:/im.test(text)) return;
    if (busy) {
      console.warn('[overlay] clipboard watch: busy — новый предмет пропущен');
      return;
    }
    console.log('[overlay] clipboard watch: новый предмет -> автопрайс-чек');
    await runPriceCheck();
  } catch {
    /* чтение буфера не удалось — тихо пропускаем тик */
  }
}

/** Включить/выключить слежение по settings.autoClipboard (idempotent). */
function syncClipboardWatcher(): void {
  const want = settings.autoClipboard === true;
  if (want && !clipboardWatcher) {
    // базой дедупа берём текущий буфер: первое включение НЕ триггерит проверку
    clipboardLastText = clipboard.readText();
    clipboardWatcher = setInterval(() => {
      void autoClipboardTick();
    }, CLIPBOARD_POLL_MS);
    console.log('[overlay] clipboard watch: ON (500ms, opt-in)');
  } else if (!want && clipboardWatcher) {
    clearInterval(clipboardWatcher);
    clipboardWatcher = null;
    console.log('[overlay] clipboard watch: off');
  }
}

/** Ограничить число диапазоном [min, max]. */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
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
  const c = settings.corner;
  const rightX = rect.x + rect.width - overlayWidth - MARGIN;
  const leftX = rect.x + MARGIN;
  const topY = rect.y + MARGIN;
  const bottomY = rect.y + rect.height - overlayHeight - MARGIN;
  let x = rightX;
  let y = topY;
  if (c === 'top-left') x = leftX;
  else if (c === 'bottom-right') y = bottomY;
  else if (c === 'bottom-left') {
    x = leftX;
    y = bottomY;
  }
  return { x: Math.round(x), y: Math.round(y) };
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
    // Окно могло жить с начальных координат создания (-w,-h — за экраном,
    // см. createOverlayWindow): трекер позиционирует его только после
    // нахождения окна игры. Если игра ещё не найдена, втаскиваем окно
    // в видимую рабочую область, иначе «move mode показывает пустоту».
    const [cx, cy] = win.getPosition();
    const area = screen.getPrimaryDisplay().workArea;
    const clampedX = Math.min(Math.max(cx, area.x), area.x + area.width - win.getBounds().width);
    const clampedY = Math.min(Math.max(cy, area.y), area.y + Math.max(area.height - win.getBounds().height, 100));
    if (clampedX !== cx || clampedY !== cy) {
      win.setPosition(clampedX, clampedY);
      console.log(
        `[overlay] move-mode: окно втянуто в видимую область (${cx},${cy}) -> (${clampedX},${clampedY})`,
      );
    }
    win.show();
    win.focus();
  } else {
    // Считаем смещение от «закреплённой» позиции относительно текущего окна игры
    // (в «осторожном режиме» — относительно угла рабочей области экрана, без FFI).
    if (settings.bindWindow === false) {
      const area = screen.getPrimaryDisplay().workArea;
      const pinned = pinnedPosition(area);
      const [wx, wy] = win.getPosition();
      userOffset = { x: wx - pinned.x, y: wy - pinned.y };
      saveUserOffset(userOffset);
      console.log(`[overlay] позиция закреплена (free mode): offset=${JSON.stringify(userOffset)}`);
      lastRectKey = ''; // форсируем следующий setBounds трекера
    } else {
      const found = findGameWindow({ titleKeyword: GAME_TITLE_KEYWORD });
      if (found) {
        const pinned = pinnedPosition(physicalRectToDip(found.rect));
        const [wx, wy] = win.getPosition();
        userOffset = { x: wx - pinned.x, y: wy - pinned.y };
        saveUserOffset(userOffset);
        console.log(`[overlay] позиция закреплена: offset=${JSON.stringify(userOffset)}`);
        lastRectKey = ''; // форсируем следующий setBounds трекера
      }
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

// ─── Панель настроек: прозрачность, масштаб, ширина, угол, хоткеи ────────────

/** Применить настройки отображения к окну и рендереру. */
function applyDisplaySettings(): void {
  const win = overlayWindow;
  if (win && !win.isDestroyed()) {
    win.setOpacity(settings.opacity);
    // Сбрасываем трекер: при смене ширины/угла пересчитаем закреплённую позицию.
    lastRectKey = '';
    trackGameWindow();
  }
  pushDisplaySettings();
}

/** Отправить текущие настройки отображения рендереру (CSS-переменные). */
function pushDisplaySettings(): void {
  overlayWindow?.webContents.send('settings:display', {
    opacity: settings.opacity,
    scale: settings.scale,
    width: overlayWidth,
    corner: settings.corner,
  });
}

/** Переключить панель настроек (Ctrl+F6). */
function toggleSettingsPanel(): void {
  overlayWindow?.webContents.send('settings:toggle');
}

/**
 * Применить новые настройки целиком (сохранить + применить отображение +
 * перерегистрировать хоткеи). Вызывается при сохранении из панели.
 */
function applySettings(next: OverlaySettings): void {
  settings = { ...next, hotkeys: { ...next.hotkeys } };
  syncLearnEnv();
  syncClipboardWatcher();
  saveSettings(settings);
  overlayWidth = settings.width;
  // №62: ручная высота применяется сразу (как ширина), включая слайдер в настройках.
  if (settings.autoHeight !== true) {
    const wa = screen.getPrimaryDisplay().workArea;
    overlayHeight = clamp(settings.height, OVERLAY_MIN_HEIGHT, wa.height - 2 * MARGIN);
    const win = overlayWindow;
    if (win && !win.isDestroyed()) {
      const b = win.getBounds();
      win.setBounds({ x: b.x, y: b.y, width: overlayWidth, height: overlayHeight });
    }
  }
  // Перерегистрируем хоткеи (убрать старые закрепления, зарегистрировать новые).
  if (app.isReady()) {
    globalShortcut.unregisterAll();
    registerHotkeys();
    sendBuildUpdate(); // gemLang и пр. меняют отображаемые имена сетапов
  }
  applyDisplaySettings();
}

/** Привести входящие данные из панели к валидным настройкам. */
function normalizeSettings(input: unknown): OverlaySettings {
  const raw =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const corners: OverlayCorner[] = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
  const next: OverlaySettings = { ...DEFAULT_SETTINGS, hotkeys: {} };
  if (corners.includes(raw.corner as OverlayCorner)) next.corner = raw.corner as OverlayCorner;
  if (typeof raw.opacity === 'number') next.opacity = clamp(raw.opacity, 0.25, 1);
  if (typeof raw.scale === 'number') next.scale = clamp(raw.scale, 0.7, 1.4);
  if (typeof raw.width === 'number') next.width = clamp(Math.round(raw.width), 280, 640);
  if (typeof raw.height === 'number') next.height = clamp(Math.round(raw.height), OVERLAY_MIN_HEIGHT, 1000);
  if (typeof raw.autoHeight === 'boolean') next.autoHeight = raw.autoHeight;
  if (typeof raw.learn === 'boolean') next.learn = raw.learn;
  if (typeof raw.bindWindow === 'boolean') next.bindWindow = raw.bindWindow;
  if (typeof raw.autoClipboard === 'boolean') next.autoClipboard = raw.autoClipboard;
  if (raw.gemLang === 'en' || raw.gemLang === 'ru') next.gemLang = raw.gemLang;
  next.hotkeys = {};
  if (raw.hotkeys && typeof raw.hotkeys === 'object') {
    for (const [action, combo] of Object.entries(raw.hotkeys as Record<string, unknown>)) {
      if (typeof combo === 'string' && combo.trim()) next.hotkeys[action as HotkeyAction] = combo.trim();
    }
  }
  return next;
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
        advice: raw.advice ?? null,
        gemSetups: raw.gemSetups ?? null,
        gemSeen: raw.gemSeen ?? null,
        panelVisible: false,
        tree: (raw.tree as BuildState['tree']) ?? null,
        starter: raw.starter ?? null,
      };
      buildState.slots.forEach((s) => {
        if (!('note' in s)) s.note = undefined;
      });
      console.log(`[overlay] build restored: slots=${buildState.slots.length} (${buildState.className ?? '?'})`);
      // Видимость состояния дерева в логе: без этой строки слепая зона —
      // не понять, есть ли 🌳 в state (backfill молчит, если сырец пуст).
      console.log(
        buildState.tree
          ? `[overlay] build tree in state: ${buildState.tree.resolved}/${buildState.tree.total} nodes (v=${buildState.tree.version ?? '?'})`
          : '[overlay] build tree in state: НЕТ (в панели появится после Ctrl+F3 или бэкфилла)',
      );
      // Старые state-файлы без gemSetups: досчитываем сетапы камней в фоне.
      if (buildState.rawInput && !buildState.gemSetups) {
        console.log('[overlay] gem setups missing in saved state, refreshing in background');
        void refreshGemSetups(buildState.rawInput);
      }
      // Старые state-файлы без дерева (v1.0.10 и старее): досчитываем пассивки в фоне.
      if (buildState.rawInput && !buildState.tree) {
        console.log('[overlay] build tree missing in saved state, refreshing in background');
        void core.build
          .importBuild(buildState.rawInput)
          .then((imp) => {
            if (buildState) {
              buildState.tree = buildTreeSummary(imp);
              saveBuildState();
              sendBuildUpdate({ status: 'ready' });
            }
          })
          .catch(() => {});
      }
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
        note: s.note ?? null,
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
      starter: buildState.starter,
      /** Оценка бюджета: сумма цен ещё не купленных предметов. */
      budgetLeft: remaining.reduce((sum, s) => sum + (s.median ?? 0), 0),
      budgetTotal: priced.reduce((sum, s) => sum + (s.median ?? 0), 0),
      summary: buildState.summary,
      metaSkills: buildState.metaSkills,
      advice: buildState.advice ?? null,
      gemSetups: buildState.gemSetups?.map((s) => ({
        ...s,
        active: gemDisplayName(s.active),
        supports: s.supports.map((g) => gemDisplayName(g)),
      })) ?? null,
      gemSeen: buildState.gemSeen ?? null,
      gemLang: settings.gemLang ?? 'ru',
      // Цвета камней (№56): ключ — gemKey(display-имя), тот же, что в рендерере;
      // значение — hex. Активным и саппортам (sinих/красных/зелёных) — ● перед именем.
      gemColors: (() => {
        const colors: Record<string, string> = {};
        const hexList = (en: string): string[] | null => {
          const c = core.dataset.supportGemColors(en) ?? core.dataset.supportGemColors(String(gemDisplayName(en)));
          if (!c) return null;
          return c.map((x) => (x === 'blue' ? '#7f8cff' : x === 'red' ? '#e0574f' : '#57d980'));
        };
        const push = (en: unknown) => {
          if (typeof en !== 'string' || !en) return;
          const disp = gemDisplayName(en);
          const key = disp.replace(/ё/g, 'е').replace(/\s+/g, ' ').trim().toLowerCase();
          if (colors[key] != null) return;
          const h = hexList(en);
          if (h) colors[key] = h.join(','); // гибриды: '#57d980,#7f8cff'
        };
        for (const s of buildState.gemSetups ?? []) {
          push(s.active);
          for (const g of s.supports) push(g);
        }
        return colors;
      })(),
      tree: buildState.tree ?? null,
    },
  };
}

/** Имя камня для отображения: EN-имя из PoB переводим в RU, если выбран ru-язык. */
function gemDisplayName(en: string): string {
  if ((settings.gemLang ?? 'ru') === 'en' || !gemEnRu.size) return en;
  return gemRuByName(en) ?? en;
}

/**
 * RU-имя саппорта по EN с фолбэками (журнал №47): poe2db хранит тиры как
 * «Precision I», а PoB/мета пишут «Precision»; часть саппортов начинается
 * с тира II (Greatwood II). Пробуем: точное имя → без тира → тир I → тир II,
 * из RU-результата тир вырезаем (уровень не знаем, показываем базовое имя).
 * Слаги poe2db бывают percent-encoded (Ois%C3%ADns_Oath) — их закрывает
 * диакритик-сворачивание в normName.
 */
function gemRuByName(enName: string): string | undefined {
  const stripTier = (ru: string): string => ru.replace(/\s+(?:II|III|IV|V)$/, '');
  const base = enName.replace(/\s+(?:II|III|IV|V)$/, '');
  // цепочка: точное → база (без_тира) → база тир I → база тир II.
  // RU-результат показываем без тира: реальный тир саппорта неизвестен.
  for (const candidate of [enName, base, `${base} I`, `${base} II`]) {
    const ru = gemEnRu.get(normName(candidate));
    if (ru) return candidate === enName ? ru : stripTier(ru);
  }
  // ступень rename-map: старое имя 0.3-меты -> новое имя 0.5 (meta_renames.json),
  // затем та же цепочка по новому имени (тир сохраняем: Ironwood III -> Reinforced Totems III)
  const renamed = core.dataset.getMetaRenames()?.map?.[base];
  if (renamed) {
    for (const candidate of [renamed, `${renamed} I`, `${renamed} II`]) {
      const ru = gemEnRu.get(normName(candidate));
      if (ru) return ru.replace(/\s+(?:I|II|III|IV|V)$/, '');
    }
  }
  return undefined;
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
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // Oisín's -> Oisins: percent-encoded слаги poe2db без диакритики
    .replace(/ё/g, 'е')
    .replace(/й/g, 'и') // poe2db RU-имена пишут «и» вместо «й» (малыи/великии/затеиливые) — сворачиваем обе стороны одинаково
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
  'Amulets', 'Rings', 'Belts', 'Jewels', 'Flasks', 'Charms',
  // v4: +Augment (руны/soul cores, ~600 белых: «Руна пустыни» → Desert Rune) —
  // Ctrl+F1 в RU-клиенте прайс-чекает аугменты. Страница тяжёлая (~1.7 МБ),
  // rate-limiter держит паузу; разметка a.whiteitem подтверждена 2026-09-30.
  'Augment',
] as const;

// v2: +Flasks — флаконы не входили в первый список, RU-базы вроде
// «Громадный флакон маны» не переводились → trade2 400 Unknown item base type.
// v3: +Charms (обереги: «Оберег с рубином» → 400 Unknown item base type,
// лог друга 29.09 09:50:38Z) + incomplete-poison guard: если при построении
// страница класса отдала пустые мапы (Cloudflare/сбой сети), дырявый словарь
// больше не кэшируется навсегда — при следующем старте достраиваем.
const RU_EN_DICT_VERSION = 4;
const ruEnBases = new Map<string, string>();
const ruEnUniques = new Map<string, string>();
let ruEnDictLoaded = false;
let ruEnDictPromise: Promise<void> | null = null;

function ruEnDictFile(): string {
  return path.join(app.getPath('userData'), 'ru-en-dict.json');
}

function saveRuEnDict(incomplete = false): void {
  try {
    const data = {
      version: RU_EN_DICT_VERSION,
      bases: Object.fromEntries(ruEnBases),
      uniques: Object.fromEntries(ruEnUniques),
      incomplete, // true = часть страниц classes не скачалась — при старте достроить
    };
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(ruEnDictFile(), JSON.stringify(data), 'utf8');
  } catch {
    /* некритично — в худшем случае пересоберём при следующем запуске */
  }
}

/** Загрузить кэш словаря с диска, если он есть. false = кэш неполный, стороим заново. */
function loadRuEnDict(): boolean {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(ruEnDictFile(), 'utf8'));
    const data = raw as { version?: number; bases?: Record<string, string>; uniques?: Record<string, string>; incomplete?: boolean };
    if (data.version !== RU_EN_DICT_VERSION) return false;
    // Частичный словарь подгружаем как промежуточный (матчинг работает по мере
    // достройки), но rebuild запускаем: дыры из-за сбойных страниц poison-кэша
    // repeating 400-ки по RU-базам (лог друга: «Затейливые перчатки» при живом
    // poe2db-переводе Intricate Gloves).
    const complete = data.incomplete !== true;
    for (const [k, v] of Object.entries(data.bases ?? {})) ruEnBases.set(normName(k), v);
    for (const [k, v] of Object.entries(data.uniques ?? {})) ruEnUniques.set(normName(k), v);
    if (!ruEnBases.size && !ruEnUniques.size) return false;
    console.log(`[overlay] ru-en dict loaded: ${ruEnBases.size} bases, ${ruEnUniques.size} uniques${complete ? '' : ' (неполный, достраиваем)'}`);
    return complete;
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
      const failed: string[] = [];
      for (const slug of EQUIPMENT_CLASS_SLUGS) {
        // пустые мапы = страница не скачалась (fetchClassTranslations глотает
        // ошибки) — retry, чтобы разовый сбой сети не оставил дыру в кэше
        let tr = { bases: new Map(), uniques: new Map() };
        for (let attempt = 1; attempt <= 2; attempt++) {
          tr = await core.poe2db.fetchClassTranslations(slug, 'ru');
          if (tr.bases.size || tr.uniques.size) break;
          if (attempt === 1) await new Promise((r) => setTimeout(r, 1500));
        }
        if (!tr.bases.size && !tr.uniques.size) failed.push(slug);
        for (const [k, v] of tr.bases) ruEnBases.set(normName(k), v);
        for (const [k, v] of tr.uniques) ruEnUniques.set(normName(k), v);
        saveRuEnDict(failed.length > 0); // прогресс сохраняем по ходу
      }
      ruEnDictLoaded = true;
      console.log(
        `[overlay] ru-en dict built: ${ruEnBases.size} bases, ${ruEnUniques.size} uniques` +
          (failed.length ? `; НЕДОСТРОЕНЫ (ретраи не помогли): ${failed.join(', ')}` : ' — полный'),
      );
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
  const exact = dict.get(normName(s));
  if (exact) return exact;
  if (kind === 'base') {
    // Магические предметы: строка имени = аффикс-префикс + чистая база
    // («Крепкая Жертвенная мантия», «Неразбавленный Великий флакон жизни»).
    // Точный ключ промазал — срезаем ведущие слова (≤3), пока не найдём базу.
    const words = normName(s).split(' ');
    for (let drop = 1; drop <= 3 && words.length - drop >= 2; drop++) {
      const hit = dict.get(words.slice(drop).join(' '));
      if (hit) return hit;
    }
  }
  return s;
}

// ─── Чек-лист камней: RU-имена гема из билда ← poe2db ────────────────────────
// RU-клиент: Ctrl+C на камне в окне умений даёт кириллическое имя («Ледяной
// удар»), PoB-билд — английское (Ice Strike). Словарь строим ТОЛЬКО для камней
// текущего билда: по EN-имени берём страницу poe2db.tw/ru/<Slug> и читаем
// <title> («Ледяной удар - PoE2DB…»). Это единственный проверенный формат.
const GEM_DICT_FILE_VERSION = 2;
const gemRuEn = new Map<string, string>(); // normName(RU-имя гема) -> EN-имя
const gemEnRu = new Map<string, string>(); // normName(EN-имя гема) -> RU-имя (отображение)

/** Сеять словарь офлайн-датасетом (1020 hemов, см. gemsRuEn.ts / _scrape_gems_ru_en.mjs). */
function seedGemDictFromDataset(): void {
  if (gemRuEn.size) return;
  for (const g of GEMS_RU_EN) {
    const kr = normName(g.ru);
    if (kr && !gemRuEn.has(kr)) gemRuEn.set(kr, g.en);
    const ke = normName(g.en);
    if (ke && !gemEnRu.has(ke)) gemEnRu.set(ke, g.ru);
  }
  console.log(`[overlay] gem ru⇄en seeded offline: ${gemRuEn.size} gems`);
}

function gemRuEnFile(): string {
  return path.join(app.getPath('userData'), 'gem-ru-en-dict.json');
}

function loadGemRuEnDict(): void {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(gemRuEnFile(), 'utf8'));
    const data = raw as { version?: number; map?: Record<string, string> };
    if (data.version !== GEM_DICT_FILE_VERSION || typeof data.map !== 'object') return;
    for (const [k, v] of Object.entries(data.map)) gemRuEn.set(normName(k), v);
    console.log(`[overlay] gem ru→en dict loaded: ${gemRuEn.size}`);
  } catch {
    /* нет файла — ок */
  }
}

function saveGemRuEnDict(): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(
      gemRuEnFile(),
      JSON.stringify({ version: GEM_DICT_FILE_VERSION, map: Object.fromEntries(gemRuEn) }),
      'utf8',
    );
  } catch {
    /* некритично */
  }
}

/**
 * Построить полный словарь RU→EN имён камней со списков poe2db
 * (/ru/Skill_Gems — 427 активных, /ru/Support_Gems — 557 саппортов).
 * Разметка подтверждена 2026-09-29: `<a class="gem_red|green|blue" href="/ru/<EN-слаг>">RU-имя</a>`.
 * EN-имя = слаг с подчёркиваниями → пробелы; EN-слаги канонические (Ice_Strike, Tempest_Bell).
 */
async function buildGemRuEnDict(): Promise<void> {
  seedGemDictFromDataset();
  loadGemRuEnDict(); // старый live-кэш поверх статики (там могли быть свежие имена)
  // Live-обновление поверх офлайн-датасета: poe2db пополняет камни с патчами.
  for (const page of ['Skill_Gems', 'Support_Gems']) {
    try {
      const res = await fetch(`https://poe2db.tw/ru/${page}`, {
        headers: { 'User-Agent': 'poe2-kit-overlay/1.0 (gem names)' },
      });
      if (!res.ok) {
        console.warn(`[overlay] gem dict: ${page} → HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      const aRe = /<a class="(?:gem_(?:red|green|blue)|gemitem)[^"]*"[^>]*href="\/ru\/([A-Za-z0-9_%'-]+)"[^>]*>([^<]+)<\/a>/g;
      let m: RegExpExecArray | null;
      let added = 0;
      while ((m = aRe.exec(html))) {
        const en = m[1]!.replace(/_/g, ' ');
        const ru = decodeEntities(m[2]!.trim());
        if (!ru) continue;
        const kr = normName(ru);
        if (kr && !gemRuEn.has(kr)) {
          gemRuEn.set(kr, en);
          added++;
        }
        const ke = normName(en);
        if (ke && !gemEnRu.has(ke)) gemEnRu.set(ke, ru);
      }
      console.log(`[overlay] gem dict: ${page} → +${added}`);
    } catch {
      /* сеть — best effort, попробуем при следующем геме */
    }
  }
  console.log(`[overlay] gem ru→en dict built: ${gemRuEn.size} gems`);
  saveGemRuEnDict();
}

let gemDictPromise: Promise<void> | null = null;
/** Дождаться словаря камней (строится один раз, конкурентные вызовы дедупятся). */
function ensureGemRuEnDict(): Promise<void> {
  if (gemRuEn.size) return Promise.resolve();
  if (!gemDictPromise) {
    gemDictPromise = buildGemRuEnDict().finally(() => {
      gemDictPromise = null;
    });
  }
  return gemDictPromise;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// ─── Рекомендованные саппорты для гема (poe2db «Recommended Support Gems») ──
// На странице каждого активного камня poe2db есть таблица «Ранг | Камни» —
// топ саппортов по рангам (ранг 1 = доступен раньше всего). Разметка
// подтверждена 2026-09-29 на /ru/Tempest_Bell. Кэш в userData.
const GEM_SUPPORTS_FILE_VERSION = 1;
const gemSupports = new Map<string, Array<{ rank: number; ru: string; en: string }>>();
const gemSupportsFetching = new Set<string>();

function gemSupportsFile(): string {
  return path.join(app.getPath('userData'), 'gem-supports-recommend.json');
}

function loadGemSupportsCache(): void {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(gemSupportsFile(), 'utf8'));
    const data = raw as { version?: number; map?: Record<string, Array<{ rank: number; ru: string; en: string }>> };
    if (data.version !== GEM_SUPPORTS_FILE_VERSION || typeof data.map !== 'object') return;
    for (const [k, v] of Object.entries(data.map)) gemSupports.set(k, v);
    console.log(`[overlay] gem supports cache loaded: ${gemSupports.size} gems`);
  } catch {
    /* нет файла — ок */
  }
}

function saveGemSupportsCache(): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(
      gemSupportsFile(),
      JSON.stringify({ version: GEM_SUPPORTS_FILE_VERSION, map: Object.fromEntries(gemSupports) }),
      'utf8',
    );
  } catch {
    /* некритично */
  }
}

/** Топ саппортов гема по рангам poe2db (null = страницы нет / не распarsedась). */
async function fetchGemSupports(en: string): Promise<Array<{ rank: number; ru: string; en: string }> | null> {
  const key = normName(en);
  if (!gemSupports.size) loadGemSupportsCache();
  if (gemSupports.has(key)) return gemSupports.get(key)!;
  if (gemSupportsFetching.has(key)) return gemSupports.get(key) ?? null; // уже качаем
  gemSupportsFetching.add(key);
  try {
    const slug = encodeURIComponent(en.trim().replace(/\s+/g, '_'));
    const res = await fetch(`https://poe2db.tw/ru/${slug}`, {
      headers: { 'User-Agent': 'poe2-kit-overlay/1.0 (gem supports)' },
    });
    if (!res.ok) {
      if (res.status === 404) console.warn(`[overlay] gem supports: нет страницы poe2db для "${en}"`);
      return null;
    }
    const html = await res.text();
    const head = html.indexOf('Recommended Support Gems');
    if (head < 0) return null;
    const tail = html.indexOf('</tbody>', head);
    if (tail < 0) return null;
    const sec = html.slice(head, tail);
    const rows: Array<{ rank: number; ru: string; en: string }> = [];
    const rowRe = /<tr><td>(\d+)<\/td><td>([\s\S]*?)<\/td><\/tr>/g;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(sec))) {
      const rank = Number(m[1]);
      let a: RegExpExecArray | null;
      const aRe = /href="\/ru\/([A-Za-z0-9_%'-]+)"[^>]*>([^<]+)<\/a>/g;
      while ((a = aRe.exec(m[2]!))) {
        const ru = decodeEntities(a[2]!.trim());
        if (ru) rows.push({ rank, ru, en: a[1]!.replace(/_/g, ' ') });
      }
    }
    if (!rows.length) return null;
    rows.sort((x, y) => x.rank - y.rank);
    gemSupports.set(key, rows);
    saveGemSupportsCache();
    console.log(
      `[overlay] gem supports: ${en} → ${rows.length} саппортов, ранги ${rows[0]!.rank}–${rows[rows.length - 1]!.rank}`,
    );
    return rows;
  } catch {
    return null;
  } finally {
    gemSupportsFetching.delete(key);
  }
}

/** Гем из клир-текста буфера (окно умений, Ctrl+C по камню). */
interface ParsedGem {
  name: string;
  total: number | null;
  native: number | null;
  isSupport: boolean;
}

/** Распознать текст гема. Формат RU-клиента подтверждён живыми копиями 2026-09-29.
 * Живой дефект (ватчлист 29.09): список умений/окно игры копирует гем БЕЗ строки
 * «Класс предмета: Камни…», с одной лишь «Редкость: Камень» — такие тексты
 * проваливались в item-прайс и RU-имя уходило в trade2 (400 «Unknown item name»).
 * Дополнительно: самопрайсинг https://poe2db по имени гема — только если есть
 * камень-маркер (класс ИЛИ редкость), одних строк «Уровень» недостаточно. */
function parseGemText(itemText: string): ParsedGem | null {
  const cls = itemText.match(/^\s*Класс предмета:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const hasGemRarity = /^\s*Редкость:\s*(?:Камень|Gem)\s*$/m.test(itemText);
  if (!/камни/i.test(cls) && !hasGemRarity) return null;
  const isSupport = /поддержки/i.test(cls) || /камень поддержки/i.test(itemText);
  const name = itemText
    .match(/^\s*Редкость:\s*(?:Камень|Gem)\s*\r?\n([^\r\n]+)$/m)?.[1]
    ?.trim();
  if (!name) return null;
  const total = Number(itemText.match(/^\s*Уровень:\s*(\d+)/m)?.[1] ?? NaN);
  const native = Number(itemText.match(/^\s*(\d+)\s+Уровн[^\r\n]*от камня\s*$/m)?.[1] ?? NaN);
  return {
    name,
    total: Number.isFinite(total) ? total : null,
    native: Number.isFinite(native) ? native : null,
    isSupport,
  };
}

/** Сопоставить скопированный гем с сетапами билда, отметить в чек-листе. */
async function handleGemCheck(gem: ParsedGem, itemText: string): Promise<Record<string, unknown>> {
  const ruName = gem.name;
  let en = gem.name;
  if (/[а-яё]/i.test(ruName)) {
    await withTimeout(ensureGemRuEnDict(), 20_000, 'ensureGemRuEnDict').catch(() => {});
    en = gemRuEn.get(normName(ruName)) ?? ruName;
  }
  const key = normName(en);
  let verdict = 'нет билда — просто гем';
  type GemSetupLike = { active: string; activeLevel: number | null; supports: string[]; source: 'socket' | 'passive'; where: string };
  let setup: GemSetupLike | null = null;
  if (buildState?.gemSetups) {
    const known = [
      ...new Set(buildState.gemSetups.flatMap((s) => [s.active, ...s.supports])),
    ].filter(Boolean);
    const inBuild = known.some((g) => normName(g) === key);
    const own = buildState.gemSetups.find((s) => normName(s.active) === key) ?? null;
    if (inBuild) {
      buildState.gemSeen ??= {};
      buildState.gemSeen[key] = {
        level: gem.total,
        native: gem.native,
        ru: ruName,
        at: Date.now(),
      };
      saveBuildState();
      sendBuildUpdate();
      setup = own;
      verdict = '✓ есть в билде';
    } else {
      verdict = '✗ не в билде';
    }
  }
  console.log(
    `[overlay] gem check: "${ruName}" → ${en} ур.${gem.total ?? '?'} (с камня ${gem.native ?? '?'}) — ${verdict}`,
  );

  // Активный камень: трёхслойная схема базы эталонов (журнал №40):
  // 1) мета-эталон 0.5.5 (meta_supports.json — PoB-потоки, «эталон»);
  // 2) poe2db-рекомендации (recommended_supports.json офлайн — «базово», ранги);
  // 3) live-fetch poe2db (если офлайн-датасета нет).
  type GemSupportRow = {
    rank: number | null;
    ru: string;
    en: string;
    name: string;
    inBuild: boolean;
    tier: 'meta' | 'base';
    color: string | null; // hex (№56): синий=Инт / красный=Сила / зелёный=Ловк, null = неизвестен
  };
  let supports: GemSupportRow[] | null = null;
  let supportsLabel = '';
  if (!gem.isSupport) {
    const lang = settings.gemLang ?? 'ru';
    const key0 = normName(en);
    const setupSupports = new Set((setup?.supports ?? []).map((s) => normName(s.replace(/ \(активный!\)$/, ''))));
    const supportColorHex = (enName: string): string | null => {
      const c = core.dataset.supportGemColors(enName);
      if (!c?.length) return null;
      return c.map((x) => (x === 'blue' ? '#7f8cff' : x === 'red' ? '#e0574f' : '#57d980')).join(',');
    };
    const toRow = (enName: string, ruName: string | undefined, rank: number | null, tier: 'meta' | 'base'): GemSupportRow => ({
      rank,
      ru: ruName ?? enName,
      en: enName,
      name: lang === 'en' ? enName : ruName ?? enName,
      inBuild: setupSupports.has(normName(enName)),
      tier,
      color: supportColorHex(enName),
    });
    seedGemDictFromDataset(); // gemEnRu — перевод мета-саппортов в RU
    const metaAll = core.dataset.getMetaSupports()?.entries?.[key0];
    if (metaAll?.length) {
      const m = metaAll[0]!; // первый = Min-Max-вариант гайда
      supports = m.supports.map((s) => toRow(s, gemRuByName(s), null, 'meta'));
      supportsLabel = `эталон меты 0.5.5: ${m.build}${m.date ? ` (${m.date})` : ''}`;
    } else {
      const base =
        core.dataset.getRecommendedSupports()?.map?.[key0] ??
        (await (withTimeout(fetchGemSupports(en), 20_000, 'fetchGemSupports').catch(() => null) as Promise<
          Array<{ rank: number; ru: string; en: string }> | null
        >));
      if (base) {
        supports = base.map((r) => toRow(r.en, r.ru, r.rank, 'base'));
        supportsLabel = 'базово: poe2db Recommended Support Gems (ранг = приоритет)';
      }
    }
  }

  return {
    itemName: `💎 ${en === ruName ? ruName : `${ruName} (${en})`} — ур. ${gem.total ?? '?'} · ${verdict}`,
    rarity: 'gem',
    estimate: null,
    listings: [],
    sources: supports ? [supportsLabel] : [],
    updatedAt: Date.now(),
    gemCheck: true,
    gemSupports: supports,
    itemText,
  };
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
    let matched = 0;
    let fresh = 0;
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
      if (same) {
        matched++;
        if (target.status !== 'bought') {
          target.status = 'bought';
          fresh++;
        }
      }
    }
    saveBuildState();
    console.log(
      `[overlay] char sync ok: ${charSync.character} (${charSync.league}), совпало слотов: ${matched} (новых: ${fresh})`,
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
 *
 * Повторный Ctrl+F3 не блокируется: новый импорт отменяет идущий прайсинг
 * (pricingToken) — старый цикл тихо останавливается на следующем слоте.
 */
let pricingToken = 0;

/**
 * Дерево билда: разбор пассивок PoB-импорта в кейнстоуны/нотабли.
 * Живое дерево персонажа PoE2 не экспортирует (сквозное знание, куб-4),
 * источник = Spec.nodes PoB-XML; имена/статы — core.dataset.resolvePassiveNodes.
 */
function buildTreeSummary(imported: {
  passiveNodes?: string[];
  treeVersion?: string;
}): BuildState['tree'] {
  const ids = imported.passiveNodes ?? [];
  if (!ids.length) return null;
  try {
    const rep = core.dataset.resolvePassiveNodes(ids);
    const pick = (n: { name: string; stats: string[] }) => ({ name: n.name, stats: n.stats });
    return {
      version: imported.treeVersion ?? null,
      total: rep.requested,
      resolved: rep.resolved.length,
      missing: rep.missing.length,
      keystones: rep.resolved.filter((n) => n.isKeystone).map(pick),
      notables: rep.resolved.filter((n) => n.isNotable && !n.isKeystone).map(pick),
    };
  } catch (err) {
    console.warn('[overlay] build tree: разбор не удался', err);
    return null;
  }
}

async function runBuildImport(): Promise<void> {
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

  const token = ++pricingToken;
  if (buildPricing) console.warn('[overlay] новый импорт отменяет прайсинг предыдущего билда');
  buildPricing = true;
  try {
    console.log(`[overlay] build import: ${input.length} chars from clipboard`);
    console.log(`[overlay] build import head: ${JSON.stringify(input.slice(0, 120))}`);
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
      advice: null,
      gemSetups: null,
      gemSeen: null,
      panelVisible: true,
      tree: buildTreeSummary(imported),
      starter: null,
    };
    saveBuildState();
    sendBuildUpdate({ status: 'ready' });
    // Сводка дерева: без неё нельзя по логу подтвердить, что 🌳-фича живая.
    const t = buildState.tree;
    console.log(
      t
        ? `[overlay] build tree: ${t.resolved}/${t.total} nodes, keystones=${t.keystones.length}, notables=${t.notables.length} (v=${t.version ?? '?'})`
        : '[overlay] build tree: нод не найдено в PoB-коде (проверьте Spec.nodes)',
    );
    console.log(
      `[overlay] build imported: ${buildState.slots.length} slots, class=${buildState.className ?? '?'} @${buildState.ascendancy ?? '?'}`,
    );

    // Живая панель: EHP/дыры защиты и мета — считаем в фоне, не мешая прайсингу.
    void refreshBuildEstimate();
    void refreshBuildMeta();
    // Сетапы камней («какие камни и куда вставлять») — тоже в фоне.
    void refreshGemSetups(input);
    // Автосинхронизация с персонажем poe.ninja (если настроена) — тоже в фоне.
    void syncCharacterGear();

    // Прайсинг слотов: строго последовательно (trade2 — 8 req/min под капотом ядра).
    for (const slot of buildState.slots) {
      if (pricingToken !== token) {
        console.log('[overlay] build pricing aborted: начат новый импорт');
        return;
      }
      if (slot.median != null) continue;
      // Charms/Flasks не торгуются на trade — не жжём на них 45-секундные таймауты.
      if (/^(charm|flask)/i.test(slot.slot)) {
        slot.status = 'todo' as const;
        continue;
      }
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
    if (pricingToken === token) {
      buildPricing = false;
      sendBuildUpdate({ status: 'ready' });
    }
  }
}

/**
 * №91: стартовый билд новичка (сюжет, Акты 1–4) по классу — без PoB-кода.
 * Слоты — white-базы из датасета (прайсятся trade2), камни — из проверенного
 * гайда прокачки класса (CLASS_LEVELING_GUIDES). Прайсинг — тот же цикл.
 */
async function importStarterBuild(classQuery: string): Promise<void> {
  const starter = core.starterBuilds.makeStarterBuild(classQuery);
  if (!starter) {
    sendBuildUpdate({ error: `Стартовый билд для «${classQuery}» не найден. Классы: см. список 8 базовых.` });
    return;
  }
  const token = ++pricingToken;
  buildPricing = true;
  try {
    console.log(`[overlay] starter build: class=${starter.className}`);
    sendBuildUpdate({ status: 'importing' });
    buildState = {
      rawInput: `starter:${starter.className}`,
      className: starter.className,
      level: 1,
      skills: starter.gemRanges.at(-1)?.gems.slice(0, 3) ?? [],
      importedAt: Date.now(),
      slots: starter.slots.map((s) => {
        let baseType = '';
        try {
          baseType = core.parse.parseItemText(s.itemText).baseType;
        } catch {
          /* синтетический текст — имя уже есть */
        }
        return {
          slot: s.slot,
          name: s.base,
          baseType: baseType || s.base,
          rarity: 'normal',
          median: null,
          confidence: null,
          status: 'todo' as const,
          itemText: s.itemText,
          note: s.note,
        };
      }),
      summary: null,
      metaSkills: null,
      advice: null,
      gemSetups: starter.gemRanges.map((r) => ({
        active: r.gems[0] ?? '',
        activeLevel: null,
        supports: [],
        source: 'socket' as const,
        where: `уровни ${r.range}`,
      })),
      gemSeen: null,
      panelVisible: true,
      tree: null,
      starter: {
        ascendancies: starter.ascendancies,
        treePriorities: starter.treePriorities,
      },
    };
    saveBuildState();
    sendBuildUpdate({ status: 'ready' });
    console.log(
      `[overlay] starter build imported: ${starter.className}, ${buildState.slots.length} slots, tagline="${starter.tagline}"`,
    );
    void refreshBuildEstimate();

    // Прайсинг слотов — тот же последовательный цикл, что у PoB-импорта.
    for (const slot of buildState.slots) {
      if (pricingToken !== token) {
        console.log('[overlay] starter pricing aborted: новый импорт');
        return;
      }
      if (slot.median != null) continue;
      if (/^(charm|flask)/i.test(slot.slot)) continue;
      try {
        const res = await withTimeout(core.trade.priceCheck(slot.itemText), HOTKEY_TIMEOUT_MS, 'priceCheck');
        slot.median = res.estimate?.median ?? null;
        slot.confidence = res.estimate?.confidence ?? null;
      } catch (err) {
        console.warn(
          `[overlay] starter price failed: slot=${slot.slot} item="${slot.name}": ${err instanceof Error ? err.message : err}`,
        );
      }
      sendBuildUpdate({ status: 'ready' });
    }
    saveBuildState();
    sendBuildUpdate({ status: 'ready' });
    console.log('[overlay] starter build pricing done');
  } finally {
    if (pricingToken === token) {
      buildPricing = false;
      sendBuildUpdate({ status: 'ready' });
    }
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
    // №85: мост core.advice → панель билда. adviseBuild(est) берёт те же оценки,
    // что и summary, поэтому считаем в одном месте; приоритеты сортирует ядро.
    try {
      const adv = core.advice.adviseBuild(est);
      buildState.advice = {
        classification: adv.classification,
        summary: adv.summary,
        totals: adv.totals,
        checklist: adv.checklist.slice(0, 5),
        items: adv.priorities.slice(0, 5).map((i) => ({
          priority: i.priority,
          title: i.title,
          action: i.action,
        })),
      };
      console.log(
        `[overlay] build advice: ${adv.classification} — b:${adv.totals.blocking} h:${adv.totals.high} m:${adv.totals.medium} l:${adv.totals.low}`,
      );
    } catch (advErr) {
      console.warn('[overlay] build advice failed:', advErr instanceof Error ? advErr.message : advErr);
    }
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

/** Сетапы камней билда («какие камни и куда вставлять») — фон, best-effort. */
async function refreshGemSetups(input: string): Promise<void> {
  if (!buildState) return;
  try {
    const setups = await withTimeout(core.build.buildGemSetups(input), 20_000, 'buildGemSetups');
    buildState.gemSetups = setups;
    saveBuildState();
    sendBuildUpdate();
    console.log(`[overlay] gem setups: ${setups.length} связок (${setups.map((s) => s.active).slice(0, 3).join(', ')}…)`);
    // Фон: полный словарь RU-имён камней с poe2db (нужно для Ctrl+C-чек-листа).
    void ensureGemRuEnDict();
  } catch (err) {
    console.warn('[overlay] gem setups failed:', err instanceof Error ? err.message : err);
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
    width: overlayWidth,
    height: overlayHeight,
    x: -overlayWidth,
    y: -overlayHeight,
    show: false,
    transparent: true,
    // Без этого прозрачное окно на первый кадр мигает чёрным/белым
    // (известный баг Chromium на Windows). Полная прозрачность с самого старта.
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    opacity: settings.opacity,
    hasShadow: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Клик проходит «сквозь» оверлей в игру, кроме случая, когда открыты
    // интерактивные элементы (см. ipc «interact:set»).
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
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

  // ─── Диагностическое логирование жизненного цикла окна/рендерера ──────────
  // Всё уходит в overlay.log: по нему удалённо видно, чем болел оверлей.
  overlayWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    // 0=INFOVerbose…3=ERROR; пишем всё, ротация ограничит объём.
    console.log(`[renderer] level=${level} ${message} (${sourceId}:${line})`);
  });
  overlayWindow.webContents.on('did-finish-load', () => {
    console.log('[overlay] renderer: did-finish-load (страница загружена)');
  });
  overlayWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[overlay] renderer: did-fail-load ${url}: код=${code} (${desc})`);
  });
  overlayWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error(
      `[overlay] renderer: ПРОЦЕСС РЕНДЕРЕРА ПАЛ (reason=${details.reason}, exitCode=${details.exitCode})`,
    );
  });
  overlayWindow.webContents.on('unresponsive', () => {
    console.error('[overlay] renderer: unresponsive (завис)');
  });
  overlayWindow.webContents.on('responsive', () => {
    console.log('[overlay] renderer: responsive (откликнулся)');
  });
  overlayWindow.on('closed', () => {
    console.log('[overlay] окно закрыто');
    overlayWindow = null;
  });

  // По умолчанию клики проходят в игру сквозь оверлей.
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  // Держим оверлей выше обычного «нормального» слоя, чтобы он был над окном игры.
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces?.(true);
}

/** Масштаб дисплея (Win32 100/125/150%…, в Electron это `scaleFactor`) для точки в физических пикселях. */
function displayScaleForPoint(x: number, y: number): number {
  let disp;
  try {
    disp = screen.getDisplayNearestPoint({ x, y });
  } catch {
    disp = screen.getPrimaryDisplay();
  }
  return disp.scaleFactor || 1;
}

/** Краткая сводка всех дисплеев: id/primary, масштаб (100/125/150%), bounds — для HiDPI-диагностики. */
function displayScaleSummary(): string {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen
    .getAllDisplays()
    .map((d) => {
      const b = d.bounds;
      return (
        `#${d.id}${d.id === primaryId ? '(primary)' : ''} scale=${d.scaleFactor} ` +
        `(${Math.round(d.scaleFactor * 100)}%) bounds=${b.x},${b.y} ${b.width}x${b.height}`
      );
    })
    .join(' | ');
}

/** Конвертирует физические пиксели (GetWindowRect) в DIP для Electron-окна. */
function physicalRectToDip(
  r: { left: number; top: number; right: number; bottom: number },
): { x: number; y: number; width: number; height: number } {
  const cx = Math.round((r.left + r.right) / 2);
  const cy = Math.round((r.top + r.bottom) / 2);
  const sf = displayScaleForPoint(cx, cy);
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

  // «Осторожный режим» (привязка к окну выключена): ни одного вызова user32 —
  // позиция = угол рабочей области основного монитора + смещение Ctrl+F5,
  // оверлей всегда видим (не прячется при alt-tab и свёрнутой игре).
  if (settings.bindWindow === false) {
    if (moveUnlocked) return; // пользователь тащит окно — не мешаем
    const area = screen.getPrimaryDisplay().workArea;
    const pinned = pinnedPosition(area);
    let x = pinned.x + (userOffset?.x ?? 0);
    let y = pinned.y + (userOffset?.y ?? 0);
    x = Math.min(Math.max(x, area.x), area.x + area.width - overlayWidth);
    y = Math.min(Math.max(y, area.y), area.y + Math.max(area.height - overlayHeight, 100));
    const key = `free:${x},${y},${overlayHeight}`;
    if (lastRectKey !== key) {
      lastRectKey = key;
      win.setBounds({ x, y, width: overlayWidth, height: overlayHeight });
      console.log(`[overlay] free mode: setBounds (${x},${y}) — привязка к окну игры выключена`);
    }
    if (!win.isVisible()) win.show();
    return;
  }

  const found = findGameWindow({ titleKeyword: GAME_TITLE_KEYWORD });

  if (!found) {
    // Игра/окно не найдено — прячем оверлей (кроме режима перемещения),
    // но не мгновенно: единичный «промах» перечисления окон не должен
    // мигать окном.
    if (!moveUnlocked) {
      if (++missTicks >= HIDE_AFTER_TICKS && win.isVisible()) {
        win.hide();
        console.log('[overlay] tracker: hide (окно игры не найдено)');
      }
    }
    return;
  }
  missTicks = 0;

  // Игра не в фокусе или свёрнута — прячем оверлей (кроме режима перемещения),
  // тоже с гистерезисом: alt-tab на долю секунды не должен мигать окном.
  const active = isGameForeground(found);
  if (!active && !moveUnlocked) {
    if (++inactiveTicks >= HIDE_AFTER_TICKS && win.isVisible()) {
      win.hide();
      console.log('[overlay] tracker: hide (игра не в фокусе/свёрнута)');
    }
    return;
  }
  inactiveTicks = 0;

  if (moveUnlocked) {
    // Пользователь тащит окно — не дёргаем позицию и не прячем его.
    if (!win.isVisible()) win.show();
    return;
  }

  // Позиция (DIP): правый верхний угол окна игры + сохранённое смещение.
  const pinned = pinnedPosition(physicalRectToDip(found.rect));
  let x = pinned.x + (userOffset?.x ?? 0);
  let y = pinned.y + (userOffset?.y ?? 0);

  // Не даём уехать за экран: старый офсет мог быть закреплён при другом
  // режиме окна игры (оконный → полный экран) и вынести оверлей за границу
  // монитора — тогда его просто не видно.
  const area = screen.getDisplayMatching(physicalRectToDip(found.rect)).workArea;
  x = Math.min(Math.max(x, area.x), area.x + area.width - overlayWidth);
  y = Math.min(Math.max(y, area.y), area.y + Math.max(area.height - overlayHeight, 100));

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
      width: overlayWidth,
      height: overlayHeight,
    });
    // HiDPI-диагностика: что реально применили (DIP), какой масштаб отдал screen
    // и какое смещение (dx,dy) пользователя участвовало. Троттлинг — не спамить.
    const now = Date.now();
    if (now - lastHiDpiLogTs >= HIDPI_LOG_INTERVAL_MS) {
      lastHiDpiLogTs = now;
      const sf = displayScaleForPoint(found.rect.left, found.rect.top);
      console.log(
        `[overlay] hiDPI: setBounds DIP=(${x},${y} ${overlayWidth}x${overlayHeight}) ` +
          `scale=${sf} (${Math.round(sf * 100)}%) dx=${userOffset?.x ?? 0} dy=${userOffset?.y ?? 0} ` +
          `winBounds=${JSON.stringify(win.getBounds())}`,
      );
    }
  }

  if (!win.isVisible()) {
    win.show();
    console.log(
      `[overlay] tracker: show (привязка к окну "${found.title.slice(0, 60)}" hwnd=${found.hwnd})`,
    );
  }
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

/** Разбивает буфер на блоки-предметы. Якорь — строка «Rarity:/Редкость:»:
 *  каждый новый предмет начинается с неё. Разделители (пустые строки, «--------»)
 *  внутри одного предмета игнорируются — счёт идёт по заголовкам Rarity.
 *  Строка «Класс предмета:/Item Class:» стоит ПЕРЕД Rarity и попадала в мусор —
 *  терялась, из-за чего parseGemText не видел гемов (main.ts:1324). Сохраняем её
 *  и приставляем к следующей группе. */
function splitClipboardItems(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const groups: string[][] = [];
  let cur: string[] | null = null;
  let pendingCls: string | null = null;
  for (const ln of lines) {
    if (/^\s*(?:Item Class|Класс предмета)\s*:/i.test(ln)) {
      pendingCls = ln;
      continue;
    }
    if (/^\s*(?:Rarity|Редкость)\s*:/i.test(ln)) {
      if (cur) groups.push(cur);
      cur = pendingCls ? [pendingCls, ln] : [ln];
      pendingCls = null;
    } else if (cur) {
      cur.push(ln);
    }
  }
  if (cur) groups.push(cur);
  return groups
    .filter((g) => g.some((l) => l.trim()))
    .map((g) => g.join('\n').trim())
    .filter((s) => s.length > 0);
}

/** Проверка цены одного предмета: ru→en переопределения, priceCheck, фолбэк на локальный парсинг. */
async function checkPriceItem(itemText: string): Promise<Record<string, unknown>> {
  // Камни умений/поддержки trade2 item-name поиском не прайсит — не ходим туда:
  // распознаём гем, отмечаем в чек-листе билда и показываем вердикт в панели.
  const gem = parseGemText(itemText);
  if (gem) return handleGemCheck(gem, itemText);

  // Русский клиент: trade2/poe2scout принимают только английские имена/базы.
  // Моды остаются ru — их trade2 по базе статов не сопоставит, сработает fallback «по базовому типу».
  let nameOverride: string | undefined;
  let baseTypeOverride: string | undefined;
  if (/[а-яё]/i.test(itemText)) {
    try {
      const parsed0 = core.parse.parseItemText(itemText);
      if (parsed0.name && /[а-яё]/i.test(parsed0.name)) {
        const en = toEn('unique', parsed0.name);
        if (en !== parsed0.name) nameOverride = en;
      }
      if (parsed0.baseType && /[а-яё]/i.test(parsed0.baseType)) {
        const en = toEn('base', parsed0.baseType);
        if (en !== parsed0.baseType) baseTypeOverride = en;
      }
      if (nameOverride || baseTypeOverride) {
        console.log(
          `[overlay] ru→en: name=${JSON.stringify(nameOverride)} base=${JSON.stringify(baseTypeOverride)}`,
        );
      }
    } catch {
      // парсинг упал — priceCheck сам разберётся с сырым текстом
    }
  }

  try {
    const result = await withTimeout(
      core.trade.priceCheck(itemText, { nameOverride, baseTypeOverride }),
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
    return { ...(result as unknown as Record<string, unknown>), itemText };
  } catch (err) {
    console.warn('[overlay] priceCheck failed:', err instanceof Error ? err.message : err);
    // Если priceCheck упал (сетевой/API) — пытаемся хотя бы распарсить локально.
    const parsed = core.parse.parseItemText(itemText);
    return {
      itemName: core.parse.itemDisplayName(parsed) || 'Неизвестный предмет',
      rarity: parsed.rarity.toLowerCase(),
      estimate: null,
      listings: [],
      sources: [],
      updatedAt: Date.now(),
      parseOnly: true,
      parseError: err instanceof Error ? err.message : String(err),
      itemText,
    };
  }
}

/** Билд-ассистент: сопоставить предмет со слотом билда и отметить собранным. */
function attachBuildMatch(result: Record<string, unknown>, itemText: string): void {
  if (!buildState || !itemText.trim()) return;
  try {
    const parsed = core.parse.parseItemText(itemText);
    const displayName = core.parse.itemDisplayName(parsed);
    const matched = matchBuildSlot(displayName, parsed.baseType);
    if (matched) {
      console.log(
        `[overlay] build slot matched: ${matched.slot} (item="${displayName}", base="${parsed.baseType}")`,
      );
      result.buildMatch = { slot: matched.slot, name: matched.name };
      markSlotBought(matched);
    }
  } catch {
    /* предмет из игры не парсится — ничего не сопоставляем */
  }
}

/** Убрать игровые служебные строки из копипаста окна умений/инвентаря.
 * Лог-факт №60: Ctrl+C по камню в RU-клиенте тащит хвост
 * «Умениями можно управлять в окне умений.» — в прайс-чек ему не место. */
function cleanGameFlavor(text: string): string {
  return text.replace(/^Умениями можно управлять в окне умений\.\s*\r?\n?/gm, '');
}

async function runPriceCheck(): Promise<unknown> {
  if (busy) {
    console.warn('[overlay] pricecheck skipped: busy=true (предыдущий запрос ещё не завершился)');
    return null;
  }
  busy = true;
  try {
    const raw = cleanGameFlavor(clipboard.readText());
    console.log(`[overlay] clipboard: ${raw.length} chars`);
    if (raw.trim()) {
      console.log(`[overlay] clipboard head: ${JSON.stringify(raw.slice(0, 80))}`);
    } else {
      console.warn('[overlay] clipboard is empty — Ctrl+C в игре по наведённому предмету?');
    }
    await overlayWindow?.webContents.send('price:busy', true);

    const started = Date.now();
    // Если ни одного заголовка Rarity — считаем весь буфер одним предметом
    // (прежнее поведение; тут же сработает подсказка про PoB-код ниже).
    const split = splitClipboardItems(raw);
    const list = split.length > 0 ? split : [raw.trim()].filter(Boolean);

    // ru-en словарь готовим один раз, если хоть один предмет на кириллице.
    if (list.some((it) => /[а-яё]/i.test(it))) {
      await withTimeout(ensureRuEnDict(), 10_000, 'ensureRuEnDict').catch(() => {});
    }

    const results: Record<string, unknown>[] = [];
    for (const it of list) {
      const r = await checkPriceItem(it);
      attachBuildMatch(r, it);
      results.push(r);
    }

    // Ctrl+F1 по ошибке с PoB-кодом билда в буфере? Подскажем про Ctrl+F3.
    // («--------» внутри предмета не даёт ложных срабатываний: счёт по Rarity.)
    if (results.length === 1 && raw.trim().length > 200) {
      const t = raw.trim();
      if (!/^\s*(Rarity|Редкость)\s*:/im.test(t) && /^[A-Za-z0-9+/=\s_-]+$/.test(t)) {
        results[0].buildCodeHint =
          'В буфере похоже PoB-код билда, а не предмет. Для импорта билда нажмите Ctrl+F3; для прайс-чека скопируйте предмет (Ctrl+C в игре по наведению).';
        console.warn('[overlay] pricecheck: буфер похож на PoB-код билда (подсказка)');
      }
    }

    const totalEstimate = results.reduce<number | null>((acc, r) => {
      const m = (r.estimate as { median?: number } | undefined)?.median;
      if (m == null) return acc;
      return acc == null ? m : acc + m;
    }, null);

    const payload = {
      items: results,
      count: results.length,
      totalEstimate,
      elapsedMs: Date.now() - started,
    };
    console.log(
      `[overlay] price batch: items=${results.length} totalEstimate=${totalEstimate} elapsedMs=${payload.elapsedMs}`,
    );
    await overlayWindow?.webContents.send('price:batch', payload);
    return payload;
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
  const ok = globalShortcut.register(hotkeyFor('price'), hotkeyAction);
  const okL = globalShortcut.register(hotkeyFor('leveling'), hotkeyLevelAction);
  const okM = globalShortcut.register(hotkeyFor('move'), () => {
    console.log('[overlay] hotkey fired: перемещение оверлея');
    toggleMoveMode();
  });
  // Сброс пользовательского смещения — если оверлей «потерялся» (закреплён
  // за пределами экрана при смене режима окна игры), возвращает в штатную
  // позицию у правого верхнего угла окна игры.
  const okR = globalShortcut.register('Control+Shift+F5', () => {
    console.log('[overlay] hotkey fired: Ctrl+Shift+F5 (сброс позиции оверлея)');
    resetOverlayOffset();
    if (moveUnlocked) {
      moveUnlocked = false;
      overlayWindow?.setFocusable(false);
      overlayWindow?.setIgnoreMouseEvents(true, { forward: true });
    }
  });
  const okBI = globalShortcut.register(hotkeyFor('buildImport'), () => {
    console.log('[overlay] hotkey fired: импорт билда из буфера');
    void runBuildImport();
  });
  const okBP = globalShortcut.register(hotkeyFor('buildPanel'), () => {
    console.log('[overlay] hotkey fired: панель билда');
    toggleBuildPanel();
  });
  const okS = globalShortcut.register(hotkeyFor('settings'), () => {
    console.log('[overlay] hotkey fired: панель настроек');
    toggleSettingsPanel();
  });
  console.log(`[overlay] hotkey ${hotkeyFor('price')} registered=${ok}`);
  console.log(`[overlay] hotkey ${hotkeyFor('leveling')} registered=${okL}`);
  console.log(`[overlay] hotkey ${hotkeyFor('move')} registered=${okM}`);
  console.log('[overlay] hotkey Control+Shift+F5 registered=' + okR);
  console.log(`[overlay] hotkey ${hotkeyFor('buildImport')} registered=${okBI}`);
  console.log(`[overlay] hotkey ${hotkeyFor('buildPanel')} registered=${okBP}`);
  console.log(`[overlay] hotkey ${hotkeyFor('settings')} registered=${okS}`);
}

// ─── Диагностика (кнопка «Отправить диагностику» в панели настроек) ──────────
// Собирает хвост overlay.log + конфиг машины в один текст, копирует в буфер
// обмена и сохраняет файл в userData — пользователю не нужно самому искать файлы.
function tailLines(file: string, n: number): string {
  try {
    if (!fs.existsSync(file)) return '';
    const arr = fs.readFileSync(file, 'utf8').split('\n');
    return arr.slice(-n).join('\n').replace(/\n+$/, '');
  } catch {
    return '(не удалось прочитать лог)';
  }
}

const DIAG_FILES = [
  'overlay.log',
  'overlay.log.1',
  'overlay.log.2',
  'overlay-settings.json',
  'watchlist.json',
  'build-state.json',
  'league.txt',
  'char-sync.json',
  'overlay-offset.json',
  'overlay-diagnostics.txt',
];

function collectDiagnostics(): string {
  const L: string[] = [];
  const userData = app.getPath('userData');
  L.push('=== PoE2 Kit overlay — диагностика (кнопка «Отправить диагностику») ===');
  L.push('Дата (UTC): ' + new Date().toISOString());
  L.push('Версия приложения: ' + app.getVersion());
  L.push('Electron / Node / Chrome: ' + process.versions.electron + ' / ' + process.versions.node + ' / ' + process.versions.chrome);
  L.push('Платформа: ' + process.platform + '/' + process.arch);
  L.push('ОС: ' + os.type() + ' release=' + os.release());
  L.push('CPU ядер: ' + os.cpus().length + '; RAM: ' + Math.round(os.totalmem() / 1024 ** 3) + ' ГБ');
  L.push('userData: ' + userData);
  L.push('cwd: ' + process.cwd());
  L.push('');
  L.push('-- Настройки оверлея --');
  L.push('corner: ' + settings.corner);
  L.push('bindWindow: ' + (settings.bindWindow ?? true));
  L.push('opacity: ' + settings.opacity);
  L.push('scale: ' + settings.scale);
  L.push('width: ' + settings.width);
  L.push('height: ' + overlayHeight + ' (autoHeight=' + (settings.autoHeight === true) + ')');
  L.push('hotkeys: ' + JSON.stringify(settings.hotkeys));
  L.push('');
  L.push('-- Состояние --');
  L.push('activeLeague: ' + (activeLeague ?? '(не выбрана)'));
  L.push('watchlist: ' + watchlist.length + ' позиций (активных ' + watchlist.filter((w) => w.enabled).length + ')');
  L.push('charSync: ' + (charSync ? charSync.character + ' (' + charSync.league + ')' : 'не задан'));
  L.push('buildState: ' + (buildState ? 'есть' : 'нет'));
  L.push('дисплеи (масштаб HiDPI): ' + displayScaleSummary());
  L.push('');
  L.push('-- Файлы в userData (имя: размер, существует/нет) --');
  for (const name of DIAG_FILES) {
    const fp = path.join(userData, name);
    let info = 'нет';
    try {
      info = fs.statSync(fp).size + ' Б';
    } catch {
      info = 'нет';
    }
    L.push(name + ': ' + info);
  }
  L.push('');
  L.push('-- Хвост overlay.log (последние 150 строк) --');
  L.push(tailLines(path.join(userData, 'overlay.log'), 150) || '(лог пуст)');
  return L.join('\n');
}

function setupIPC(): void {
  ipcMain.handle('price:check', () => runPriceCheck());

  ipcMain.handle('level:check', () => runLevelingContext());

  // №85: мёртвые ipc-хэндлеры league:get / hotkey:get удалены — рендерер их никогда
  // не вызывал (текущая лига приезжает через leagues:list, хоткеи — через settings:get).

  ipcMain.handle('league:set', (_evt, league: string) => {
    const v = typeof league === 'string' ? league.trim() : '';
    activeLeague = v || null;
    if (activeLeague) core.trade.setLeague(activeLeague);
    saveSavedLeague(activeLeague);
    return activeLeague;
  });

  // Список действующих лиг для селекта в ⚙ (poe2scout, кэш 6 ч; isCurrent → метка актуальной).
  ipcMain.handle('leagues:list', async () => {
    const fallback = activeLeague ?? null;
    try {
      const leagues = await withTimeout(core.trade.fetchLeagues(), 15_000, 'fetchLeagues');
      let current = activeLeague;
      if (!current) current = await withTimeout(core.trade.currentDefaultLeague(), 10_000, 'currentDefaultLeague');
      return {
        current: current ?? null,
        leagues: leagues.map((l) => ({ name: l.name, isCurrent: l.isCurrent === true })),
      };
    } catch {
      // Оффлайн/нет сети: отдаём статичный датасет-список, чтобы селект не был пустым.
      const known = core.trade.KNOWN_LEAGUES.map((l) => ({ name: l.name, isCurrent: l.isCurrent === true }));
      return { current: fallback, leagues: known.length ? known : [{ name: 'Standard', isCurrent: false }] };
    }
  });

  // Watchlist: список / добавить / удалить / вкл-выкл / проверить сейчас / из буфера.
  ipcMain.handle('watch:list', () => ({ entries: watchlistPublic() }));
  ipcMain.handle('watch:add', (_evt, p) => addWatchEntry(p));
  ipcMain.handle('watch:remove', (_evt, id) => removeWatchEntry(String(id)));
  ipcMain.handle('watch:toggle', (_evt, id) => toggleWatchEntry(String(id)));
  ipcMain.handle('watch:check', () => {
    void runWatchPoll(true);
    return { ok: true };
  });
  ipcMain.handle('watch:addBuffer', () => {
    const text = clipboard.readText();
    return addWatchEntry({ itemText: text });
  });

  // Настройки: получить/применить всё.
  ipcMain.handle('settings:get', () => ({
    corner: settings.corner,
    opacity: settings.opacity,
    scale: settings.scale,
    width: settings.width,
    learn: settings.learn ?? false,
    bindWindow: settings.bindWindow ?? true,
    autoClipboard: settings.autoClipboard ?? false,
    hotkeys: { ...settings.hotkeys },
    defaultHotkeys: { ...DEFAULT_HOTKEYS },
  }));

  ipcMain.handle('settings:apply', (_evt, next) => {
    try {
      const s = normalizeSettings(next);
      applySettings(s);
      return { ok: true, settings: s };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

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

  // №91: стартовые билды новичка (сюжет) — список классов + импорт без PoB-кода.
  ipcMain.handle('starter:list', () => core.starterBuilds.listStarterBuilds());
  ipcMain.handle('starter:import', (_e, klass: unknown) => {
    const q = typeof klass === 'string' ? klass : '';
    if (!q) return { ok: false, error: 'не указан класс' };
    console.log(`[overlay] tab: стартовый билд (${q})`);
    void importStarterBuild(q);
    return { ok: true };
  });
  // №92: выбор асценданси стартового билда — кейстоуны из датасета.
  ipcMain.handle('starter:pick_asc', (_e, name: unknown) => {
    const picked = typeof name === 'string' ? name : '';
    if (!buildState?.starter || !picked) return { ok: false };
    const asc = buildState.starter.ascendancies.find((a) => a.name === picked);
    if (!asc) return { ok: false };
    buildState.ascendancy = asc.name;
    buildState.starter.ascPicked = asc.name;
    buildState.starter.ascKeystones = core.starterBuilds.ascendancyKeystones(asc.id);
    console.log(
      `[overlay] starter ascendancy: ${asc.name} (${asc.id}) — keystones: ${(buildState.starter.ascKeystones ?? []).join(', ') || 'нет'}`,
    );
    saveBuildState();
    sendBuildUpdate({ status: 'ready' });
    return { ok: true };
  });

  // №64: вкладки в рендерере открывают те же панели, что и хоткеи —
  // «тот же способ переключения», но кликом. Единая точка: те же функции.
  ipcMain.handle('panel:open', (_e, action: unknown) => {
    switch (action) {
      case 'price':
        console.log('[overlay] tab: прайс-чек (Ctrl+F1)');
        void runPriceCheck();
        break;
      case 'level':
        console.log('[overlay] tab: прокачка (Ctrl+F4)');
        void runLevelingContext();
        break;
      case 'build':
        console.log('[overlay] tab: панель билда (Ctrl+F2)');
        toggleBuildPanel();
        break;
      case 'import':
        console.log('[overlay] tab: импорт билда (Ctrl+F3)');
        void runBuildImport();
        break;
      case 'settings':
        console.log('[overlay] tab: настройки (Ctrl+F6)');
        toggleSettingsPanel();
        break;
      default:
        return { ok: false, error: 'unknown action' };
    }
    return { ok: true };
  });

  // Помощник по пассивному дереву: поиск нод по имени/стату (офлайн, dataset).
  ipcMain.handle('tree:search', (_e, q: unknown) => {
    const query = typeof q === 'string' ? q.trim() : '';
    if (query.length < 2) return [];
    try {
      const hits = core.dataset.searchPassiveTree(query, { limit: 40 });
      // Приоритет: кейнстоуны > нотабли > мелкие; дубликаты имён схлопываем.
      const rank = (n: { isKeystone: boolean; isNotable: boolean }) =>
        n.isKeystone ? 0 : n.isNotable ? 1 : 2;
      const seen = new Set<string>();
      const rows = hits
        .sort((a, b) => rank(a) - rank(b))
        .filter((n) => {
          const key = `${n.name}#${rank(n)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 14)
        .map((n) => ({
          name: n.name,
          isKeystone: n.isKeystone,
          isNotable: n.isNotable,
          ascendancy: n.ascendancy,
          stats: n.stats.slice(0, 4),
        }));
      return rows;
    } catch {
      return [];
    }
  });

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
    // №62: по умолчанию (autoHeight=false) высота ФИКСИРОВАНА настройкой —
    // окно не прыгает при переключении панелей (прайс → билд → прокачка),
    // длинный контент скроллится внутри (renderer клэмпит панель этой высотой).
    // px (естественная высота контента) используется только в авто-режиме.
    const manual = settings.autoHeight !== true;
    let h = manual ? settings.height : Math.round(Number(px));
    if (!Number.isFinite(h) || h <= 0) return overlayHeight;
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    h = Math.min(h, wa.height - 2 * MARGIN);
    h = Math.max(h, OVERLAY_MIN_HEIGHT);
    const b = win.getBounds();
    if (h !== b.height) {
      overlayHeight = h;
      win.setBounds({ x: b.x, y: b.y, width: overlayWidth, height: h });
      console.log(`[overlay] autosize: height=${h}`);
    }
    return overlayHeight;
  });

  // Диагностика: собрать хвост overlay.log + конфиг машины, скопировать в буфер
  // и сохранить файл в userData (кнопка «Отправить диагностику» в панели настроек).
  ipcMain.handle('diag:collect', () => {
    try {
      const text = collectDiagnostics();
      const file = path.join(
        app.getPath('userData'),
        // один файл на перезапись (было: overlay-diagnostics-<timestamp>.txt — копии плодили мусор)
        'overlay-diagnostics.txt',
      );
      fs.writeFileSync(file, text, 'utf8');
      clipboard.writeText(text);
      console.log(
        `[overlay] diagnostics: ${text.length} симв. / ${text.split('\n').length} строк, скопировано в буфер; файл=${file}`,
      );
      return { ok: true, chars: text.length, lines: text.split('\n').length, file };
    } catch (err) {
      console.error('[overlay] diagnostics: ошибка сбора', err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Журнал обучения (opt-in): сводка + вклад в библиотеку предметов ──────
  ipcMain.handle('learn:info', () => {
    try {
      const info = core.learn.learnLogInfo();
      return { ok: true, enabled: settings.learn ?? false, records: info.records, dir: info.dir };
    } catch {
      return { ok: true, enabled: settings.learn ?? false, records: 0, dir: null };
    }
  });

  ipcMain.handle('learn:contribute', () => {
    try {
      const contrib = core.learn.buildItemContribution();
      const json = JSON.stringify(contrib, null, 2);
      const file = path.join(
        app.getPath('userData'),
        // ⚡ один файл на перезапись: таймстамп-версии плодили мусор в userData
        'poe2-items-contribution.txt',
      );
      // Памятка для не-техника: что делать с этим текстом (вставить в issue).
      const text =
        'ВКЛАД В БИБЛИОТЕКУ ПРЕДМЕТОВ PoE2 Kit (предметов: ' + contrib.entries.length + ')\n' +
        '----------------------------------------------------------------\n' +
        '1. Откройте: https://sourcecraft.dev/volkovpartilaholin/poe2-kit/issues/new\n' +
        '2. Название: «Item contribution (N items)». Вставьте этот текст в описание.\n' +
        '3. Опубликуйте issue — на этом всё, спасибо!\n' +
        'Вклад содержит ТОЛЬКО структуру предметов (редкость/база/моды),\n' +
        'без персонажей, аккаунтов и лазаний. Подробнее: SECURITY.md / PRIVACY.\n' +
        '----------------------------------------------------------------\n' +
        json;
      fs.writeFileSync(file, text, 'utf8');
      clipboard.writeText(text);
      console.log(`[overlay] learn contribution: ${contrib.entries.length} форм предметов, буфер=ON, файл=${file}`);
      return { ok: true, count: contrib.entries.length, chars: text.length, file };
    } catch (err) {
      console.error('[overlay] learn contribution: ошибка', err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

const IS_SMOKE = process.argv.includes('--smoke');

app.whenReady().then(async () => {
  // Стартовый баннер: удалённая диагностика без вопросов «какая версия?».
  console.log(
    `[overlay] init: electron=${process.versions.electron} node=${process.versions.node} chrome=${process.versions.chrome}, ${process.platform}/${process.arch}`,
  );
  console.log(
    `[overlay] init: userData=${app.getPath('userData')} cwd=${process.cwd()} argv=${JSON.stringify(process.argv)}`,
  );

  // Windows: без AppUserModelID системные тосты (уведомления о падении цены) не показываются.
  if (process.platform === 'win32') {
    try {
      app.setAppUserModelId('com.poe2kit.overlay');
    } catch {
      /* некритично */
    }
  }

  // Восстанавливаем сохранённые настройки (угол, прозрачность, масштаб, ширина,
  // хоткеи) до создания окна/трекера, чтобы геометрия сразу была правильной.
  settings = loadSettings();
  overlayWidth = settings.width;
  // №62: стартовая геометрия — ручная высота (в авто-режиме её поправит
  // первый autosize-тик рендерера после загрузки).
  if (settings.autoHeight !== true) {
    const wa = screen.getPrimaryDisplay().workArea;
    overlayHeight = clamp(settings.height, OVERLAY_MIN_HEIGHT, wa.height - 2 * MARGIN);
  }
  syncLearnEnv();
  syncClipboardWatcher(); // если сохранён autoClipboard=on — стартуем слежение сразу
  console.log(
    `[overlay] settings: corner=${settings.corner} opacity=${settings.opacity} scale=${settings.scale} width=${settings.width} height=${overlayHeight} autoHeight=${settings.autoHeight === true}`,
  );

  // HiDPI-диагностика: что Electron видит как масштаб каждого дисплея (100/125/150%).
  // Напоминание: включён force-device-scale-factor=1 — DIP окна == пиксель 1:1,
  // поэтому scaleFactor из screen может отличаться от реального масштаба Windows.
  console.log(`[overlay] hiDPI: displays → ${displayScaleSummary()}`);
  // Живьём ловим смену масштаба дисплея (например, 125% → 150% в настройках Windows).
  screen.on('display-metrics-changed', (_e, display, changedMetrics) => {
    console.log(
      `[overlay] hiDPI: display-metrics-changed #${display.id} scale=${display.scaleFactor} ` +
        `(${Math.round(display.scaleFactor * 100)}%) метрики=${changedMetrics.join(',')}`,
    );
    console.log(`[overlay] hiDPI: displays теперь → ${displayScaleSummary()}`);
  });

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
  seedGemDictFromDataset(); // офлайн-словарь камней для чек-листа и языка отображения
  // Источник автосинхронизации с персонажем poe.ninja (если настраивали раньше).
  loadCharSync();
  console.log(
    `[overlay] char sync source: ${charSync ? `${charSync.character} (${charSync.league})` : 'не задан'}`,
  );
  // Watchlist: восстанавливаем список отслеживаемых предметов из userData.
  loadWatchlist();
  // №85: агентский канал — MCP-туры дописывают команды в agent-queue.json, overlay применяет.
  startAgentQueuePolling();
  // Словарь ru↔en для сопоставления слотов: кэш с диска, недостающее — докачиваем в фоне.
  if (!loadRuEnDict()) void ensureRuEnDict();
  setupIPC();
  void createOverlayWindow().then(() => {
    startGameTracker();
    // Watchlist: фоновый поллинг цен после создания окна.
    startWatchTimer();
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
      console.log(`[smoke] hotkey_ok=${globalShortcut.isRegistered(hotkeyFor('price'))}`);
      console.log(`[smoke] parse_ok=${core.parse.itemDisplayName(parsed)} (${parsed.rarity})`);
      console.log(`[smoke] watchlist_ok=${Array.isArray(watchlist)} entries=${watchlist.length}`);
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

app.on('will-quit', (_e) => {
  console.log('[overlay] app: will-quit (выход из приложения)');
  stopGameTracker();
  stopWatchTimer();
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