/**
 * Preload: безопасный мост между изолированным рендерером и main-процессом.
 * Renderer имеет доступ только к api, описанному ниже (contextIsolation: true).
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface OverlayAPI {
  priceCheck(): Promise<unknown>;
  onPriceResult(cb: (result: unknown) => void): () => void;
  onPriceBusy(cb: (busy: boolean) => void): () => void;
  onLevelResult(cb: (level: unknown) => void): () => void;
  getLeague(): Promise<string>;
  setLeague(league: string): Promise<string>;
  getHotkey(): Promise<string>;
  setInteractive(interact: boolean): Promise<boolean>;
}

const api: OverlayAPI = {
  priceCheck: () => ipcRenderer.invoke('price:check'),

  onLevelResult: (cb) => {
    const listener = (_evt: unknown, data: unknown) => cb(data);
    ipcRenderer.on('level:result', listener);
    return () => ipcRenderer.removeListener('level:result', listener);
  },

  onPriceResult: (cb) => {
    const listener = (_evt: unknown, data: unknown) => cb(data);
    ipcRenderer.on('price:result', listener);
    return () => ipcRenderer.removeListener('price:result', listener);
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
};

contextBridge.exposeInMainWorld('poe2k', api);