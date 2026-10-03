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
  /** №108: отметить квест-награду «забрал» (персист claimedRewards). */
  levelClaim(key: string): Promise<{ ok: boolean }>;
  /** №140: сброс прогресса прокачки (новый персонаж в той же лиге). */
  levelReset(): Promise<unknown>;
  /** №111: результат чекапа перед пиннаклом (Ctrl+F7). */
  onPinnacleResult(cb: (payload: unknown) => void): () => void;
  setLeague(league: string): Promise<string>;
  /** Список действующих лиг для селекта настроек: { current, leagues: [{name, isCurrent}] }. */
  leaguesList(): Promise<unknown>;
  setInteractive(interact: boolean): Promise<boolean>;
  /** №113e: захват клавиатуры на время фокуса поля ввода (focusable у окна). */
  captureKeyboard(want: boolean): Promise<boolean>;
  onMoveMode(cb: (state: { unlocked: boolean; resetOffset: boolean }) => void): () => void;
  resetOffset(): Promise<boolean>;
  onBuildUpdate(cb: (state: unknown) => void): () => void;
  buildImport(): Promise<boolean>;
  buildToggle(): Promise<boolean>;
  buildReset(): Promise<boolean>;
  buildGet(): Promise<unknown>;
  /** №91: стартовые билды новичка (сюжет): список классов и импорт. */
  starterList(): Promise<unknown>;
  starterImport(klass: string): Promise<unknown>;
  starterPickAsc(name: string): Promise<unknown>;
  /** Поиск узлов пассивного дерева по имени/стату (dataset.searchPassiveTree). */
  treeSearch(query: string): Promise<unknown[]>;
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
  /** №85: сообщение от MCP-агента поверх игры (тост): {title, text}. */
  onAgentNotify(cb: (msg: { title: string; text: string }) => void): () => void;
  /** Диагностика оверлея: собрать хвост overlay.log + конфиг машины, вернуть текст (буфер/файл ставит main). */
  diagCollect(): Promise<unknown>;
  /** №64: вкладки — открыть панель кликом (те же действия, что хоткеи):
   * 'price' | 'level' | 'build' | 'import' | 'settings'. */
  panelOpen(action: string): Promise<unknown>;
  /** Журнал обучения: сколько записей накоплено, включён ли. */
  learnInfo(): Promise<unknown>;
  /** Сформировать вклад в библиотеку предметов: текст уже в буфере обмена + файл в userData. */
  learnContribute(): Promise<unknown>;
  /** №134: каталог крафт-рецептов PoE2 ({ recipes, essences, perfectHint, omens }). */
  craftCatalog(): Promise<unknown>;
  /** №134: персональный крафт-план по предмету из буфера (Ctrl+C в игре → вызов). */
  craftPlanBuffer(): Promise<unknown>;
  /** №135: курсы валют по лигам ({ league, leagues, rates: [{name, chaos, divine, trend, source}] }). */
  currencyRates(league?: string): Promise<unknown>;
  /** №136: мета-генератор билдов ({ league, slugs, sample, classes: [...] }). */
  buildgenMeta(leagueSlug?: string): Promise<unknown>;
  /** №139: данные гемов для конструктора связок ({ actives, supports }) — офлайн-датасет. */
  /** №141: чанковая загрузка датасета гемов ( offset..offset+limit ). */
  buildgenGemData(chunk?: { offset: number; limit?: number }): Promise<unknown>;
  /** №141: импорт-код связки из конструктора (копируется в буфер обмена). */
  buildgenComboCode(payload: unknown): Promise<unknown>;
  /** №143: фиксация попытки босса (kill|death) — время от входа в зону по живому логу. */
  bossTimerDone(zoneCode: string, kind: 'kill' | 'death'): Promise<unknown>;
  /** №196-bis (S7-UI): сброс кэшей stat-матчинга (кнопка Reload в баннере
   *  «N модов не распознано»); следующий прайс-чек пойдёт с чистой мемоизацией. */
  reloadTradeStats(): Promise<unknown>;
}

const api: OverlayAPI = {
  priceCheck: () => ipcRenderer.invoke('price:check'),

  onLevelResult: (cb) => {
    const listener = (_evt: unknown, data: unknown) => cb(data);
    ipcRenderer.on('level:result', listener);
    return () => ipcRenderer.removeListener('level:result', listener);
  },

  levelClaim: (key) => ipcRenderer.invoke('level:claim', key),

  // №140: сброс прогресса прокачки (новый персонаж в той же лиге).
  levelReset: () => ipcRenderer.invoke('level:reset'),

  // №143: фиксация попытки босса («Убит»/«Смерть») — время от входа в зону.
  bossTimerDone: (zoneCode: string, kind: 'kill' | 'death') =>
    ipcRenderer.invoke('boss:timerdone', zoneCode, kind),

  onPinnacleResult: (cb) => {
    const listener = (_evt: unknown, data: unknown) => cb(data);
    ipcRenderer.on('pinnacle:result', listener);
    return () => ipcRenderer.removeListener('pinnacle:result', listener);
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

  setLeague: (league) => ipcRenderer.invoke('league:set', league),

  leaguesList: () => ipcRenderer.invoke('leagues:list'),

  setInteractive: (interact) => ipcRenderer.invoke('interact:set', interact),
  // №113e: окна по умолчанию focusable:false (не красть фокус у игры) —
  // поля ввода не получали клавиатуру. Renderer включает фокус на focusin
  // и снимает на focusout — WASD игре не воруем.
  captureKeyboard: (want) => ipcRenderer.invoke('keyboard:set', want),

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

  // №91: стартовые билды новичка (сюжет)
  starterList: () => ipcRenderer.invoke('starter:list'),
  starterImport: (klass) => ipcRenderer.invoke('starter:import', klass),
  starterPickAsc: (name) => ipcRenderer.invoke('starter:pick_asc', name),

  treeSearch: (query) => ipcRenderer.invoke('tree:search', query),

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

  /** №85: сообщение от MCP-агента поверх игры (тост): {title, text}. */
  onAgentNotify: (cb) => {
    const listener = (_evt: unknown, msg: { title: string; text: string }) => cb(msg);
    ipcRenderer.on('agent:notify', listener);
    return () => ipcRenderer.removeListener('agent:notify', listener);
  },

  diagCollect: () => ipcRenderer.invoke('diag:collect'),

  panelOpen: (action) => ipcRenderer.invoke('panel:open', action),

  learnInfo: () => ipcRenderer.invoke('learn:info'),

  learnContribute: () => ipcRenderer.invoke('learn:contribute'),

  // №134: окно «⚒ Крафт»
  craftCatalog: () => ipcRenderer.invoke('craft:catalog'),

  craftPlanBuffer: () => ipcRenderer.invoke('craft:plan'),

  currencyRates: (league) => ipcRenderer.invoke('currency:rates', league),

  buildgenMeta: (leagueSlug) => ipcRenderer.invoke('buildgen:meta', leagueSlug),
  buildgenGemData: (chunk) => ipcRenderer.invoke('buildgen:gemdata', chunk),
  // №141: импорт-код связки конструктора (вернёт ok+code, main кладёт в буфер).
  buildgenComboCode: (payload) => ipcRenderer.invoke('buildgen:combocode', payload),
  reloadTradeStats: () => ipcRenderer.invoke('trade:reloadStats'),
};

contextBridge.exposeInMainWorld('poe2k', api);