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
  // №100: Error-объекты JSON.stringify даёт как "{}" (неперечислимые поля),
  // поэтому разворачиваем их в message+stack — иначе причина падения теряется.
  const serializeArg = (a: unknown): string => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? '(нет stack)'}`;
    try {
      return JSON.stringify(a) ?? String(a);
    } catch {
      return String(a);
    }
  };
  const stamp = (args: unknown[]): string =>
    `${new Date().toISOString()} ${args.map(serializeArg).join(' ')}\n`;
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
  statEvent('crash:uncaughtException', err?.message);
});
process.on('unhandledRejection', (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('[overlay] unhandledRejection:', reason instanceof Error ? reason.stack : msg);
  statEvent('crash:unhandledRejection', msg);
});

// ─── №100: счётчики событий сессии → в диагностику ────────────────────────────
// Пока «настраиваем», удалённо важно видеть не только хвост лога, но и суммы:
// сколько прайс-чеков было успешным, какие ошибки сколько раз и когда последний.
interface StatEntry {
  count: number;
  first: string;
  last: string;
  lastDetail?: string;
}
const sessionStats = new Map<string, StatEntry>();

function statEvent(name: string, detail?: string): void {
  const now = new Date().toISOString();
  const e = sessionStats.get(name) ?? { count: 0, first: now, last: now };
  e.count += 1;
  e.last = now;
  if (detail !== undefined) e.lastDetail = detail;
  sessionStats.set(name, e);
}

/** Сводка счётчиков для диагностики: по убыванию счётчика, с окнами времени. */
function sessionStatsDigest(): string[] {
  const rows = [...sessionStats.entries()].sort((a, b) => b[1].count - a[1].count);
  return rows.map(
    ([name, e]) =>
      `${name}: ×${e.count} (${e.first.slice(11, 19)} → ${e.last.slice(11, 19)} UTC)` +
      (e.lastDetail ? ` | последний: ${e.lastDetail}` : ''),
  );
}

// ─── Настройки по умолчанию ────────────────────────────────────────────────
// Хоткеи — F-клавиши с Ctrl: почти не конфликтуют ни с игрой, ни с Intel/Discord
// (Ctrl+Alt+X/Alt+B часто заняты системным софтом гейм-ПК).
const PRICE_HOTKEY = 'Control+F1';
const LEVELING_HOTKEY = 'Control+F4';
const MOVE_HOTKEY = 'Control+F5';
const BUILD_IMPORT_HOTKEY = 'Control+F3';
const BUILD_PANEL_HOTKEY = 'Control+F2';
const SETTINGS_HOTKEY = 'Control+F6';
// №111: чекап перед пиннаклом — F7 свободна (заняты F1–F6, F5-варианты не пересекаются).
const PINNACLE_HOTKEY = 'Control+F7';
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
  /** №105: цветовая тема доступности. 'contrast' — максимальный контраст,
   *  'cb' — палитра Okabe-Ito (безопасна при красно-зелёной и сине-жёлтой
   *  слепоте; статусы различимы и по светлоте), 'custom' — свои цвета ниже. */
  theme?: 'default' | 'contrast' | 'cb' | 'custom';
  /** №105: свои цвета (hex '#rrggbb'), применяются при theme='custom'
   *  (частично — поверх дефолтной темы). */
  colors?: { bg?: string; fg?: string; dim?: string; accent?: string };
  /** №113b: id вкладок, скрытых из боковой колонки кнопок (панель остаётся
   *  доступной по хоткею и из настроек). 'settings' скрыть нельзя — управление. */
  hiddenTabs?: string[];
}

/** №113b: полный список вкладок панели (data-tab) — для санитайза hiddenTabs. */
const PANEL_TABS = ['price', 'build', 'gems', 'import', 'level', 'maps', 'pinnacle', 'slang', 'craft', 'rates', 'gen', 'settings'] as const;

type HotkeyAction =
  | 'price'
  | 'leveling'
  | 'move'
  | 'buildImport'
  | 'buildPanel'
  | 'settings'
  | 'pinnacle';

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
  theme: 'default',
  colors: {},
  hiddenTabs: [],
};

/** Стандартные хоткеи для действия (если пользователь не переопределил). */
const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = {
  price: PRICE_HOTKEY,
  leveling: LEVELING_HOTKEY,
  move: MOVE_HOTKEY,
  buildImport: BUILD_IMPORT_HOTKEY,
  buildPanel: BUILD_PANEL_HOTKEY,
  settings: SETTINGS_HOTKEY,
  pinnacle: PINNACLE_HOTKEY,
};

/** Активные настройки оверлея. */
let settings: OverlaySettings = { ...DEFAULT_SETTINGS, hotkeys: {} };

let activeLeague: string | null = null;
let overlayWindow: BrowserWindow | null = null;
let busy = false;
/** Режим перемещения оверлея (Ctrl+F5): окно кликабельно и таскается мышью. */
let moveUnlocked = false;
// №113e-b: true = клавиатуру сейчас держит поле ввода (keyboard:set):
// before-input-event НЕ гасит keystrokes.
let keyboardCaptured = false;
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

/** №113c: адаптивная точность цен — хаосовые цены бывает < 0.1 (0.015 = пол-экза),
 *  toFixed(1) давал бессмысленный алерт «0.0 → 0.0» (лог-факт 04:46:30Z). */
function fmtChaos(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

/** №113c: порог падения для алерта (доля от базовой линии). Медиана trade2
 *  шумит на ±единицы процентов; без порога алертило на −6% по мелочи. */
const WATCH_DROP_ALERT_REL = 0.1;

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
  // №113c: алерт — только падение ≥10% от базовой линии (шум медианы trade2
  // на мелких дробях раньше алертил на −6% с текстом «0.0 → 0.0»).
  // База при падении НЕ двигается: накопленное падение за порог — всё равно алерт.
  const dropped = entry.lastPrice > 0 && (entry.lastPrice - m) / entry.lastPrice >= WATCH_DROP_ALERT_REL;
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
  /** №131: разбивка DPS оружия для блока в панели билда. */
  weaponPhysDps?: number | null;
  weaponElemDps?: number | null;
  weaponAps?: number | null;
  notes: string[];
  /** №108: суммы резистов из клир-текста гира (без PoB-верификации),
   *  для подсветки квестов «резист < 75%». null = оценка не считалась. */
  resists?: { fire: number; cold: number; lightning: number; chaos: number } | null;
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
    /** №106: привязка группы к оружейному набору (set1/set2 из PoB).
     *  '1'/'2' — только этот набор (вне его игра блокирует умение),
     *  'both' — любой, undefined — в билде данных нет. */
    weaponSet?: 'both' | '1' | '2';
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
  // №105: единая проверка настроек — тот же normalizeSettings, что и для
  // settings:apply (раньше hand-parse ВЫБРАСЫВАЛ height/autoHeight/gemLang —
  // ручная высота и язык камней не переживали рестарт).
  try {
    // BOM-толерантность: файл иногда правят PowerShell-ом (Set-Content -Encoding utf8
    // в Windows PowerShell = UTF-8 с BOM) — JSON.parse с '\uFEFF' падает, и overlay
    // молча уходил в дефолты. BOM срезаем перед парсингом.
    let text = fs.readFileSync(settingsFile(), 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return normalizeSettings(JSON.parse(text));
  } catch {
    /* нет файла или он битый — берём настройки по умолчанию */
    return { ...DEFAULT_SETTINGS, hotkeys: {} };
  }
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
    keyboardCaptured = false; // №113e-b: move-режим не текстовый ввод
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
    keyboardCaptured = false; // №113e-c: выходим из move-режима — гаситель клавиш обратно активен
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
    theme: settings.theme ?? 'default',
    colors: settings.colors ?? {},
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
  // №105: цветовая тема доступности.
  const themes = ['default', 'contrast', 'cb', 'custom'] as const;
  if (themes.includes(raw.theme as (typeof themes)[number])) next.theme = raw.theme as OverlaySettings['theme'];
  if (raw.colors && typeof raw.colors === 'object') {
    const HEX_RE = /^#[0-9a-f]{6}$/i;
    const src = raw.colors as Record<string, unknown>;
    const dst: NonNullable<OverlaySettings['colors']> = {};
    for (const key of ['bg', 'fg', 'dim', 'accent'] as const) {
      const v = src[key];
      if (typeof v === 'string' && HEX_RE.test(v)) dst[key] = v.toLowerCase();
    }
    if (Object.keys(dst).length) next.colors = dst;
  }
  // №113b: видимость вкладок — только известные id, без 'settings', без дублей.
  if (Array.isArray(raw.hiddenTabs)) {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const v of raw.hiddenTabs) {
      if (typeof v === 'string' && v !== 'settings'
        && (PANEL_TABS as readonly string[]).includes(v) && !seen.has(v)) {
        seen.add(v);
        ids.push(v);
      }
    }
    next.hiddenTabs = ids;
  }
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
      /** №92-бис: true — текущий билд стартовый (повторный выбор класса заменяет свободно). */
      isStarter: buildState.rawInput.startsWith('starter:'),
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
  // v5 (ТЗ-A1): валюты/стакаблы — a.item_currency (разметка живая 30.09.2026):
  // Stackable_Currency (сферы: «Сфера алхимии»→Orb of Alchemy), Essence, Omens,
  // Catalysts, Rune (пересекается с Augment — дубль безвреден), Liquid_Emotions,
  // Splinter. Слаг 'Currency' — хаб без таблиц (мусор), НЕ использовать.
  'Stackable_Currency',
  'Essence',
  'Omens',
  'Catalysts',
  'Rune',
  'Liquid_Emotions',
  'Splinter',
] as const;

// v2: +Flasks — флаконы не входили в первый список, RU-базы вроде
// «Громадный флакон маны» не переводились → trade2 400 Unknown item base type.
// v3: +Charms (обереги: «Оберег с рубином» → 400 Unknown item base type,
// лог друга 29.09 09:50:38Z) + incomplete-poison guard: если при построении
// страница класса отдала пустые мапы (Cloudflare/сбой сети), дырявый словарь
// больше не кэшируется навсегда — при следующем старте достраиваем.
// v5 (ТЗ-A1): +валюты (Stackable_Currency/Essence/Omens/Catalysts/Rune/
// v6 (№138, живой лог 01.10 06:00:30): Uncut-камни — это item-класс Gems, их
// нет ни в EQUIPMENT_CLASS_SLUGS, ни на страницах классов → RU-базы не
// переводились → trade2 400 «Unknown item base type» («Неогранённый камень
// духа (уровень 14)»). RU-имена всех трёх ✅ проверены poe2db.tw/ru/<Slug>
// (поля BaseType, 01.10.2026) — НЕ ручные догадки.
// Liquid_Emotions/Splinter через a.item_currency) — RU-валюты прайс-чекаются.
const RU_EN_DICT_VERSION = 6;
// Статические дополнения к словарю (ключи — normName внутри seedRuEnStatic()).
const RU_EN_STATIC_BASES: Array<[string, string]> = [
  ['Неогранённый камень духа', 'Uncut Spirit Gem'],
  ['Неогранённый камень умения', 'Uncut Skill Gem'],
  ['Неогранённый камень поддержки', 'Uncut Support Gem'],
];
/** Влить статические RU→EN-базы (идемпотентно). */
function seedRuEnStatic(): void {
  for (const [ru, en] of RU_EN_STATIC_BASES) ruEnBases.set(normName(ru), en);
}
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
  seedRuEnStatic(); // статические базы (#138 Uncut) — до кэша
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
    statEvent('charSync:ok', `${charSync.character}: совпало ${matched}, новых ${fresh}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[overlay] char sync failed:', err instanceof Error ? err : msg);
    statEvent('charSync:failed', msg);
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

