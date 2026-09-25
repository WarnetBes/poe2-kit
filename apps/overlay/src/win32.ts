/**
 * win32.ts — тонкая обёртка над Win32 (user32.dll) для привязки оверлея к окну игры.
 *
 * Используется нативный FFI-модуль `koffi` (N-API, не требует компиляции под Electron).
 * Отвечает на вопросы:
 *  - есть ли открытое окно PoE2 (по подстроке заголовка),
 *  - где оно (rect в физических пикселях — как отдаёт GetWindowRect),
 *  - свёрнуто ли окно (IsIconic),
 *  - является ли оно активным (GetForegroundWindow).
 *
 * Вся логика провисает лениво и безопасно: если платформа не Windows или koffi
 * не загрузился — модуль возвращает «не нашли окно», ничего не падает.
 */

import * as koffi from 'koffi';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface GameWindowInfo {
  /** HWND окна (число, pointer-size integer). */
  hwnd: number;
  title: string;
  className: string;
  /** rect в физических пикселях (GetWindowRect). */
  rect: Rect;
  minimized: boolean;
  foreground: boolean;
}

// ── Ленивая инициализация FFI (только Windows) ─────────────────────────────

let initialized = false;
let failed = false;

type User32Lib = {
  EnumWindows: (cb: unknown, lparam: unknown) => number;
  GetWindowTextW: (hwnd: number, buf: Uint16Array, max: number) => number;
  GetClassNameW: (hwnd: number, buf: Uint16Array, max: number) => number;
  IsWindowVisible: (hwnd: number) => number;
  IsIconic: (hwnd: number) => number;
  GetWindowRect: (hwnd: number, rect: Rect) => number;
  GetForegroundWindow: () => number;
};

/** Зарегистрированная C-функция-колбэк для EnumWindows (держим ссылку, чтобы её не GC). */
let registeredCb: unknown = null;

const WIN32_OK = process.platform === 'win32';

function initUser32(): User32Lib | null {
  if (!WIN32_OK || failed) return null;
  if (initialized) return cachedLib;

  try {
    const user = koffi.load('user32.dll');

    const RECT = koffi.struct('Poe2KitRECT', {
      left: 'long',
      top: 'long',
      right: 'long',
      bottom: 'long',
    });
    const RECTP = koffi.pointer(RECT);

    const CB = koffi.proto('Poe2KitEnumProc', 'int', ['intptr', 'intptr']);
    const CBPTR = koffi.pointer(CB);

    const lib: User32Lib = {
      EnumWindows: user.func('EnumWindows', 'int', [CBPTR, 'intptr']),
      GetWindowTextW: user.func('GetWindowTextW', 'int', ['intptr', 'char16_t *', 'int']),
      GetClassNameW: user.func('GetClassNameW', 'int', ['intptr', 'char16_t *', 'int']),
      IsWindowVisible: user.func('IsWindowVisible', 'int', ['intptr']),
      IsIconic: user.func('IsIconic', 'int', ['intptr']),
      GetWindowRect: user.func('GetWindowRect', 'int', ['intptr', koffi.out(RECTP)]),
      GetForegroundWindow: user.func('GetForegroundWindow', 'intptr', []),
    };

    // Храним колбэк глобально — иначе EnumWindows может не дождаться (колбэк собирается GC).
    registeredCb = koffi.register(
      (hwnd: number, _lparam: unknown) => runEnum(hwnd),
      CBPTR,
    );
    cachedLib = lib;
    initialized = true;
    return lib;
  } catch (err) {
    failed = true;
    console.warn('[win32] FFI init failed (окно игры будет определяться неточно):', err);
    return null;
  }
}

let cachedLib: User32Lib | null = null;

/** Колбэк EnumWindows: накапливает окна в текущий буфер в момент перечисления. */
let enumSink: ((info: GameWindowInfo) => void) | null = null;

function runEnum(hwnd: number): number {
  const lib = cachedLib;
  if (!lib) return 1;
  try {
    if (!lib.IsWindowVisible(hwnd)) return 1;
    const title = readW(hwnd, lib.GetWindowTextW, 512);
    const className = readW(hwnd, lib.GetClassNameW, 256);
    if (!title) return 1;
    const rect: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
    lib.GetWindowRect(hwnd, rect);
    const info: GameWindowInfo = {
      hwnd,
      title,
      className,
      rect,
      minimized: !!lib.IsIconic(hwnd),
      foreground: lib.GetForegroundWindow() === hwnd,
    };
    enumSink?.(info);
  } catch {
    /* одно окно не должно ронять перечисление */
  }
  return 1;
}

/** Читает UTF-16 заголовок/класс окна в типизированный буфер (как возвращает Win32). */
function readW(
  hwnd: number,
  fn: (hwnd: number, buf: Uint16Array, max: number) => number,
  max: number,
): string {
  const buf = new Uint16Array(max);
  const n = fn(hwnd, buf, max);
  if (n <= 0) return '';
  return new TextDecoder('utf-16le').decode(new Uint8Array(buf.buffer, 0, n * 2));
}

// ── Публичное API ───────────────────────────────────────────────────────────

/** Классы окон браузеров: их заголовки часто содержат «Path of Exile»
 *  (вкладки poe-сайтов, Google-поиск), но это не окно игры — оверлей,
 *  привязанный к такому окну, «мигает» и прыгает. */
const EXCLUDED_CLASSES = new Set([
  'Chrome_WidgetWin_1', // Chrome / Edge / Brave / Vivaldi (все Chromium)
  'Chrome_WidgetWin_0',
  'MozillaWindowClass', // Firefox
  'OperaWindowClass', // Opera
  'ApplicationFrameWindow', // UWP-приложения (Edge, Почта)
  'Windows.UI.Core.CoreWindow', // UWP / системные всплывашки
]);

export interface FindGameOptions {
  /** Подстрока заголовка искомого окна (без учёта регистра). */
  titleKeyword?: string;
  /** Подпись для логов. */
  label?: string;
}

/**
 * Перечисляет все видимые top-level окна и возвращает первое, чей заголовок
 * содержит искомую подстроку (без учёта регистра). Если окно/FFI недоступны — null.
 */
export function findGameWindow(options: FindGameOptions = {}): GameWindowInfo | null {
  const lib = initUser32();
  if (!lib) return null;

  const keyword = (options.titleKeyword ?? 'Path of Exile').toLowerCase();
  let found: GameWindowInfo | null = null;
  enumSink = (info) => {
    if (found) return; // уже нашли — дальше не интересно
    if (info.minimized) return; // свёрнутое окно не подходит
    if (EXCLUDED_CLASSES.has(info.className)) return; // браузер ≠ игра
    if (info.title.toLowerCase().includes(keyword)) {
      found = info;
    }
  };
  try {
    lib.EnumWindows(registeredCb, 0);
  } finally {
    enumSink = null;
  }
  return found;
}

/** Если игра сейчас под курсором-фокусом и это её окно — возвращаем информацию. */
export function isGameForeground(
  found: GameWindowInfo,
): boolean {
  const lib = initUser32();
  if (!lib) return false;
  try {
    return lib.GetForegroundWindow() === found.hwnd && !found.minimized;
  } catch {
    return false;
  }
}