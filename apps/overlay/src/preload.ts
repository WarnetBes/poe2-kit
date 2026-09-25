/**
 * Preload: безопасный мост между изолированным рендерером и main-процессом.
 * Renderer имеет доступ только к api, описанному ниже (contextIsolation: true).
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface OverlayAPI {
  priceCheck(): Promise<unknown>;
  onPriceBatch(cb: (payload: unknown) => void): () => void;
  onPriceBusy(cb: (busy: boolean) => void): () => void;
  onLevelResult(cb: (level: unknown) => void): () => void;
  getLeague(): Promise<string>;
  setLeague(league: string): Promise<string>;
  getHotkey(): Promise<string>;
  setInteractive(interact: boolean): Promise<boolean>;
  onMoveMode(cb: (state: { unlocked: boolean; resetOffset: boolean }) => void): () => void;
  resetOffset(): Promise<boolean>;
  onBuildUpdate(cb: (state: unknown) => void): () => void;
  buildImport(): Promise<boolean>;
  buildToggle(): Promise<boolean>;
  buildReset(): Promise<boolean>;
  buildGet(): Promise<unknown>;
  /** Подогнать высоту окна под контент ( авторазмер, px в DIP). */
  autosize(px: number): Promise<number>;
  /** Получить текущие настройки (угол, прозрачность, масштаб, ширина, хоткеи). */
  settingsGet(): Promise<unknown>;
  /** Применить настройки из панели. */
  settingsApply(next: unknown): Promise<unknown>;
  /** Слушать переключение панели настроек (Ctrl+F6). */
  onSettingsToggle(cb: () => void): () => void;
  /** Слушать применение настроек отображения (прозрачность/масштаб/ширина/угол). */
  onSettingsDisplay(cb: (s: unknown) => void): () => void;
  /** Watchlist: получить список отслеживаемых предметов. */
  watchList(): Promise<unknown>;
  /** Watchlist: добавить предмет (по itemText+label) в отслеживание. */
  watchAdd(payload: unknown): Promise<unknown>;
  /** Watchlist: добавить текущий буфер обмена (Ctrl+C по предмету) в отслеживание. */
  watchAddBuffer(): Promise<unknown>;
  /** Watchlist: удалить позицию по id. */
  watchRemove(id: string): Promise<unknown>;
  /** Watchlist: вкл/выкл позицию по id. */
  watchToggle(id: string): Promise<unknown>;
  /** Watchlist: принудительно проверить цены сейчас. */
  watchCheck(): Promise<unknown>;
  /** Watchlist: слушать всплывающий алерт «цена упала с X до Y». */
  onWatchAlert(cb: (alert: unknown) => void): () => void;
  /** Диагностика оверлея: собрать хвост overlay.log + конфиг машины, вернуть текст (буфер/файл ставит main). */
  diagCollect(): Promise<unknown>;
}

const api: OverlayAPI = {
  priceCheck: () => ipcRenderer.invoke('price:check'),

  onLevelResult: (cb) => {
    const listener = (_evt: unknown, data: unknown) => cb(data);
    ipcRenderer.on('level:result', listener);
    return () => ipcRenderer.removeListener('level:result', listener);
  },

  onPriceBatch: (cb) => {
    const listener = (_evt: unknown, data: unknown) => cb(data);
    ipcRenderer.on('price:batch', listener);
    return () => ipcRenderer.removeListener('price:batch', listener);
  },

  onPriceBusy: (cb) => {
    const listener = (_evt: unknown, data: boolean) => cb(data);
    ipcRenderer.on('price:busy', listener);
    return () => ipcRenderer.removeListener('price:busy', listener);
  },

  getLeague: () => ipcRenderer.invoke('league:get'),

  setLeague: (league) => ipcRenderer.invoke('league:set', league),

  getHotkey: () => ipcRenderer.invoke('hotkey:get'),

  setInteractive: (interact) => ipcRenderer.invoke('interact:set', interact),

  onMoveMode: (cb) => {
    const listener = (_evt: unknown, state: { unlocked: boolean; resetOffset: boolean }) =>
      cb(state);
    ipcRenderer.on('move:mode', listener);
    return () => ipcRenderer.removeListener('move:mode', listener);
  },

  resetOffset: () => ipcRenderer.invoke('move:reset'),

  onBuildUpdate: (cb) => {
    const listener = (_evt: unknown, state: unknown) => cb(state);
    ipcRenderer.on('build:update', listener);
    return () => ipcRenderer.removeListener('build:update', listener);
  },

  buildImport: () => ipcRenderer.invoke('build:import'),

  buildToggle: () => ipcRenderer.invoke('build:toggle'),

  buildReset: () => ipcRenderer.invoke('build:reset'),

  buildGet: () => ipcRenderer.invoke('build:get'),

  autosize: (px) => ipcRenderer.invoke('overlay:autosize', px),

  settingsGet: () => ipcRenderer.invoke('settings:get'),

  settingsApply: (next) => ipcRenderer.invoke('settings:apply', next),

  onSettingsToggle: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('settings:toggle', listener);
    return () => ipcRenderer.removeListener('settings:toggle', listener);
  },

  onSettingsDisplay: (cb) => {
    const listener = (_evt: unknown, s: unknown) => cb(s);
    ipcRenderer.on('settings:display', listener);
    return () => ipcRenderer.removeListener('settings:display', listener);
  },

  watchList: () => ipcRenderer.invoke('watch:list'),

  watchAdd: (payload) => ipcRenderer.invoke('watch:add', payload),

  watchAddBuffer: () => ipcRenderer.invoke('watch:addBuffer'),

  watchRemove: (id) => ipcRenderer.invoke('watch:remove', id),

  watchToggle: (id) => ipcRenderer.invoke('watch:toggle', id),

  watchCheck: () => ipcRenderer.invoke('watch:check'),

  onWatchAlert: (cb) => {
    const listener = (_evt: unknown, alert: unknown) => cb(alert);
    ipcRenderer.on('watch:alert', listener);
    return () => ipcRenderer.removeListener('watch:alert', listener);
  },

  diagCollect: () => ipcRenderer.invoke('diag:collect'),
};

contextBridge.exposeInMainWorld('poe2k', api);