/** №101: буфер похож на скопированный предмет (RU/EN игровой формат всегда
 *  начинается с «Класс предмета: …» / «Item Class: …» и содержит «Редкость:» /
 *  «Rarity:»). Используется и прайсом, и импортом — для понятных подсказок. */
function looksLikeItemText(raw: string): boolean {
  return /^\s*(Item Class|Класс предмета|Rarity|Редкость)\s*:/im.test(raw);
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

  // №101(c): в буфере текст предмета, а не PoB-код — понятная подсказка вместо
  // крипто-диагностики base64 (живые факты 30.09–01.10: «невалидный base64 …
  // контекст "Класспредмет"» ×6 за сессию; друг — не-программист).
  if (looksLikeItemText(input)) {
    console.log('[overlay] build import skip: в буфере текст предмета, не PoB-код (№101)');
    statEvent('buildImport:rejected:isItem', `${input.length} chars`);
    sendBuildUpdate({
      error:
        'В буфере текст предмета, а не PoB-код. Прайс этого предмета — Ctrl+F1. Для импорта билда скопируйте PoB share-код (в Path of Building: «Export» → копировать код).',
    });
    return;
  }

  // №101(c+): произвольный текст (не base64-алфавит, не JSON, не линк, не предмет)
  // — мгновенный понятный отказ вместо крипто-диагностики base64. Живой факт
  // 01.10 00:51–00:53: «Main Skills…» (PoB-скрин) и «ВКЛАД В БИБЛИОТЕКУ…»
  // (123 932 симв.) дали buildImport:failed ×7 с «U+412, контекст "ВКЛАДВБИБЛИО"».
  // JSON (.build) начинается с { или [ — исключаем, чтобы не сломать его импорт.
  if (!/^[{\[]/.test(input) && !/^[A-Za-z0-9+/=\s._-]+$/.test(input)) {
    console.log('[overlay] build import skip: буфер — не PoB-код, быстрый отказ (№101c+)');
    statEvent('buildImport:rejected:notCode', `${input.length} chars`);
    sendBuildUpdate({
      error:
        'В буфере нет PoB-кода билда. В Path of Building откройте билд → «Export» → скопируйте share-код (это одна длинная строка из букв и цифр без пробелов), затем Ctrl+F3.',
    });
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
    statEvent('buildImport:ok', `class=${buildState.className ?? '?'} slots=${buildState.slots.length}`);

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
        statEvent('buildPrice:failed', `slot=${slot.slot} ${err instanceof Error ? err.message : String(err)}`);
      }
      sendBuildUpdate({ status: 'ready' });
    }
    saveBuildState();
    sendBuildUpdate({ status: 'ready' });
    console.log('[overlay] build pricing done');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[overlay] build import failed:', msg);
    statEvent('buildImport:failed', msg);
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
    statEvent('starterImport', starter.className);
    void refreshBuildEstimate();

    // №98: прайсинг синтетических white-баз стартера отключён. Медиана белой базы
    // не несёт ценности для SSF, а каждый priceCheck стоил до 45с таймаута
    // (лог-факт 30.09: «starter price failed ... timeout after 45000ms» ×20+,
    // каждый клик класса перезапускал цикл с нуля).
    // Слоты остаются status='todo' — цену реального предмета покажет Ctrl+F1.
    console.log('[overlay] starter build pricing: пропущен (white-базы, №98)');
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
      // №131: разбивка для DPS-блока (физ/элем/скорость атаки)
      weaponPhysDps: est.weapon ? Math.round(est.weapon.physDps) : null,
      weaponElemDps: est.weapon ? Math.round(est.weapon.elementalDps) : null,
      weaponAps: est.weapon ? Math.round(est.weapon.attacksPerSecond * 100) / 100 : null,
      notes: est.notes.slice(0, 2),
      // №108: резисты гира — для панели квестов («молния < 75% → Spires of Deshar»).
      resists: {
        fire: Math.round(est.defenses.fireRes),
        cold: Math.round(est.defenses.coldRes),
        lightning: Math.round(est.defenses.lightningRes),
        chaos: Math.round(est.defenses.chaosRes),
      },
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
  // №113e-b: прежде здесь ВСЕ keystrokes гасились безусловно (preventDefault)
  // — из-за этого текст не вводился НИКОГДА, даже с отданным фокусом.
  // Гасим только пока клавиатуру не захватило поле ввода (keyboard:set):
  // во всех прочих режимах клавиши не доходят до рендерера (как раньше).
  overlayWindow.webContents.on('before-input-event', (event) => {
    if (!keyboardCaptured) event.preventDefault();
  });

  // №113e-b: клик из оверлея в игру — OS-фокус уходит, DOM-focusout поля
  // при этом НЕ гарантирован. Возвращаем focusable=false по blur окна,
  // чтобы «застрявший» focusable не ловил клавиатуру после клика в игру.
  overlayWindow.on('blur', () => {
    if (moveUnlocked) return; // move-режим управляет фокусом сам
    if (!keyboardCaptured) return;
    keyboardCaptured = false;
    overlayWindow?.setFocusable(false);
    console.log('[overlay] keyboard: blur окна → возвращена игре');
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

  // №110: руна/soul core — помимо цены возвращаем эффект аугмента (тир/вид).
  // Источник — core.runes (base_items.json): там только тиры lesser/regular/
  // greater/perfect и вид rune/soul core; заявлений об одномом вставке НЕТ —
  // предупреждение «вставляется навсегда» НЕ добавляем (не выдумываем).
  let parsedAugment: ReturnType<typeof core.parse.parseItemText> | null = null;
  try {
    parsedAugment = core.parse.parseItemText(itemText);
  } catch {
    parsedAugment = null;
  }

  // Русский клиент: trade2/poe2scout принимают только английские имена/базы.
  // Моды остаются ru — их trade2 по базе статов не сопоставит, сработает fallback «по базовому типу».
  let nameOverride: string | undefined;
  let baseTypeOverride: string | undefined;
  // №138-quad (живой лог 01.10 06:37, noPrice ×9): «Неогранённый камень духа
  // (уровень 14)» не прайсился, потому что: (а) суффикс «(уровень N)» ломал
  // lookup статик-словаря (ключ без суффикса) → RU-база уходила в trade2 без
  // перевода; (б) trade2 ищет uncut-камни ТОЛЬКО типом с уровнем —
  // «Uncut Spirit Gem (Level N)» (проверено: /api/trade2/data/items, категория
  // gem; тип без «(Level N)» и name-поиск = 400 Unknown item). RU→ENkind
  // (духа/умения/поддержки) ✅ poe2db.tw/ru/<Slug>, см. RU_EN_STATIC_BASES.
  const uncutRu = parsedAugment?.baseType?.match(
    /^неогран[её]нный\s+камень\s+(духа|умения|поддержки)\s*\(уровень\s*(\d+)\)\s*$/i,
  );
  if (uncutRu) {
    const kindRu = uncutRu[1]!.toLowerCase();
    const kind = kindRu === 'духа' ? 'Spirit' : kindRu === 'умения' ? 'Skill' : 'Support';
    baseTypeOverride = `Uncut ${kind} Gem (Level ${uncutRu[2]})`;
    nameOverride = undefined;
    console.log(`[overlay] ru→en: uncut → ${baseTypeOverride}`);
  } else if (/[а-яё]/i.test(itemText) && parsedAugment) {
    try {
      const parsed0 = parsedAugment;
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

  // №110: матчинг с аугментами core.runes — по эффективному EN-имени/базе.
  let augmentInfo: Record<string, unknown> | null = null;
  if (parsedAugment) {
    const effName = (nameOverride ?? parsedAugment.name ?? '').trim().toLowerCase();
    const effBase = (baseTypeOverride ?? parsedAugment.baseType ?? '').trim().toLowerCase();
    try {
      const aug = core.runes
        .getAugments()
        .find((a) => a.name.toLowerCase() === effName || a.name.toLowerCase() === effBase);
      if (aug) {
        const tierRu: Record<string, string> = {
          lesser: 'малый',
          regular: 'обычный',
          greater: 'великий',
          perfect: 'совершенный',
        };
        augmentInfo = {
          name: aug.name,
          tier: aug.tier,
          tierRu: tierRu[aug.tier] ?? aug.tier,
          kindRu: aug.kind === 'soul core' ? 'ядро души' : 'руна',
        };
      }
    } catch {
      /* датасет аугментов недоступен — просто без эффекта в строке */
    }
  }

  try {
    const result = await withTimeout(
      core.trade.priceCheck(itemText, { nameOverride, baseTypeOverride }),
      HOTKEY_TIMEOUT_MS,
      'priceCheck',
    );
    if (augmentInfo) {
      (result as unknown as Record<string, unknown>).augment = augmentInfo;
      console.log(`[overlay] augment detected: ${JSON.stringify(augmentInfo)}`);
    }
    const itemName = (result as { itemName?: string } | undefined)?.itemName ?? '?';
    const estimateObj = (result as { estimate?: { median?: number } | null } | undefined)?.estimate ?? null;
    const listingsCount = (result as { listings?: unknown[] } | undefined)?.listings?.length ?? 0;
    console.log(
      `[overlay] price done: item="${itemName}" estimate=${JSON.stringify(estimateObj)} listings=${listingsCount}`,
    );
    statEvent(
      estimateObj ? 'priceCheck:ok' : 'priceCheck:noPrice',
      `${itemName} median=${estimateObj?.median ?? '—'} listings=${listingsCount}`,
    );
    return { ...(result as unknown as Record<string, unknown>), itemText };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[overlay] priceCheck failed:', err instanceof Error ? err : msg);
    statEvent('priceCheck:failed', msg);
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
      ...(augmentInfo ? { augment: augmentInfo } : {}),
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
    // №98: в буфере ссылка poe.ninja-профиля, а не предмет (лог-факт 30.09:
    // «price done: item="Неизвестный предмет"» ×4 по profile-линку). Роутим
    // в импорт билда — именно этого пользователь и ожидает от ссылки.
    if (/^https?:\/\/(www\.)?poe\.ninja\/poe2\/profile\//i.test(raw.trim())) {
      console.log('[overlay] pricecheck → ссылка poe.ninja-профиля: роутим в импорт билда (№98)');
      return runBuildImport();
    }
    console.log(`[overlay] clipboard: ${raw.length} chars`);
    if (raw.trim()) {
      console.log(`[overlay] clipboard head: ${JSON.stringify(raw.slice(0, 80))}`);
    } else {
      console.warn('[overlay] clipboard is empty — Ctrl+C в игре по наведённому предмету?');
    }

    // №101(b): быстрый отказ на не-предметном буфере — ДО словаря и trade-поиска.
    // Живой лог-факт 01.10 00:23: произвольный текст (PowerShell-вывод, «Проверка
    // статуса…») жёг 10 014 мс ожидания ensureRuEnDict и блокировал Ctrl+F1 busy.
    // Предмет из игры ВСЕГДА содержит «Редкость:»/«Rarity:» («Класс предмета:»),
    // PoB-код — base64-алфавит (для него ниже отдельная подсказка №98/101).
    if (raw.trim() && !looksLikeItemText(raw) && !/^[A-Za-z0-9+/=\s._-]+$/.test(raw.trim())) {
      const startedFast = Date.now();
      console.log('[overlay] pricecheck: буфер — не предмет и не PoB-код, быстрый отказ (№101)');
      statEvent('priceCheck:rejected:nonItem', `${raw.trim().length} chars`);
      const fastPayload = {
        items: [
          {
            itemName: 'Не предмет',
            estimate: null,
            listings: 0,
            buildCodeHint:
              'В буфере не текст предмета. Наведите на предмет в игре и нажмите Ctrl+C, затем Ctrl+F1 (прайс). PoB-код билда — Ctrl+F3 (импорт).',
          },
        ],
        count: 1,
        totalEstimate: null,
        elapsedMs: Date.now() - startedFast,
      };
      await overlayWindow?.webContents.send('price:batch', fastPayload);
      console.log(
        `[overlay] price batch: items=1 totalEstimate=null elapsedMs=${fastPayload.elapsedMs}`,
      );
      return fastPayload;
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

/**
 * №103: персистентный прогресс кампании — самая дальняя достигнутая зона.
 * Хвост Client.txt (~1 МБ) не покрывает весь плей-фаб; файл переживает рестарты.
 * №140 (живая жалоба: «Прокачка не понимает, что пройдено»): прогресс
 * ПРИВЯЗАН К ЛИГЕ — смена лиги = авто-сброс (старое и новое — разные ладдеры,
 * по-другому честные статусы «пройдено» для нового персонажа не построить:
 * PoE2 не пишет level_up в лог (№20), а area_change не называет персонажа).
 * Плюс накапливаем visitedCodes (КДОЫ зон) — переживают ротацию LatestClient.
 */
interface LevelingProgressFile {
  /** №140: лига-владелец прогресса; отсутствие = старый формат (v1) → сброс. */
  league?: string;
  act: number;
  index: number;
  /** ISO-метка времени записи. */
  ts: string;
  /** №140: накопленные коды посещённых зон кампании (союз persisted + окна лога). */
  visitedCodes?: string[];
  /** №108: ключи квест-наград, отмеченных «забрал» (core.questRewards key). */
  claimedRewards?: string[];
  /** №140: причина последнего сброса — показать юзеру один раз. */
  resetNote?: string;
}
// ─── №143: таймер боссов ─────────────────────────────────────────────────────
/** Одна попытка босса: вход в зону (по логу) → нажатие «Убит»/«Смерть». */
interface BossAttempt {
  zoneCode: string;
  /** «kill» = победа, «death» = провал (в best не идёт). */
  kind: 'kill' | 'death';
  /** Прошло от входа в зону до кнопки, мс. */
  ms: number;
  /** ISO-время записи. */
  ts: string;
}
interface BossTimesFile {
  /** №140-правило: ключ персиста = лига. */
  league?: string;
  attempts: BossAttempt[];
}
function bossTimesPath(): string {
  return path.join(app.getPath('userData'), 'boss-times.json');
}
function readBossTimes(): BossTimesFile {
  try {
    const p = JSON.parse(fs.readFileSync(bossTimesPath(), 'utf8')) as BossTimesFile;
    if (Array.isArray(p.attempts)) return p;
  } catch {
    /* нет файла — норма */
  }
  return { league: activeLeague ?? undefined, attempts: [] };
}
/** Записать попытку. Смена лиги = обнуление истории (время в другой лиге несравнимо). */
function appendBossAttempt(zoneCode: string, kind: 'kill' | 'death', ms: number): BossTimesFile {
  const cur = activeLeague ?? undefined;
  let file = readBossTimes();
  if (!cur || file.league !== cur) {
    if (file.attempts.length) console.log(`[overlay] boss:timer: история сброшена (лига ${file.league ?? '?'} → ${cur ?? '?'})`);
    file = { league: cur, attempts: [] };
  }
  file.attempts.push({ zoneCode, kind, ms, ts: new Date().toISOString() });
  // Верхний предел истории: 200 последних попыток (файл не растёт бесконечно).
  if (file.attempts.length > 200) file.attempts = file.attempts.slice(-200);
  try {
    fs.writeFileSync(bossTimesPath(), JSON.stringify(file, null, 2));
  } catch (e) {
    console.log(`[overlay] boss-times.json не записан: ${e instanceof Error ? e.message : e}`);
  }
  return file;
}
/** Статистика по зоне: победы/провалы/лучшее/последнее время (мс). */
function bossZoneStats(zoneCode: string): { kills: number; deaths: number; best: number | null; last: number | null } {
  const kills: BossAttempt[] = readBossTimes().attempts.filter((a) => a.zoneCode === zoneCode && a.kind === 'kill');
  const deaths = readBossTimes().attempts.filter((a) => a.zoneCode === zoneCode && a.kind === 'death').length;
  return {
    kills: kills.length,
    deaths,
    best: kills.length ? Math.min(...kills.map((k) => k.ms)) : null,
    last: kills.length ? kills[kills.length - 1]!.ms : null,
  };
}
function readLevelingProgressFile(): LevelingProgressFile | null {
  try {
    const raw = fs.readFileSync(path.join(app.getPath('userData'), 'leveling-progress.json'), 'utf8');
    const p = JSON.parse(raw) as LevelingProgressFile;
    if (typeof p.act === 'number' && typeof p.index === 'number') return p;
    return null;
  } catch {
    return null;
  }
}
/** №140: прямая запись (без merge) — только для сбросов прогресса. */
function writeLevelingProgressReset(p: LevelingProgressFile): void {
  try {
    fs.writeFileSync(
      path.join(app.getPath('userData'), 'leveling-progress.json'),
      JSON.stringify({ ...p, visitedCodes: p.visitedCodes ?? [], claimedRewards: p.claimedRewards ?? [] }, null, 2),
    );
  } catch (e) {
    console.log(`[overlay] leveling-progress.json не записан: ${e instanceof Error ? e.message : e}`);
  }
}
function levelingProgressForLeague(): LevelingProgressFile | null {
  const p = readLevelingProgressFile();
  if (!p) return null;
  const cur = activeLeague ?? undefined;
  if (!cur || p.league === cur) return p;
  const reason = p.league == null
    ? 'файл старого формата (без лиги) — прогресс пересоберётся по логу'
    : `лига сменилась (${p.league} → ${cur})`;
  const fresh: LevelingProgressFile = {
    league: cur,
    act: 1,
    index: -1,
    ts: new Date().toISOString(),
    visitedCodes: [],
    claimedRewards: [],
    resetNote: reason,
  };
  writeLevelingProgressReset(fresh);
  console.log(`[overlay] leveling: прогресс сброшен — ${reason}`);
  return fresh;
}
function writeLevelingProgress(p: LevelingProgressFile): void {
  try {
    // №108: claimedRewards переживают запись furthest (merge с файлом).
    let prev: LevelingProgressFile | null = null;
    try {
      prev = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'leveling-progress.json'), 'utf8')) as LevelingProgressFile;
    } catch {
      prev = null;
    }
    const prevSameLeague = prev && p.league && prev.league === p.league ? prev : null;
    const merged: LevelingProgressFile = {
      ...p,
      visitedCodes: Array.from(new Set([...(p.visitedCodes ?? []), ...(prevSameLeague?.visitedCodes ?? [])])),
      claimedRewards: prevSameLeague
        ? Array.from(new Set([...(p.claimedRewards ?? []), ...(prevSameLeague.claimedRewards ?? [])]))
        : (p.claimedRewards ?? []),
    };
    fs.writeFileSync(path.join(app.getPath('userData'), 'leveling-progress.json'), JSON.stringify(merged, null, 2));
  } catch (e) {
    console.log(`[overlay] leveling-progress.json не записан: ${e instanceof Error ? e.message : e}`);
  }
}

/** №108: прочитанные «забрал»-ключи квест-наград. */
function readClaimedRewards(): string[] {
  try {
    const raw = fs.readFileSync(path.join(app.getPath('userData'), 'leveling-progress.json'), 'utf8');
    const p = JSON.parse(raw) as LevelingProgressFile;
    return Array.isArray(p.claimedRewards) ? p.claimedRewards.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/** №108: отметить квест-награду «забрал» (исчезает из чек-листа навсегда). */
function claimQuestReward(key: string): boolean {
  if (typeof key !== 'string' || !key.includes('|')) return false;
  // №140: пишем поверх файла ТЕКУЩЕЙ лиги — иначе merge затёр бы league/visitedCodes.
  const prog = levelingProgressForLeague();
  if (prog == null) return false;
  const claimed = Array.from(new Set([...(prog.claimedRewards ?? []), key]));
  writeLevelingProgress({
    league: prog.league,
    act: prog.act,
    index: prog.index,
    ts: new Date().toISOString(),
    visitedCodes: prog.visitedCodes ?? [],
    claimedRewards: claimed,
  });
  return true;
}

/**
 * №111 «Чекап перед пиннаклом» (Ctrl+F7): core.optimize.pinnacleChecklist
 * поверх текущего build state (гир-слоты → estimateBuild). Проверки, для
 * которых данных нет, приходят verdict='unknown' — рендерер честно показывает
 * частичность; в лог пишем N/M доступных проверок.
 */
async function runPinnacleCheck(): Promise<unknown> {
  if (busy) {
    console.warn('[overlay] pinnacle check skipped: busy=true');
    return null;
  }
  const payload = (() => {
    if (!buildState || !buildState.slots.length) {
      return { available: false, error: 'Билд не импортирован — сначала Ctrl+F3 (импорт PoB-кода).' };
    }
    return null;
  })();
  if (payload) {
    await overlayWindow?.webContents.send('pinnacle:result', payload);
    return payload;
  }
  busy = true;
  try {
    // №130-ф1: rawInput (исходный PoB-код/XML), а НЕ слоты: estimateBuild из строки
    // наполняет pobStats (PlayerStat: FireResist/ColdResist/… — резисты с ДЕРЕВА
    // и гира сразу), из массива слотов pobStats пуст и чек-лист ложно краснеет.
    const est = await withTimeout(
      core.estimate.estimateBuild(buildState!.rawInput),
      30_000,
      'estimateBuild',
    );
    const res = core.optimize.pinnacleChecklist(est, {
      enemyLevel: buildState?.level != null && buildState.level > 84 ? buildState.level : undefined,
    });
    const total = res.checks.length;
    const avail = res.checks.filter((c) => c.verdict !== 'unknown').length;
    console.log(`[overlay] pinnacle checklist: ${avail}/${total} проверок доступно`);
    statEvent('pinnacleCheck', `${avail}/${total} ok`);
    const out = {
      available: true,
      checks: res.checks,
      enemy: res.enemy,
      availableChecks: avail,
      totalChecks: total,
    };
    await overlayWindow?.webContents.send('pinnacle:result', out);
    return out;
  } catch (err) {
    console.warn('[overlay] pinnacle check failed:', err instanceof Error ? err.message : err);
    const out = { available: false, error: `Не удалось посчитать чек-лист: ${err instanceof Error ? err.message : String(err)}` };
    await overlayWindow?.webContents.send('pinnacle:result', out);
    return out;
  } finally {
    busy = false;
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

    // №103 Campaign Companion: полный маршрут акта со статусами зон.
    // №140: персист ПРИВЯЗАН к лиге (levelingProgressForLeague — авто-сброс при
    // смене), visitedCodes = persisted ∪ окно лога — ротация LatestClient не
    // вымывает пройденные зоны, furthest растёт только вперёд.
    const prog = levelingProgressForLeague();
    const resetNote = prog?.resetNote ?? null;
    const persistedCodes = prog?.visitedCodes ?? [];
    const furthest = prog ? { act: prog.act, index: prog.index } : null;
    const windowCodes = state.zoneVisits.map((v) => v.areaCode).filter(Boolean) as string[];
    const visitedCodes = Array.from(new Set([...persistedCodes, ...windowCodes]));
    const camp = core.zoneNotes.buildCampaignPlan(state.available ? state : null, {
      visitedCodes,
      furthest,
    });
    if (camp.currentIndex >= 0 && (furthest == null || camp.act > furthest.act || (camp.act === furthest.act && camp.currentIndex > furthest.index))) {
      writeLevelingProgress({
        league: activeLeague ?? undefined,
        act: camp.act,
        index: camp.currentIndex,
        ts: new Date().toISOString(),
        visitedCodes,
        claimedRewards: readClaimedRewards(),
      });
    } else if (windowCodes.some((c) => !persistedCodes.includes(c))) {
      // №140: новых зон нет в персисте — дополняем (без resetNote: заметка
      // о сбросе живёт ровно до первого нового визита зоны).
      writeLevelingProgress({
        league: activeLeague ?? undefined,
        act: prog?.act ?? camp.act,
        index: prog?.index ?? camp.currentIndex,
        ts: new Date().toISOString(),
        visitedCodes,
        claimedRewards: readClaimedRewards(),
      });
    }

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
      camp, // №103: { act, actName, actNote, level, currentIndex, rows[], done, total }
      // №140: что знает оверлей о прогрессе — лига + причина недавнего сброса.
      progress: {
        league: activeLeague ?? null,
        resetNote,
        zonesSeen: visitedCodes.length,
      },
      // №104: бестиарий боссов (те же данные, что в core.bosses)
      bosses: {
        story: core.bosses.CAMPAIGN_BOSSES,
        trials: core.bosses.ASC_TRIAL_BOSSES,
        sekhemas: core.bosses.SEKHEMAS_BOSSES,
        pinnacle: core.bosses.PINNACLE_BOSSES,
      },
      // №143: таймер босса текущей зоны — стартуем от последнего входа в зону
      // (Client.txt пишет area-строку с timestamp; смерть босса лог НЕ пишет —
      // фиксация вручную кнопкой, старт всегда честный по логу).
      bossTimer: (() => {
        const visit = state.available ? state.zone : null;
        const code = visit?.areaCode;
        if (!code) return null;
        const bs = core.bosses.bossesByZone(code);
        if (!bs.length) return null;
        const startedAtRaw = Date.parse(visit.timestamp);
        return {
          zoneCode: code,
          bossNames: bs.map((b) => b.name),
          startedAt: Number.isFinite(startedAtRaw) ? startedAtRaw : null,
          stats: bossZoneStats(code),
        };
      })(),
      // №108: неполученные важные квесты текущего и прошлых актов
      quests: {
        list: core.questRewards.unclaimedQuests({
          act: camp.act,
          furthest,
          visitedCodes,
          claimed: readClaimedRewards(),
        }),
        // Резисты из build state (гир-оценка core.estimate): только если реально
        // посчитаны — для подсветки «резист < 75% → квест». Иначе null.
        resists: buildState?.summary?.resists ?? null,
        coverage: core.questRewards.QUEST_REWARDS_COVERAGE_RU,
      },
      // №112-lite: обзор эндгейм-механик атласа + этажность Sekhemas по уровню.
      endgame: {
        overview: core.endgame.mechanicsOverview(),
        waystoneTips: core.endgame.waystoneTips(),
        sekhemasFloors:
          buildState?.level != null
            ? core.endgame.sekhemasFloorsForLevel(buildState.level)
            : camp.level != null
              ? core.endgame.sekhemasFloorsForLevel(camp.level)
              : null,
      },
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
      keyboardCaptured = false; // №113e-c
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
  // №111: чекап перед пиннаклом (Ctrl+F7) — core.optimize.pinnacleChecklist.
  const okP = globalShortcut.register(hotkeyFor('pinnacle'), () => {
    console.log('[overlay] hotkey fired: чекап перед пиннаклом');
    void runPinnacleCheck();
  });
  console.log(`[overlay] hotkey ${hotkeyFor('price')} registered=${ok}`);
  console.log(`[overlay] hotkey ${hotkeyFor('leveling')} registered=${okL}`);
  console.log(`[overlay] hotkey ${hotkeyFor('move')} registered=${okM}`);
  console.log('[overlay] hotkey Control+Shift+F5 registered=' + okR);
  console.log(`[overlay] hotkey ${hotkeyFor('buildImport')} registered=${okBI}`);
  console.log(`[overlay] hotkey ${hotkeyFor('buildPanel')} registered=${okBP}`);
  console.log(`[overlay] hotkey ${hotkeyFor('settings')} registered=${okS}`);
  console.log(`[overlay] hotkey ${hotkeyFor('pinnacle')} registered=${okP}`);
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
  L.push('uptime процесса: ' + Math.round(process.uptime()) + ' с');
  L.push('память процесса (RSS): ' + Math.round(process.memoryUsage().rss / 1024 ** 2) + ' МБ');
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
  // №100: счётчики событий сессии — вместо гадания по хвосту лога видно суммы:
  // сколько прайс-чеков ок/фэйл, импорты, charSync, стартеры, клики асценданси.
  L.push('-- События сессии (счётчики, №100) --');
  const stats = sessionStatsDigest();
  for (const s of stats) L.push(s);
  if (!stats.length) L.push('(пока пусто — событий не было)');
  L.push('');
  L.push('-- Хвост overlay.log (последние 400 строк) --');
  L.push(tailLines(path.join(userData, 'overlay.log'), 400) || '(лог пуст)');
  return L.join('\n');
}

/** Последняя распечатанная сигнатура «starter ascendancy» — для дедупа лога (№100). */
let ascPickLogSig: string | null = null;

function setupIPC(): void {
  ipcMain.handle('price:check', () => runPriceCheck());

  ipcMain.handle('level:check', () => runLevelingContext());
  // №143: фиксация попытки босса. Время = Date.now() − ts входа в зону по
  // ЖИВОМУ логу на момент клика (не по возрасту payload). Лог не пишет смерть
  // босса → «Убит»/«Смерть» жмёт друг мышью, это часть дизайна.
  ipcMain.handle('boss:timerdone', (_e, zoneCode: unknown, kind: unknown) => {
    if (typeof zoneCode !== 'string' || (kind !== 'kill' && kind !== 'death')) {
      return { ok: false, error: 'Неверный вызов таймера' };
    }
    const bs = core.bosses.bossesByZone(zoneCode);
    if (!bs.length) return { ok: false, error: 'Это не боссовская зона' };
    const override = gameLogOverride();
    const live = core.log.getClientState(override ? { logPath: override } : {});
    const visit = live.available ? live.zone : null;
    if (!visit || visit.areaCode !== zoneCode) {
      return { ok: false, error: 'Ты уже не в зоне босса — время не зафиксировать' };
    }
    const start = Date.parse(visit.timestamp);
    if (!Number.isFinite(start)) return { ok: false, error: 'Лог не дал время входа в зону' };
    const ms = Date.now() - start;
    // sanity: от нуля до 6 часов
    if (ms < 0 || ms > 6 * 3600 * 1000) return { ok: false, error: 'Подозрительное время попытки' };
    appendBossAttempt(zoneCode, kind as 'kill' | 'death', ms);
    console.log(
      `[overlay] boss:timer: ${bs.map((b) => b.name).join(' + ')} — ${kind === 'kill' ? 'убит' : 'смерть'} за ${Math.floor(ms / 1000)} с`,
    );
    return { ok: true, ms, stats: bossZoneStats(zoneCode) };
  });

  // №140: ручной сброс прогресса прокачки — новый персонаж в той же лиге.
  ipcMain.handle('level:reset', () => {
    const fresh: LevelingProgressFile = {
      league: activeLeague ?? undefined,
      act: 1,
      index: -1,
      ts: new Date().toISOString(),
      visitedCodes: [],
      claimedRewards: [],
      resetNote: 'ручной сброс (новый персонаж)',
    };
    writeLevelingProgressReset(fresh);
    console.log('[overlay] leveling: прогресс сброшен вручную');
    return runLevelingContext();
  });

  // №108: «забрал» квест-награду — персист в leveling-progress.json claimedRewards,
  // после — пересобрать панель прокачки (квест исчезает из чек-листа).
  ipcMain.handle('level:claim', (_evt, key: unknown) => {
    const k = typeof key === 'string' ? key : '';
    const claimed = claimQuestReward(k);
    console.log(`[overlay] quest claim: ${JSON.stringify(k)} → ${claimed ? 'записан' : 'НЕ записан (нет прогресс-файла?)'}`);
    statEvent('questClaim', claimed ? k : 'invalid');
    if (claimed) void runLevelingContext();
    return { ok: claimed };
  });

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
    hiddenTabs: [...(settings.hiddenTabs ?? [])],
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
    // №100: дедуп лога — рендерер шлёт pick_asc несколько раз на клик, а ранее
    // каждый повтор печатал весь список кейстоунов (лог тонул в дублях ×3–×12).
    const ks = (buildState.starter.ascKeystones ?? []).join(', ');
    const sig = `${asc.id}:${ks}`;
    if (ascPickLogSig !== sig) {
      ascPickLogSig = sig;
      console.log(`[overlay] starter ascendancy: ${asc.name} (${asc.id}) — keystones: ${ks || 'нет'}`);
    }
    statEvent('starterAscendancy:pick', asc.name);
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
      // №111: тот же чек-лист по клику таба, что и по Ctrl+F7.
      case 'pinnacle':
        console.log('[overlay] tab: чекап перед пиннаклом (Ctrl+F7)');
        void runPinnacleCheck();
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

  // ─── №134: окно «⚒ Крафт» — каталог и персональный план ────────────────────
  // Каталог рецептов 0.5.5 — единый источник правды poe2-kit/core
  // (CRAFT_RECIPES/CRAFT_ESSENCES/CRAFT_OMENS, docs/crafting_knowledge_base.md).
  // Рендерер кэширует ответ: каталог статичен между патчами игры.
  ipcMain.handle('craft:catalog', () => {
    try {
      return {
        ok: true,
        recipes: core.craft.CRAFT_RECIPES,
        essences: core.craft.CRAFT_ESSENCES,
        specEssences: core.craft.CRAFT_SPEC_ESSENCES,
        alloys: core.craft.CRAFT_ALLOYS,
        perfectHint: core.craft.CRAFT_PERFECT_ESSENCES_HINT,
        omens: core.craft.CRAFT_OMENS,
      };
    } catch (err) {
      console.warn('[overlay] craft:catalog failed:', (err as Error).message);
      return { ok: false, error: 'Каталог крафта недоступен (см. overlay.log).' };
    }
  });
  // Персональный план по предмету из буфера: Ctrl+C по предмету в игре →
  // кнопка в табе «Крафт» → craftPlan (методология «двух якорей», №126/№130).
  ipcMain.handle('craft:plan', () => {
    const text = clipboard.readText().trim();
    if (!looksLikeItemText(text)) {
      return {
        ok: false,
        error: 'В буфере нет предмета. Наведи на предмет в игре → Ctrl+C → нажми кнопку «План по предмету».',
      };
    }
    try {
      const parsed = core.parse.parseItemText(text);
      const name = core.parse.itemDisplayName(parsed) || parsed.baseType || 'предмет';
      const plan = core.craft.craftPlan({
        itemClass: parsed.itemClass,
        baseType: parsed.baseType,
        itemLevel: parsed.itemLevel,
        rarity: parsed.rarity,
        parsed,
      });
      const essences = core.craft.essenceSuggestions(parsed.itemClass, parsed.baseType);
      console.log(
        `[overlay] craft:plan: "${name}" (${parsed.itemClass}, ilvl=${parsed.itemLevel ?? '?'}) — ${plan.length} шагов`,
      );
      return { ok: true, name, itemClass: parsed.itemClass, ilvl: parsed.itemLevel, plan, essences };
    } catch (err) {
      console.warn('[overlay] craft:plan failed:', (err as Error).message);
      return { ok: false, error: `Не удалось разобрать предмет: ${(err as Error).message}` };
    }
  });

  // ─── №135: курсы валют по лигам (💰 → «💱 Курс») ───────────────────────────
  // core.trade.fetchBestCurrencyRates/fetchLeagues/fetchCurrencyHistory — те же
  // источники, что в MCP-тулах poe2_currency_* (poe2scout + poe.ninja, общие
  // кэши ядра). Кэш ответа в main 10 мин/лига — чипсы лиг не спамят API.
  const currencyRatesCache = new Map<string, { at: number; payload: unknown }>();
  const CURRENCY_TTL_MS = 10 * 60 * 1000;
  // №138-ter: RU-имя валюты из готового ru→en-словаря poe2db (обратный поиск).
  // Ключи ruEnBases — normName(RU), поэтому для показа поднимаем регистр слов.
  // Словарь может грузиться в фоне — нет RU, значит показываем только EN.
  let enRuReverse: Map<string, string> | null = null;
  let enRuReverseSize = -1;
  function ruNameForCurrency(en: string): string | undefined {
    if (!ruEnBases.size) return undefined;
    if (!enRuReverse || enRuReverse.size !== ruEnBases.size) {
      enRuReverse = new Map();
      enRuReverseSize = ruEnBases.size;
      for (const [ru, v] of ruEnBases) enRuReverse.set(normName(v), ru);
    }
    const ru = enRuReverse.get(normName(en));
    if (!ru) return undefined;
    return ru[0].toUpperCase() + ru.slice(1); // нормализованный ключ → «Сфера хаоса»
  }
  ipcMain.handle('currency:rates', async (_evt, league?: string) => {
    try {
      const leagues = await core.trade.fetchLeagues();
      if (!leagues.length) return { ok: false, error: 'Список лиг недоступен (сеть?).' };
      const wanted = String(league ?? '').trim();
      const found = wanted
        ? leagues.find((l) => l.name.toLowerCase() === wanted.toLowerCase() || l.id?.toLowerCase() === wanted.toLowerCase())
        : undefined;
      const L = (found ?? leagues.find((l) => l.isCurrent) ?? leagues[0]).name;
      const cached = currencyRatesCache.get(L);
      if (cached && Date.now() - cached.at < CURRENCY_TTL_MS) {
        return { ok: true, ...(cached.payload as object), cached: true };
      }
      core.trade.setLeague(L);
      const [rates, hist] = await Promise.all([
        core.trade.fetchBestCurrencyRates(L),
        core.trade.fetchCurrencyHistory(L).catch(() => []),
      ]);
      const trend = new Map<string, number | null>();
      for (const h of hist) if (h.totalChange != null) trend.set(h.name.toLowerCase(), h.totalChange);
      const rows = rates
        .filter((r) => r.chaosValue != null)
        .sort((a, b) => (b.chaosValue ?? 0) - (a.chaosValue ?? 0))
        .map((r) => ({
          name: r.name,
          ru: ruNameForCurrency(r.name), // №138-ter: RU-имя из словаря poe2db
          chaos: r.chaosValue as number,
          divine: r.divineValue,
          trend: trend.get(r.name.toLowerCase()) ?? null,
          source: r.source,
        }));
      const payload = {
        league: L,
        leagues: leagues.map((l) => ({ name: l.name, isCurrent: !!l.isCurrent })),
        rates: rows,
        updatedAt: Date.now(),
      };
      currencyRatesCache.set(L, { at: Date.now(), payload });
      console.log(`[overlay] currency:rates: ${L} — ${rows.length} валют (кэш 10 мин)`);
      return { ok: true, ...payload };
    } catch (err) {
      console.warn('[overlay] currency:rates failed:', (err as Error).message);
      return { ok: false, error: `Не удалось получить курсы: ${(err as Error).message}` };
    }
  });

  // ─── №136: генератор билдов по ладдеру poe.ninja (→ «🧬 Билды») ───────────
  // Один запрос searchLadderBuilds(slug) → группировка по классам в main:
  // скиллы/ключевые узлы по частоте, медианные DPS/EHP, топ-3 примера.
  // Это честный «генератор»: каждый совет = живой билд топ-игрока.
  const buildgenCache = new Map<string, { at: number; payload: unknown }>();
  const BUILDGEN_TTL_MS = 30 * 60 * 1000;
  ipcMain.handle('buildgen:meta', async (_evt, leagueSlug?: string) => {
    try {
      const all = await core.ladder.listLadderLeagues();
      const slugs = (all || []).filter((s) => !/^pl\d+$/i.test(String(s)));
      const wanted = String(leagueSlug ?? '').trim();
      const slug = wanted && slugs.includes(wanted) ? wanted : (slugs[0] ?? (wanted || 'standard'));
      const cached = buildgenCache.get(slug);
      if (cached && Date.now() - cached.at < BUILDGEN_TTL_MS) {
        return { ok: true, ...(cached.payload as object), cached: true };
      }
      const res = await core.ladder.searchLadderBuilds(slug, { sort: 'level' });
      if (!res || !res.rows.length) {
        return { ok: false, error: 'Лэддер poe.ninja недоступен (сеть?).' };
      }
      const byClass = new Map<string, {
        count: number; dps: number[]; ehp: number[];
        skills: Map<string, number>; passives: Map<string, number>;
        top: Array<{ name: unknown; level: unknown; ehp: string; dps: string; skills: string[] }>;
      }>();
      for (const r of res.rows) {
        const label = String(r.classLabel ?? r.class ?? '—').trim() || '—';
        let c = byClass.get(label);
        if (!c) { c = { count: 0, dps: [], ehp: [], skills: new Map(), passives: new Map(), top: [] }; byClass.set(label, c); }
        c.count++;
        const dps = core.ladder.parseNinjaNumber(r['dps.total']);
        const ehpNum = core.ladder.parseNinjaNumber(r['ehp__str'] ?? r.ehp);
        if (dps != null) c.dps.push(dps);
        if (ehpNum != null) c.ehp.push(ehpNum);
        const skills = Array.isArray(r.skills) ? (r.skills as unknown[]).filter((s) => typeof s === 'string') as string[] : [];
        for (const s of skills) c.skills.set(s, (c.skills.get(s) ?? 0) + 1);
        const kps = Array.isArray(r.keypassives) ? (r.keypassives as unknown[]).filter((s) => typeof s === 'string') as string[] : [];
        for (const p of kps) c.passives.set(p, (c.passives.get(p) ?? 0) + 1);
        const dpsStr = dps != null ? (dps >= 1e6 ? (dps / 1e6).toFixed(1) + 'M' : dps >= 1e3 ? (dps / 1e3).toFixed(0) + 'k' : String(Math.round(dps))) : '—';
        const ehpStr = ehpNum != null ? (ehpNum >= 1e6 ? (ehpNum / 1e6).toFixed(1) + 'M' : ehpNum >= 1e3 ? (ehpNum / 1e3).toFixed(0) + 'k' : String(Math.round(ehpNum))) : String(r['ehp__str'] ?? '—');
        if (c.top.length < 3) c.top.push({ name: r.name ?? '—', level: r.level ?? '—', ehp: ehpStr, dps: dpsStr, skills: skills.slice(0, 5) });
      }
      const med = (arr: number[]): string | null => {
        if (!arr.length) return null;
        const s = [...arr].sort((a, b) => a - b);
        const m = s.length >> 1;
        const v = s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
        return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : String(Math.round(v));
      };
      const topN = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
        .map(([name, count]) => ({ name, count }));
      const classes = [...byClass.entries()]
        .map(([label, c]) => ({
          label, count: c.count,
          medianDps: med(c.dps), medianEhp: med(c.ehp),
          topSkills: topN(c.skills, 6), topPassives: topN(c.passives, 6),
          top: c.top,
        }))
        .sort((a, b) => b.count - a.count);
      const payload = { league: slug, slugs, sample: res.rows.length, classes };
      buildgenCache.set(slug, { at: Date.now(), payload });
      console.log(`[overlay] buildgen:meta: ${slug} — ${res.rows.length} билдов, ${classes.length} классов (кэш 30 мин)`);
      return { ok: true, ...payload };
    } catch (err) {
      console.warn('[overlay] buildgen:meta failed:', (err as Error).message);
      return { ok: false, error: `Генератор недоступен: ${(err as Error).message}` };
    }
  });

  // ─── №139: «🔗 Конструктор связок» — данные гемов из ЛОКАЛЬНЫХ датасетов ────
  // Никакой сети и выдумок: активные (getSkillGems: skillTypes, unlock) и
  // саппорты (getSupportGems: compatible_with) — офлайн-датасет PoE2.
  // RU-имена — верифицированный gemsRuEn (гем ⇄ RU-страница poe2db).
  // №141: IPC-пейлоад ~2000 гемов одним сообщением лагал рендерер
  // (structured-clone всего массива за один тик) — теперь ЧАНКАМИ:
  // {offset,limit} → срез, рендерер тянет последовательными короткими
  // запросами. Вызов без параметра = полный пейлоад (обратная совместимость).
  interface GemdataItem {
    kind: 'active' | 'support';
    en: string;
    ru: string | null;
    types?: string[];
    unlock?: number;
    cost?: unknown | null;
    compat?: string[];
  }
  let gemdataCache: GemdataItem[] | null = null;
  function buildGemdata(): GemdataItem[] {
    if (gemdataCache) return gemdataCache;
    seedGemDictFromDataset(); // гарантия: gemEnRu засеян офлайн-датасетом
    const activesAll = core.dataset.getSkillGems();
    const supportsAll = core.dataset.getSupportGems();
    const actives: GemdataItem[] = activesAll
      .filter((g) => g.name && g.source?.kind === 'UncutSkillGem')
      .map((g) => ({
        kind: 'active' as const,
        en: g.name,
        ru: gemEnRu.get(normName(g.name)) ?? null,
        types: (g.skillTypes ?? []).filter((t: string) => t !== 'Invokable'),
        unlock: g.source?.unlockLevel ?? 0,
        cost: g.firstLevelCost ?? null,
      }));
    const supports: GemdataItem[] = supportsAll
      .filter((s) => s.name && Array.isArray(s.compatible_with))
      .map((s) => ({
        kind: 'support' as const,
        en: s.name,
        ru: gemEnRu.get(normName(s.name)) ?? null,
        compat: s.compatible_with,
      }));
    gemdataCache = [...actives, ...supports];
    console.log(`[overlay] buildgen:gemdata: ${actives.length} активных, ${supports.length} саппортов (офлайн-датасет, чанки по запросу)`);
    return gemdataCache;
  }
  ipcMain.handle('buildgen:gemdata', (_evt, p?: { offset?: number; limit?: number }) => {
    try {
      const items = buildGemdata();
      const nActive = items.reduce((n, x) => (x.kind === 'active' ? n + 1 : n), 0);
      const nSupport = items.length - nActive;
      const off = typeof p?.offset === 'number' && p.offset >= 0 ? p.offset : null;
      if (off == null) {
        // Легаси-вызов без параметров — полный пейлоад (совместимость).
        return { ok: true, actives: items.filter((x) => x.kind === 'active'), supports: items.filter((x) => x.kind === 'support'), nActive, nSupport };
      }
      const limit = typeof p?.limit === 'number' && p.limit > 0 ? Math.min(p.limit, 500) : 400;
      return { ok: true, offset: off, limit, total: items.length, nActive, nSupport, done: off + limit >= items.length, items: items.slice(off, off + limit) };
    } catch (err) {
      console.warn('[overlay] buildgen:gemdata failed:', (err as Error).message);
      return { ok: false, error: `Датасет гемов недоступен: ${(err as Error).message}` };
    }
  });

  // ─── №141: импорт-код для связки из конструктора ───────────────────────────
  // PoB-код = urlsafe(base64(zlib(XML))); энкодер core.pobcode.encodeShareCode.
  // XML секция Skills — формат сверен с живым экспортом PoE2 (char_L48_*.xml):
  // <Skill enabled="true"> + <Gem nameSpec="…" level="N" quality="0" enabled="true"/>.
  // gemId/skillId НЕ пишем: точные значения без живого PoB не вывести
  // (пример из живого XML: nameSpec «Charge Profusion I» ↔ skillId
  // «SupportChargeProfusionPlayer» — алгоритмом не выводится). Оверлейный
  // импорт парсит nameSpec (buildGemSetups: nameSpec ?? skillId); PoB2 тоже
  // резолвит по nameSpec (❓ живая проверка друга в PoB2).
  function xmlEsc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  ipcMain.handle('buildgen:combocode', (_evt, p: { actives?: Array<{ en: string; unlock?: number }>; supports?: Record<string, string[]> }) => {
    try {
      const actives = (p?.actives ?? []).filter((a) => a && typeof a.en === 'string' && a.en);
      if (!actives.length) return { ok: false, error: 'Связка пуста — выбери хотя бы один активный навык.' };
      const supports = p?.supports ?? {};
      const groups = actives.map((a) => {
        const lvl = Math.max(1, Math.min(40, Number(a.unlock) > 0 ? Number(a.unlock) : 1));
        const sups = (supports[a.en] ?? []).filter((s): s is string => typeof s === 'string' && !!s).slice(0, 5);
        const gems = [`<Gem nameSpec="${xmlEsc(a.en)}" level="${lvl}" quality="0" count="1" enabled="true"/>`, ...sups.map((s2) => `<Gem nameSpec="${xmlEsc(s2)}" level="${lvl}" quality="0" count="1" enabled="true"/>`)].join('\n');
        return `<Skill enabled="true" label="${xmlEsc(a.en)}" mainActiveSkill="1">\n${gems}\n</Skill>`;
      }).join('\n');
      const xml = `<PathOfBuilding>\n<Build level="1" mainSkillGroup="1" viewMode="CODE"/>\n<Skills activeSkillSet="1">\n<SkillSet id="1">\n${groups}\n</SkillSet>\n</Skills>\n</PathOfBuilding>`;
      const code = core.pobcode.encodeShareCode(xml);
      clipboard.writeText(code);
      console.log(`[overlay] buildgen:combocode: ${actives.length} активных, код ${code.length} симв. записан в буфер`);
      return { ok: true, code, chars: code.length, nActives: actives.length, nSupports: Object.values(supports).reduce((n, v) => n + (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x).length : 0), 0) };
    } catch (err) {
      console.warn('[overlay] buildgen:combocode failed:', (err as Error).message);
      return { ok: false, error: `Не удалось собрать код: ${(err as Error).message}` };
    }
  });

  // №113e(+b): клавиатура для полей ввода (поиск нод и т.п.). Окно создаётся
  // focusable:false, чтобы не красть фокус у игры (main.ts: BrowserWindow).
  // Из-за этого клик по <input> не давал текстового ввода. Отдаём клавиатуру
  // ТОЛЬКО на время фокуса поля (focusin/mousedown/focusout в renderer):
  // наведение курсора на панель фокус не ворует, WASD в бою не теряется.
  // №113e-b по живому логу друга: вызовов keyboard:set НОЛЬ — focusin в
  // блюрнутом renderer не срабатывал; guard moveUnlocked стоял ДО лога
  // (слепая зона телеметрии). Теперь логируем ВСЕГДА, включая отказ.
  ipcMain.handle('keyboard:set', (_evt, want: boolean) => {
    const win = overlayWindow;
    if (!win || win.isDestroyed()) {
      console.log('[overlay] keyboard: НЕТ ОКНА, отказ');
      return false;
    }
    if (moveUnlocked) {
      // №113e-c (живой лог №128): друг ЖИВЁТ в move-режиме после первого Ctrl+F5 —
      // отказы «ОТКЛОНЁН» ломали ему ввод навсегда. Move-режим уже держит
      // setFocusable(true), поэтому фокус не трогаем — отключаем полю сам гаситель
      // before-input-event (keyboardCaptured), и не отбиваем setFocusable на снятии.
      keyboardCaptured = want;
      console.log(`[overlay] keyboard: ${want ? 'передана полю ввода (move-режим: фокус уже у окна, снят гаситель клавиш)' : 'снята с поля (move-режим)'}`);
      return true;
    }
    win.setFocusable(want);
    if (want) win.focus();
    keyboardCaptured = want; // №113e-b: до этого before-input-event гасил все клавиши
    console.log(`[overlay] keyboard: ${want ? 'захвачена полем ввода (setFocusable+focus)' : 'возвращена игре (setFocusable false)'}`);
    return want;
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
  else seedRuEnStatic(); // кэш валиден — но статические базы должны быть всегда (#138)
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