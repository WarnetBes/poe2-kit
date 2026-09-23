/**
 * PoE2 Kit — Windows-оверлей.
 *
 * Прозрачное, безрамочное, всегда-поверх, кликабельно-("сквозь") окно поверх игры.
 * Глобальный хоткей (по умолчанию Ctrl+Alt+Space) читает предмет из буфера обмена
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

// ─── Настройки по умолчанию ────────────────────────────────────────────────
const PRICE_HOTKEY = 'CommandOrControl+Alt+Space';
const DEFAULT_LEAGUE = 'Runes of Aldur';

let activeLeague = DEFAULT_LEAGUE;
let overlayWindow: BrowserWindow | null = null;
let busy = false;

// ─── Геометрия оверлея и привязка к окну игры ──────────────────────────────
const OVERLAY_WIDTH = 420;
const OVERLAY_HEIGHT = 320;
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
    // Игра/окно не найдено — прячем оверлей.
    if (win.isVisible()) win.hide();
    return;
  }

  // Игра не в фокусе или свёрнута — прячем оверлей (по выбору пользователя).
  const active = isGameForeground(found);
  if (!active) {
    if (win.isVisible()) win.hide();
    return;
  }

  // Позиция (DIP): правый верхний угол окна игры, с отступом заданного размера.
  const rect = physicalRectToDip(found.rect);
  const x = Math.round(rect.x + rect.width - OVERLAY_WIDTH - MARGIN);
  const y = Math.round(rect.y + MARGIN);

  // Если сменился HWND игры (перезапуск PoE2) — форсируем обновление позиции.
  const hwndKey = String(found.hwnd);
  if (lastHwndKey !== hwndKey) {
    lastHwndKey = hwndKey;
    lastRectKey = '';
  }

  // Перемещаем оверлей только если позиция реально изменилась (меньше дерганий).
  const key = `${x},${y}`;
  if (lastRectKey !== key) {
    lastRectKey = key;
    win.setBounds({
      x,
      y,
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
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
async function runPriceCheck(): Promise<unknown> {
  if (busy) return null;
  busy = true;
  try {
    const itemText = clipboard.readText();
    await overlayWindow?.webContents.send('price:busy', true);

    let result;
    try {
      result = await core.trade.priceCheck(itemText);
    } catch (err) {
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

    await overlayWindow?.webContents.send('price:result', result);
    return result;
  } finally {
    busy = false;
    await overlayWindow?.webContents.send('price:busy', false);
  }
}

function registerHotkeys(): void {
  const ok = globalShortcut.register(PRICE_HOTKEY, () => {
    void runPriceCheck();
  });
  console.log(`[overlay] hotkey ${PRICE_HOTKEY} registered=${ok}`);
}

function setupIPC(): void {
  ipcMain.handle('price:check', () => runPriceCheck());

  ipcMain.handle('league:get', () => {
    return activeLeague;
  });

  ipcMain.handle('league:set', (_evt, league: string) => {
    if (typeof league === 'string' && league.trim()) {
      activeLeague = league.trim();
      core.trade.setLeague(activeLeague);
    }
    return activeLeague;
  });

  ipcMain.handle('hotkey:get', () => PRICE_HOTKEY);

  // Переключатель «кликабельности» оверлея из рендерера.
  ipcMain.handle('interact:set', (_evt, interact: boolean) => {
    overlayWindow?.setIgnoreMouseEvents(!interact, { forward: true });
    return interact;
  });
}

const IS_SMOKE = process.argv.includes('--smoke');

app.whenReady().then(() => {
  core.trade.setLeague(activeLeague);
  setupIPC();
  void createOverlayWindow().then(() => {
    startGameTracker();
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