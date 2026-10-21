/**
 * gdiCapture.ts — захват client area окна PoE2 через GDI (BitBlt+GetDIBits).
 *
 * Порт Poe2Pricer.Core/GameCapture.cs (MIT saxe78, №584 этап 1) на koffi:
 *  - BitBlt 0x00CC0020 (SRCCOPY) из экранного DC в memory DC (GameCapture.cs:105);
 *  - GetDIBits c Height=-height → top-down 32bpp BGRA (GameCapture.cs:107-117);
 *  - process per-monitor DPI aware обязателен: координаты физические (комментарий донора, :10).
 *
 * Отличия от донора:
 *  - окно ищем через win32.ts (заголовок), а не по имени процесса FindGame() (:33-49);
 *  - Frame-обёртка (Mat+ScreenBounds+Pointer+Scale) не портирована: отдаём чистый
 *    BgraFrame client area (+ origin и курсор); GameView-преобразование делает core.
 *  - донор режет Part/LookArea ради скорости (:53); MVP №584 захватывает весь client,
 *    ROI-вырезка — в core (roiView), оптимизация отложена до живых замеров (гейт 50 мс).
 *
 * По образцу win32.ts: out/inout-структуры — простые JS-объекты, koffi мутирует их на месте.
 */

import * as koffi from 'koffi';
import type { GameWindowInfo } from './win32.js';

/** Кадр client area в физ. пикселях: BGRA (byte0 = B, как Mat BGR-плоскости донора). */
export interface ClientFrame {
  width: number;
  height: number;
  data: Uint8Array;
  /** client area origin на экране (ClientToScreen), физ. пиксели. */
  originX: number;
  originY: number;
  /** Курсор в координатах client area или null (вне окна). GameCapture.cs:91-92. */
  pointer: { x: number; y: number } | null;
  hwnd: number;
}

const SRCCOPY = 0x00cc0020; // GameCapture.cs:105
const DIB_RGB_COLORS = 0;

/** Win32 структуры как plain-объекты (koffi заполняет их на месте). */
interface RectStruct { left: number; top: number; right: number; bottom: number }
interface PointStruct { x: number; y: number }
/** BITMAPINFOHEADER, LayoutKind.Sequential — GameCapture.cs:152-161. */
interface BitmapInfoHeader {
  size: number; width: number; height: number;
  planes: number; bitCount: number;
  compression: number; sizeImage: number;
  xPelsPerMeter: number; yPelsPerMeter: number;
  clrUsed: number; clrImportant: number;
}

let initialized = false;
let failed = false;

type CaptureLib = {
  GetClientRect: (hwnd: number, rect: RectStruct) => number;
  ClientToScreen: (hwnd: number, pt: PointStruct) => number;
  GetCursorPos: (pt: PointStruct) => number;
  GetDC: (hwnd: number) => number;
  ReleaseDC: (hwnd: number, dc: number) => number;
  CreateCompatibleDC: (dc: number) => number;
  CreateCompatibleBitmap: (dc: number, w: number, h: number) => number;
  SelectObject: (dc: number, obj: number) => number;
  DeleteObject: (obj: number) => number;
  DeleteDC: (dc: number) => number;
  BitBlt: (dst: number, x: number, y: number, w: number, h: number, src: number, sx: number, sy: number, rop: number) => number;
  GetDIBits: (dc: number, bitmap: number, start: number, lines: number, bits: Buffer, info: BitmapInfoHeader, usage: number) => number;
};

let cachedLib: CaptureLib | null = null;

