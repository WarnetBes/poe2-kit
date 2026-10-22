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
  /** PID процесса-владельца (№585: Steam-игры держат несколько top-level окон
   *  с одинаковой подстрокой в титуле — hwnd-точное сравнение с GetForegroundWindow
   *  вечно промахивается, PID — надёжная связка). */
  pid: number;
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
  GetWindowThreadProcessId: (hwnd: number, pidOut: Uint32Array) => number;
  GetAncestor: (hwnd: number, flags: number) => number;
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
      GetWindowThreadProcessId: user.func('GetWindowThreadProcessId', 'uint32', ['intptr', koffi.out('uint32 *')]),
      GetAncestor: user.func('GetAncestor', 'intptr', ['intptr', 'uint32']),
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
    const pidOut = new Uint32Array(1);
    lib.GetWindowThreadProcessId(hwnd, pidOut);
    const info: GameWindowInfo = {
      hwnd,
      title,
      className,
      rect,
      minimized: !!lib.IsIconic(hwnd),
      foreground: lib.GetForegroundWindow() === hwnd,
      pid: pidOut[0],
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
  const matches: GameWindowInfo[] = [];
  enumSink = (info) => {
    if (EXCLUDED_CLASSES.has(info.className)) return; // браузер ≠ игра
    if (info.title.toLowerCase().includes(keyword)) {
      matches.push(info);
    }
  };
  try {
    lib.EnumWindows(registeredCb, 0);
  } finally {
    enumSink = null;
  }
  if (!matches.length) return null;
  // №585-фикс: до этого брали ПЕРВОЕ окно-матч по Z-порядку EnumWindows — если
  // подстроку в титуле держат несколько окон, гребли не то (Steam: лаунчер/клиент).
  // Выбор: 1) не свёрнутое и на переднем плане; 2) не свёрнутое и крупнейшее;
  // 3) любое не свёрнутое; 4) первое.
  const pick =
    matches.find((m) => m.foreground && !m.minimized) ??
    (matches.filter((m) => !m.minimized).sort((a, b) => area(b.rect) - area(a.rect))[0] ??
      matches.find((m) => !m.minimized)) ??
      matches[0];
  if (matches.length > 1) {
    console.log(
      `[win32] ${matches.length} окон-матчей «${keyword}»: выбрано "${pick.title}" (class=${pick.className}, pid=${pick.pid}, ${pick.rect.right - pick.rect.left}x${pick.rect.bottom - pick.rect.top}); остальные: ` +
        matches.filter((m) => m !== pick).map((m) => `"${m.title}" class=${m.className} pid=${m.pid} min=${m.minimized}`).join('; '),
    );
  }
  return pick;
}

const area = (r: Rect): number => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);

/** Краткое описание произвольного окна для диагностики (title/class/pid). */
export function describeWindow(hwnd: number): string {
  const lib = initUser32();
  if (!lib || !hwnd) return `hwnd=${hwnd}`;
  try {
    const title = readW(hwnd, lib.GetWindowTextW, 512);
    const className = readW(hwnd, lib.GetClassNameW, 256);
    const pidOut = new Uint32Array(1);
    lib.GetWindowThreadProcessId(hwnd, pidOut);
    return `"${title}" class=${className} pid=${pidOut[0]}`;
  } catch {
    return `hwnd=${hwnd} (описание недоступно)`;
  }
}

/** hwnd текущего окна на переднем плане (для диагностики отказов). */
export function fgHwnd(): number {
  const lib = initUser32();
  if (!lib) return 0;
  try {
    return lib.GetForegroundWindow();
  } catch {
    return 0;
  }
}

/** Если игра сейчас под курсором-фокусом и это её окно — возвращаем информацию.
 *  №585-фикс: точный hwnd-матч — только один из валидных исходов. Steam-игры
 *  держат несколько top-level окон, и фокус может стоять на соседнем hwnd
 *  того же процесса — сравниваем также PID корня окна (GA_ROOT=2). */
export function isGameForeground(
  found: GameWindowInfo,
): boolean {
  const lib = initUser32();
  if (!lib) return false;
  if (found.minimized) return false;
  try {
    const fg = lib.GetForegroundWindow();
    if (!fg) return false;
    if (fg === found.hwnd) return true;
    // фокус в другом hwnd: валидно, если его root-окно принадлежит тому же
    // процессу (child-окно игры ИЛИ второй top-level Steam-клиента),
    // ЛИБО нашему собственному процессу (хоткей жмётся из окна оверлея —
    // №585: Electron-окно держит фокус после клика/move-режима; GDI-захват
    // идёт по hwnd игры и от фокуса не зависит, кандидаты выбирает якорь).
    const root = lib.GetAncestor(fg, 2 /* GA_ROOT */) || fg;
    const pidOut = new Uint32Array(1);
    lib.GetWindowThreadProcessId(root, pidOut);
    if (!pidOut[0]) return false;
    return pidOut[0] === found.pid || pidOut[0] === process.pid;
  } catch {
    return false;
  }
}