function initCapture(): CaptureLib | null {
  if (process.platform !== 'win32' || failed) return null;
  if (initialized) return cachedLib;

  try {
    const user = koffi.load('user32.dll');
    const gdi = koffi.load('gdi32.dll');

    // Имена структур уникальные, чтобы не коллидировать с win32.ts (Poe2KitRECT).
    const RECT = koffi.struct('Poe2KitGdiRECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    const POINT = koffi.struct('Poe2KitGdiPOINT', { x: 'long', y: 'long' });
    const BMIH = koffi.struct('Poe2KitGdiBITMAPINFOHEADER', {
      size: 'uint32',
      width: 'int32',
      height: 'int32',
      planes: 'uint16',
      bitCount: 'uint16',
      compression: 'uint32',
      sizeImage: 'uint32',
      xPelsPerMeter: 'int32',
      yPelsPerMeter: 'int32',
      clrUsed: 'uint32',
      clrImportant: 'uint32',
    });
    const RECTP = koffi.pointer(RECT);
    const POINTP = koffi.pointer(POINT);

    const lib: CaptureLib = {
      GetClientRect: user.func('GetClientRect', 'int', ['intptr', koffi.out(RECTP)]),
      ClientToScreen: user.func('ClientToScreen', 'int', ['intptr', koffi.inout(POINTP)]),
      GetCursorPos: user.func('GetCursorPos', 'int', [koffi.out(POINTP)]),
      GetDC: user.func('GetDC', 'intptr', ['intptr']),
      ReleaseDC: user.func('ReleaseDC', 'int', ['intptr', 'intptr']),
      CreateCompatibleDC: gdi.func('CreateCompatibleDC', 'intptr', ['intptr']),
      CreateCompatibleBitmap: gdi.func('CreateCompatibleBitmap', 'intptr', ['intptr', 'int', 'int']),
      SelectObject: gdi.func('SelectObject', 'intptr', ['intptr', 'intptr']),
      DeleteObject: gdi.func('DeleteObject', 'int', ['intptr']),
      DeleteDC: gdi.func('DeleteDC', 'int', ['intptr']),
      BitBlt: gdi.func('BitBlt', 'int', ['intptr', 'int', 'int', 'int', 'int', 'intptr', 'int', 'int', 'uint32']),
      GetDIBits: gdi.func('GetDIBits', 'int', ['intptr', 'intptr', 'uint', 'uint', 'void *', koffi.inout(koffi.pointer(BMIH)), 'uint']),
    };

    cachedLib = lib;
    initialized = true;
    return lib;
  } catch (err) {
    failed = true;
    console.warn('[gdiCapture] FFI init failed:', err);
    return null;
  }
}

/** Client rect + экранное origin. GameCapture.cs:81-89 (Client). */
function clientArea(
  lib: CaptureLib,
  hwnd: number,
): { originX: number; originY: number; width: number; height: number } | null {
  const rect: RectStruct = { left: 0, top: 0, right: 0, bottom: 0 };
  const pt: PointStruct = { x: 0, y: 0 };
  if (!lib.GetClientRect(hwnd, rect) || !lib.ClientToScreen(hwnd, pt)) return null;
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (width <= 0 || height <= 0) return null;
  return { originX: pt.x, originY: pt.y, width, height };
}

/** Grab(x, y, w, h): фрагмент экрана как BGRA. GameCapture.cs:95-130. */
function grab(lib: CaptureLib, x: number, y: number, width: number, height: number): Uint8Array | null {
  if (width <= 0 || height <= 0) return null;
  const screen = lib.GetDC(0);
  if (!screen) return null;
  const memory = lib.CreateCompatibleDC(screen);
  const bitmap = lib.CreateCompatibleBitmap(screen, width, height);
  const old = lib.SelectObject(memory, bitmap);
  try {
    if (!lib.BitBlt(memory, 0, 0, width, height, screen, x, y, SRCCOPY)) return null;
    const info: BitmapInfoHeader = {
      size: 40, // sizeof(BITMAPINFOHEADER), GameCapture.cs:109
      width,
      height: -height, // top-down, GameCapture.cs:111
      planes: 1,
      bitCount: 32,
      compression: 0,
      sizeImage: 0,
      xPelsPerMeter: 0,
      yPelsPerMeter: 0,
      clrUsed: 0,
      clrImportant: 0,
    };
    lib.SelectObject(memory, old);
    const bits = Buffer.allocUnsafe(width * height * 4);
    if (lib.GetDIBits(memory, bitmap, 0, height, bits, info, DIB_RGB_COLORS) === 0) return null;
    return new Uint8Array(
      bits.buffer,
      bits.byteOffset,
      width * height * 4,
    );
  } finally {
    // GameCapture.cs:123-129: полный клинup независимо от результата.
    lib.DeleteObject(bitmap);
    lib.DeleteDC(memory);
    lib.ReleaseDC(0, screen);
  }
}

/**
 * Захват client area окна игры. null — окно пропало / FFI недоступен / BitBlt|GetDIBits
 * неудачны. Перед живым использованием с окном PoE2: НЕ запускалось (проверка №5 гейта).
 */
export function captureClient(game: Pick<GameWindowInfo, 'hwnd'>): ClientFrame | null {
  const lib = initCapture();
  if (!lib) return null;
  const area = clientArea(lib, game.hwnd);
  if (!area) return null;

  const data = grab(lib, area.originX, area.originY, area.width, area.height);
  if (!data) return null;

  // Pointer(origin, w, h): курсор внутри client area, GameCapture.cs:91-92.
  let pointer: { x: number; y: number } | null = null;
  const pt: PointStruct = { x: 0, y: 0 };
  if (lib.GetCursorPos(pt)) {
    if (pt.x >= area.originX && pt.y >= area.originY && pt.x < area.originX + area.width && pt.y < area.originY + area.height) {
      pointer = { x: pt.x - area.originX, y: pt.y - area.originY };
    }
  }

  return {
    width: area.width,
    height: area.height,
    data,
    originX: area.originX,
    originY: area.originY,
    pointer,
    hwnd: game.hwnd,
  };
}
