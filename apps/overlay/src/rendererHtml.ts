/**
 * PoE2 Kit — Windows-оверлей: HTML + CSS + классический скрипт виджета.
 * Рендерер общается с main через preload-мост `window.poe2k`.
 * Скрипт без module-импортов, поэтому грузится из файла без CORS-проблем.
 */
export const rendererHtml = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" />
<title>PoE2 Kit — оверлей</title>
<style>
  :root {
    --bg: rgba(13, 17, 23, 0.86);
    --border: rgba(194, 154, 78, 0.75);
    --fg: #f0e6d2;
    --dim: #a89a83;
    --ok: #3fb950;
    --warn: #d29922;
    --err: #f85149;
    --accent: #c69a52;
    /* Игровая антиква (Fontin-стиль): сериф + капитель + разрядка.
       Palatino Linotype есть на любой Windows — офлайн, без бинарников. */
    --font-display: "Palatino Linotype", "Book Antiqua", Georgia, serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden;
    font-family: "Segoe UI", system-ui, sans-serif; color: var(--fg);
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
  #panel {
    /* Fit-content: растём под контент (autosize в main.ts меряет этот rect —
       inset:0 запинал панель на высоту окна и окно никогда не росло: лог-факт
       setBounds 470x320 при импорте билда, №60). Клэмпа в CSS consciously НЕТ:
       max-height:100%/vh — это проценты от ТЕКУЩЕГО окна = прежний замкнутый
       круг (лог-факт №61: autosize height=140 и дальше тишина). Панель клэмпит
       JS в requestSize по высоте, которую вернул main (кэп workArea). */
    position: absolute; top: 0; left: 0; right: 0;
    /* HUD PoE2: тёмная сталь/пергамент с золотой окантовкой.
       var(--bg) — управляется слайдером прозрачности, оставляем базой. */
    background:
      linear-gradient(180deg, rgba(255, 240, 205, 0.05) 0%, rgba(0,0,0,0) 12%),
      var(--bg);
    border: 1px solid rgba(194, 154, 78, 0.75);
    box-shadow:
      inset 0 0 0 1px rgba(0,0,0,0.55),
      inset 0 1px 0 rgba(255, 224, 168, 0.10),
      0 6px 24px rgba(0,0,0,.6);
    border-radius: 4px;
    padding: 10px 12px;
    display: flex; flex-direction: column;
    gap: 6px;
  }
  /* Ромбы-заклёпки по углам, как на рамках диалогов/панелей игры. */
  #panel::before, #panel::after {
    content: ""; position: absolute; width: 7px; height: 7px;
    background: linear-gradient(135deg, #e8c988, #8a6a33);
    transform: rotate(45deg);
    box-shadow: 0 0 4px rgba(232, 201, 136, 0.5);
    z-index: 1;
  }
  #panel::before { top: -4px; left: -4px; }
  #panel::after { top: -4px; right: -4px; }
  #idle {
    color: var(--dim); font-size: 12px; margin: auto;
    text-align: center; line-height: 1.6;
  }
  #idle b { color: var(--accent); font-family: Consolas, monospace; }
  .hide { display: none !important; }

  /* Цепочка сжатия для локальных скроллов: #body — flex-потомок #panel,
     иначе длинные блоки (билд/списки) выпирают мимо flex:1-наследников. */
  #body { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; overflow: hidden; }

  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
    padding-bottom: 4px; margin-bottom: 2px;
    border-bottom: 1px solid rgba(198,154,82,0.35); }
  .item-name { font-size: 16px; font-weight: 700; color: #fff; line-height: 1.25;
    font-family: var(--font-display); letter-spacing: 0.4px; }
  .item-name .rarity { font-weight: 600; font-size: 11px; }

  .rarity-unique { color: #e6b422; }
  .rarity-rare { color: #f7c873; }
  .rarity-magic { color: #60a5fa; }

  .bld .wornrow { line-height: 1.1; }
  .bld .worn { color: var(--warn); font-size: 11px; padding-top: 0; }
  .rarity-currency { color: #e6b422; }
  .rarity-normal, .rarity-common { color: #e6edf3; }

  .est {
    display: flex; align-items: baseline; gap: 8px;
    padding: 8px 10px; border-radius: 8px;
    background: rgba(198,154,82,0.10); border: 1px solid rgba(198,154,82,0.3);
  }
  .est .value { font-size: 20px; font-weight: 800; color: var(--accent); }
  .est .range { font-size: 12px; color: var(--dim); }
  .est .conf { font-size: 11px; color: var(--dim); }

  .status-busy { color: var(--dim); font-size: 12px; }
  .err-box { color: var(--warn); font-size: 12px; }

  .meta { font-size: 11px; color: var(--dim); }
  .meta .src { color: var(--accent); }

  table.list { width: 100%; font-size: 12px; border-collapse: collapse; margin-top: 2px; }
  table.list td { padding: 3px 6px; border-top: 1px solid rgba(255,255,255,0.06); }
  table.list .num { text-align: right; font-variant-numeric: tabular-nums; }
  #priceBatchWrap { display: flex; flex-direction: column; gap: 4px; min-height: 0; flex: 1; overflow: hidden; }
  #priceBatchHead { font-size: 12px; color: var(--dim); }
  #priceBatchList { flex: 1; overflow-y: auto; min-height: 0; display: flex; flex-direction: column; gap: 4px; }
  .batch-item { border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 6px 8px;
    background: rgba(255,255,255,0.03); }
  .batch-item .bi-name { font-size: 14px; font-weight: 700;
    font-family: var(--font-display); letter-spacing: 0.3px; }
  .batch-item .bi-est { font-size: 16px; font-weight: 800; color: var(--accent); }
  .batch-item .bi-note { font-size: 11px; color: var(--dim); }
  .batch-item .bi-note .err-inline { color: var(--err); }
  .muted { color: var(--dim); font-size: 11px; }
  .batch-ww { cursor: pointer; background: none; border: 1px solid rgba(255,255,255,0.15);
    color: var(--dim); border-radius: 6px; font-size: 11px; padding: 1px 6px; margin-top: 3px; }
  .batch-ww:hover { color: var(--accent); border-color: var(--accent); }

  .watch-btn { display: block; width: 100%; margin-top: 6px; cursor: pointer;
    background: rgba(198,154,82,0.14); border: 1px solid var(--accent); color: var(--accent);
    border-radius: 8px; padding: 5px 10px; font-size: 12px; font-weight: 600; }
  .watch-btn:hover { background: rgba(198,154,82,0.24); }

  .toast { position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
    background: rgba(20,26,34,0.96); border: 1px solid var(--warn); color: #ffe9c2;
    border-radius: 10px; padding: 8px 12px; font-size: 12px; line-height: 1.4;
    box-shadow: 0 6px 20px rgba(0,0,0,.5); z-index: 50; max-width: 90%; }
  .toast b { color: var(--warn); }

  .watch-list { display: flex; flex-direction: column; gap: 4px; max-height: 160px;
    overflow-y: auto; }
  .watch-list .empty { color: var(--dim); font-size: 11px; }
  .wl-row { display: flex; align-items: center; gap: 6px; border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px; padding: 5px 7px; background: rgba(255,255,255,0.03); font-size: 12px; }
  .wl-row .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wl-row .px { font-weight: 700; color: var(--accent); white-space: nowrap; }
  .wl-row .px.off { color: var(--dim); }
  .wl-row button { cursor: pointer; background: none; border: 1px solid rgba(255,255,255,0.15);
    color: var(--dim); border-radius: 6px; font-size: 11px; padding: 1px 7px; }
  .wl-row button:hover { color: var(--accent); border-color: var(--accent); }
  .watch-actions { display: flex; gap: 6px; margin-top: 6px; }
  .watch-actions button { flex: 1; cursor: pointer; background: rgba(198,154,82,0.14);
    border: 1px solid var(--accent); color: var(--accent); border-radius: 8px;
    padding: 4px 8px; font-size: 12px; }
  .watch-actions button:hover { background: rgba(198,154,82,0.24); }

  #diagSection, #learnSection { border-top: 1px solid rgba(255,255,255,0.08); margin-top: 4px; }
  .diag-actions { display: flex; gap: 6px; margin-top: 6px; }
  .diag-actions button { flex: 1; cursor: pointer; background: rgba(198,154,82,0.12);
    border: 1px solid rgba(198,154,82,0.4); color: var(--text); border-radius: 8px;
    padding: 5px 8px; font-size: 12px; }
  .diag-actions button:hover { background: rgba(198,154,82,0.24); }
  .diag-actions button:disabled { opacity: 0.55; cursor: default; }
  #diagOut { margin-top: 6px; font-size: 10px; color: var(--dim); line-height: 1.4;
    word-break: break-all; white-space: pre-line; }

  .lvl-hint { font-size: 13px; line-height: 1.55; }
  .lvl-hint b { color: var(--accent); }
  .lvl-zone { font-size: 15px; font-weight: 700; color: #fff;
    font-family: var(--font-display); letter-spacing: 0.3px; }

  #hint { font-size: 11px; color: var(--dim); margin-top: auto; padding-top: 4px;
    border-top: 1px solid rgba(255,255,255,0.08); }

  /* Полоса перетаскивания: видна только в режиме перемещения (Ctrl+F5). */
  #grab {
    -webkit-app-region: drag;
    user-select: none;
    cursor: move;
    margin: -10px -12px 2px;
    padding: 6px 12px;
    font-size: 12px;
    color: var(--accent);
    background: rgba(198,154,82,0.16);
    border-bottom: 1px solid rgba(198,154,82,0.35);
    border-radius: 10px 10px 0 0;
    text-align: center;
  }
  #grab .reset { -webkit-app-region: no-drag; cursor: pointer; color: var(--dim);
    text-decoration: underline; font-size: 11px; }

  /* Панель билда (Ctrl+F2). */
  /* Скроллит ВЕСЬ блок билда (слоты + дерево + summary): при высоте окна,
     упёршейся в кэп экрана (main.ts overlay:autosize), низ дерева раньше
     обрезался overflow:hidden без возможности доскроллить (доклад друга №60). */
  #buildWrap { display: flex; flex-direction: column; gap: 4px; min-height: 0; flex: 1; overflow-y: auto; padding-right: 4px; }
  #buildSlots { flex: none; } /* больше не отдельный скролл — скроллит wrap */
  #buildHead { font-size: 13px; color: #fff; font-weight: 700;
    font-family: var(--font-display); letter-spacing: 0.3px; }
  #buildHead .sub { font-weight: 400; font-size: 11px; color: var(--dim); }
  #buildBudget { font-size: 12px; color: var(--accent); font-weight: 700; }
  #buildBudget .done { color: var(--ok); font-weight: 400; font-size: 11px; }
  table.bld { width: 100%; font-size: 12px; border-collapse: collapse; }
  table.bld td { padding: 2px 6px 2px 0; border-top: 1px solid rgba(255,255,255,0.06); }
  table.bld .slot { color: var(--dim); white-space: nowrap; max-width: 80px; overflow: hidden;
    text-overflow: ellipsis; }
  table.bld .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 210px; }
  table.bld .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.bld tr.bought td { color: var(--ok); }
  table.bld tr.bought .nm { text-decoration: line-through; }
  #buildSum { font-size: 11px; color: var(--dim); line-height: 1.45; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 3px; }
  #buildSum b { color: var(--fg); }
  #buildSum .gap { color: var(--warn); }
  #buildTree { font-size: 11px; color: var(--dim); line-height: 1.45; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 4px; }
  #buildTree .tnode b { color: var(--fg); }
  #buildTree .tstats { color: #8b95a3; font-size: 10px; }
  #buildTree input { width: 100%; box-sizing: border-box; margin: 4px 0 3px 0; padding: 3px 6px; border: 1px solid #2a3344; border-radius: 4px; background: rgba(0,0,0,0.35); color: var(--fg); font-size: 11px; }
  #buildTree .sub-h { padding-top: 3px; }
  #buildNote { font-size: 12px; color: var(--ok); }
  #buildErr { font-size: 11px; color: var(--warn); }

  /* Окно прайса/прокачки: длинные списки (саппорты, листинги trade2, подсказки
     умений/гемов) скроллятся локально, а не обрезаются кэпом высоты окна (№60).
     НЕ vh: vh = ТЕКУЩЕЕ окно — при росте панели клэмпит контент и окно не
     растёт (лог-факт №61). Только px-константы. */
  #listWrap { max-height: 340px; overflow-y: auto; padding-right: 4px; }
  #lvlWrap { max-height: 560px; overflow-y: auto; padding-right: 4px; }
  #gemsWrap { max-height: 560px; overflow-y: auto; padding-right: 4px; }
  /* №67: полоска сравнения цены с максимумом группы (внутри td, % от ширины). */
  .cmpbar { display: inline-block; height: 8px; background: var(--accent);
    border-radius: 2px; vertical-align: middle; min-width: 2px; }
  .grp { color: #9aa4b0; font-size: 11px; font-weight: normal; }
  .grp b { color: var(--accent); }
  .grp td, td.grp { padding-top: 5px; }
  #buildWrap::-webkit-scrollbar, #listWrap::-webkit-scrollbar,
  #gemsWrap::-webkit-scrollbar,
  #lvlWrap::-webkit-scrollbar, #priceBatchList::-webkit-scrollbar { width: 6px; }
  #buildWrap::-webkit-scrollbar-thumb, #listWrap::-webkit-scrollbar-thumb,
  #gemsWrap::-webkit-scrollbar-thumb,
  #lvlWrap::-webkit-scrollbar-thumb, #priceBatchList::-webkit-scrollbar-thumb {
    background: rgba(198,154,82,0.45); border-radius: 3px; }

  /* Панель настроек (Ctrl+F6). */
  #settingsPanel {
    position: absolute; inset: 0; z-index: 10;
    background: rgba(13,17,23,0.96);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 12px;
    display: flex; flex-direction: column; gap: 8px;
    overflow-y: auto;
  }
  #settingsPanel.hide { display: none; }
  #settingsPanel h3 { margin: 0; font-size: 13px; color: #fff; display: flex;
    justify-content: space-between; align-items: center; }
  #settingsPanel h3 .close { color: var(--dim); cursor: pointer; font-size: 15px;
    background: none; border: none; padding: 0 4px; }
  #settingsPanel h3 .close:hover { color: var(--accent); }
  .set-row { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--fg); }
  .set-row .lbl { display: flex; justify-content: space-between; color: var(--dim); }
  .set-row .lbl var { color: var(--accent); font-style: normal; }
  .set-row input[type=range] { width: 100%; accent-color: var(--accent); }
  /* №82: селект лиги в ⚙ — в стиле полей хоткеев панели. */
  #setLeague { width: 100%; font-size: 11px; padding: 3px 4px; margin-top: 2px;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
    color: var(--fg); border-radius: 5px; cursor: pointer; }
  #setLeague option { background: #1a1208; color: var(--fg); }
  .corner-row { display: flex; gap: 6px; }
  .corner-row button { flex: 1; font-size: 10px; padding: 4px 2px; cursor: pointer;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
    color: var(--dim); border-radius: 6px; }
  .corner-row button.on { background: rgba(198,154,82,0.22); border-color: var(--accent); color: var(--accent); }
  /* №64: вкладки-кнопки — открывают кликом то же, что хоткеи. */
  .tabrow { display: flex; gap: 4px; }
  .tabrow button { flex: 1; font-size: 10px; padding: 4px 2px; cursor: pointer;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
    color: var(--dim); border-radius: 6px; white-space: nowrap; }
  .tabrow button:hover { color: var(--fg); border-color: rgba(198,154,82,0.5); }
  .tabrow button.on { background: rgba(198,154,82,0.22); border-color: var(--accent); color: var(--accent); }
  .hk-grid { display: flex; flex-direction: column; gap: 4px; }
  .hk-grid .hk { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 11px; }
  .hk-grid .hk input { font-size: 11px; font-family: Consolas, monospace; padding: 2px 4px;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
    color: var(--fg); border-radius: 5px; width: 130px; }
  /* №76: подвал действий — sticky на низу скролл-окна: кнопки всегда видны,
     контент настроек крутится под ними (scale 1.25: контент выше окна 480px). */
  .set-actions { display: flex; gap: 6px; margin-top: auto; padding: 6px 0 2px;

    position: sticky; bottom: -10px; margin-bottom: -10px;
    background: rgba(13,17,23,0.96); box-shadow: 0 -6px 10px -6px rgba(0,0,0,0.6); }
  .set-actions button { flex: 1; font-size: 12px; padding: 5px 8px; cursor: pointer;
    border-radius: 6px; border: 1px solid transparent; }
  #settingsSave { background: var(--accent); color: #1a1208; font-weight: 700; }
  #settingsSave:hover { filter: brightness(1.1); }
  #settingsResetHK { background: transparent; color: var(--dim); border-color: rgba(255,255,255,0.2); }
  #settingsPanel .tip { font-size: 10px; color: var(--dim); line-height: 1.4; }
</style>
</head>
<body>
  <div id="panel">
    <div class="tabrow" id="tabRow">
      <button data-tab="price" title="Прайс предмета из буфера (Ctrl+F1)">💰 Прайс</button>
      <button data-tab="build" title="Панель билда (Ctrl+F2)">🛒 Билд</button>
      <button data-tab="gems" title="Камни навыков билда: сетапы и чек-лист">💎 Камни</button>
      <button data-tab="import" title="Импорт PoB-кода из буфера (Ctrl+F3)">📥 Импорт</button>
      <button data-tab="level" title="Прокачка: контекст уровня (Ctrl+F4)">📈 Прокачка</button>
      <button data-tab="maps" title="Крафт плиток смотрителя (Waystones): рецепты и таблица">🧭 Плитки</button>
      <button data-tab="settings" title="Настройки (Ctrl+F6)">⚙</button>
    </div>
    <div id="grab" class="hide">
      ⠿ Тащи меня мышью · <span class="reset" id="resetOffset">сброс</span> · Ctrl+F5 — закрепить
    </div>
    <div id="idle">
      Готово. Нажми <b>Ctrl+F1</b> — прайс предмета из буфера.<br/>
      <b>Ctrl+F3</b> — импорт билда из PoB-кода,<br/>
      <b>Ctrl+F2</b> — шопинг-лист билда.<br/>
      <span style="color:#9aa4b0;font-size:11px">Ссылка на персонажа poe.ninja + Ctrl+F3 — автосинхронизация эквипа.</span>
    </div>
    <div id="body" class="hide">
      <div class="head" id="priceHead">
        <div class="item-name" id="itemName"></div>
      </div>
      <div id="est" class="est hide"></div>
      <div id="buildNote" class="hide"></div>
      <div id="busy" class="status-busy hide">Оценка цены…</div>
      <div id="err" class="err-box hide"></div>
      <div id="meta" class="meta hide"></div>
      <div id="priceBatchWrap" class="hide">
        <div id="priceBatchHead"></div>
        <div id="priceBatchList"></div>
      </div>
      <div id="watchBtnWrap" class="hide">
        <button id="watchBtn" class="watch-btn">👁 Следить за ценой</button>
      </div>
      <div id="toast" class="toast hide"></div>
      <div id="listWrap" class="hide">
        <table class="list" id="list"></table>
      </div>
      <div id="lvlWrap" class="hide">
        <div class="lvl-zone" id="lvlZone"></div>
        <div id="lvlHints"></div>
      </div>
      <div id="gemsWrap" class="hide">
        <div id="gemsContent"></div>
      </div>
      <div id="mapsWrap" class="hide">
        <div id="mapsContent"></div>
      </div>
      <div id="buildWrap" class="hide">
        <div id="buildHead"></div>
        <div id="buildBudget"></div>
        <div id="buildSlots"></div>
        <div id="buildTree"></div>
        <div id="buildSum"></div>
        <div id="buildErr" class="hide"></div>
      </div>
      <div id="hint">Прайс: Ctrl+F1 · Билд: Ctrl+F2 · Импорт: Ctrl+F3 · Прокачка: Ctrl+F4 · Двигать: Ctrl+F5 · Настройки: Ctrl+F6</div>
    </div>
    <div id="settingsPanel" class="hide">
      <h3>⚙ Настройки
        <button class="close" id="settingsClose" title="Закрыть (Ctrl+F6)">✕</button>
      </h3>

      <div class="set-row">
        <div class="lbl"><span>Прозрачность фона</span><var id="setOpacityVal">—</var></div>
        <input type="range" id="setOpacity" min="25" max="100" step="1" value="86" />
      </div>

      <div class="set-row">
        <div class="lbl"><span>Масштаб текста</span><var id="setScaleVal">—</var></div>
        <input type="range" id="setScale" min="70" max="140" step="5" value="100" />
      </div>

      <div class="set-row">
        <div class="lbl"><span>Ширина оверлея</span><var id="setWidthVal">—</var></div>
        <input type="range" id="setWidth" min="280" max="640" step="10" value="420" />
      </div>

      <div class="set-row">
        <div class="lbl"><span>Высота оверлея</span><var id="setHeightVal">—</var></div>
        <input type="range" id="setHeight" min="140" max="1000" step="10" value="480" />
      </div>

      <div class="set-row" id="autoHeightSection">
        <div class="lbl">
          <span>Автоподбор высоты <small>— окно само растёт под контент и меняет размер при переключении панелей</small></span>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;cursor:pointer;margin-top:4px">
            <input type="checkbox" id="setAutoHeight" style="width:auto" />
            <span style="font-size:10px;color:var(--dim)">Включить (окно будет «прыгать»)</span>
          </label>
        </div>
        <div class="tip">Выключено (по умолчанию): высота — по слайдеру выше, длинный билд/списки прокручиваются внутри окна. Включите, если хотите, чтобы окно всегда вмещало весь контент целиком (в пределах экрана).</div>
      </div>

      <div class="set-row">
        <span>Угол прикрепления</span>
        <div class="corner-row" id="cornerRow">
          <button data-corner="top-left">В·л</button>
          <button data-corner="top-right">В·п</button>
          <button data-corner="bottom-left">Н·л</button>
          <button data-corner="bottom-right">Н·п</button>
        </div>
      </div>

      <div class="set-row">
        <span>Лига (для цен и курсов)</span>
        <select id="setLeague"></select>
        <div class="tip">Список — из poe2scout (✦ = актуальная челлендж-лига). Применяется сразу и сохраняется — цены пересчитаются под выбранную лигу.</div>
      </div>

      <div class="set-row">
        <span>Горячие клавиши (Ctrl+F1…F6)</span>
        <div class="hk-grid" id="hkGrid"></div>
        <div class="tip">Формат: <b>Control+F1</b>, <b>Alt+Shift+Q</b>. Пустое поле = стандарт.</div>
      </div>

      <div id="watchlistSection" class="set-row">
        <div class="lbl">
          <span>Watchlist <small>— следить за ценой, алерт при падении</small></span>
        </div>
        <div id="watchList" class="watch-list"></div>
        <div class="watch-actions">
          <button id="watchAddBuffer">➕ Из буфера</button>
          <button id="watchCheckNow">Проверить</button>
        </div>
        <div class="tip">Нажмите <b>Ctrl+C</b> на предмете в игре → «➕ Из буфера», либо кнопкой «👁 Следить» в прайс-токе. Проверка каждые 5 мин, алерт «цена упала с X до Y».</div>
      </div>

      <div class="set-row" id="bindSection">
        <div class="lbl">
          <span>Привязка к окну игры <small>— «осторожный режим»: без Win32-вызовов, позиция по углу экрана</small></span>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;cursor:pointer;margin-top:4px">
            <input type="checkbox" id="setBindWindow" style="width:auto" />
            <span style="font-size:10px;color:var(--dim)">Включена (читает позицию окна игры)</span>
          </label>
        </div>
        <div class="tip">Выключите, чтобы kit не обращался к user32.dll вовсе: оверлей встанет в угол экрана (двигается Ctrl+F5), не будет следовать за окном игры и прятаться при alt-tab.</div>
      </div>

      <div class="set-row" id="gemLangSection">
        <div class="lbl">
          <span>Язык имён камней <small>— имена в панели билда и рекомендациях саппортов</small></span>
          <div style="display:flex;gap:4px;margin-top:4px">
            <button id="gemLangRu" style="font-size:10px">RU</button>
            <button id="gemLangEn" style="font-size:10px">EN</button>
          </div>
        </div>
        <div class="tip">RU — имена как в русском клиенте игры (перевод из офлайн-словаря poe2db). EN — как в PoB.</div>
      </div>

      <div class="set-row" id="autoClipSection">
        <div class="lbl">
          <span>Автопрайс-чек из буфера <small>— проверять новые предметы без Ctrl+F1</small></span>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;cursor:pointer;margin-top:4px">
            <input type="checkbox" id="setAutoClip" style="width:auto" />
            <span style="font-size:10px;color:var(--dim)">Слежение 500мс (opt-in)</span>
          </label>
        </div>
        <div class="tip">Выключено по умолчанию (приватность): пока включено — kit читает буфер обмена каждые 500мс. Реагирует только на клир-текст предметов («Rarity:»), прочие копипасты игнорируются.</div>
      </div>

      <div class="set-row" id="learnSection">
        <div class="lbl">
          <span>Журнал обучения <small>— запоминать структуру предметов (локально)</small></span>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;cursor:pointer;margin-top:4px">
            <input type="checkbox" id="setLearn" style="width:auto" />
            <span id="learnRecords" style="font-size:10px;color:var(--dim)">Включить (opt-in)</span>
          </label>
        </div>
        <div class="diag-actions">
          <button id="learnShareBtn">📤 Поделиться предметами</button>
        </div>
        <div id="learnOut" class="diag-out"></div>
        <div class="tip">Выключено по умолчанию. Пишется только структура предмета (редкость/база/моды), без персонажа и аккаунта, в файл на вашем диске. «Поделиться» копирует готовый текст для issue на SourceCraft — одной вставкой.</div>
      </div>

      <div class="set-row" id="diagSection">
        <div class="lbl"><span>Диагностика</span></div>
        <div class="diag-actions">
          <button id="diagBtn">📋 Отправить диагностику</button>
        </div>
        <div id="diagOut" class="diag-out"></div>
        <div class="tip">Соберёт хвост <b>overlay.log</b> + конфиг машины, скопирует всё в буфер обмена и сохранит файл в userData — готово для вставки в отчёт/issue, файлы искать вручную не нужно.</div>
      </div>

      <div class="set-row">
        <div class="tip">⚠ Сторонний инструмент. GGG не гарантирует безопасность сторонних тулов. Kit ничего не делает за вас в игре: читает буфер и публичные API цен — каждое действие в игре делаете сами вы. Использование — на ваш риск.</div>
        <div class="tip" style="color:var(--dim)">This product isn't affiliated with or endorsed by Grinding Gear Games in any way.</div>
      </div>

      <div class="set-actions">
        <button id="settingsResetHK">Сбросить клавиши</button>
        <button id="settingsSave">Сохранить</button>
      </div>
    </div>
  </div>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setBusy(b) {
    $('busy').classList.toggle('hide', !b);
    $('idle').classList.toggle('hide', b);
    $('body').classList.toggle('hide', b);
  }

  // ─── Watchlist ──────────────────────────────────────────────────────────────
  var watchTarget = null;        // предмет в детальном прайс-виде (для кнопки «Следить»)
  var batchWatchTargets = [];    // предметы в пачке (индекс ↔ data-idx кнопок «Следить»)

  function showToast(msg) {
    var t = $('toast');
    if (!t) return;
    t.innerHTML = msg;
    t.classList.remove('hide');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.classList.add('hide'); }, 3500);
    requestSize();
  }

  function doWatchAdd(t, btn) {
    if (!t || !t.itemText) return;
    window.poe2k.watchAdd({ itemText: t.itemText, label: t.label, rarity: t.rarity }).then(function (r) {
      if (r && r.ok) {
        if (btn) { btn.textContent = '✓ В списке'; btn.disabled = true; }
        showToast('✓ Добавлено в watchlist: ' + esc(t.label));
      } else {
        showToast('Не удалось добавить в watchlist');
      }
    }).catch(function () {});
  }

  // Кнопка «Следить» в детальном прайс-токе.
  $('watchBtn').addEventListener('click', function () { doWatchAdd(watchTarget, this); });

  // Кнопки «Следить» в карточках пачки (делегирование).
  $('priceBatchList').addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('.batch-ww') : null;
    if (!btn || btn.disabled) return;
    var idx = btn.getAttribute('data-idx');
    doWatchAdd(batchWatchTargets[idx], btn);
  });

  // Всплывающий алерт «цена упала с X до Y» из main.
  window.poe2k.onWatchAlert(function (a) {
    if (!a) return;
    var from = Number(a.from), to = Number(a.to), l = String(a.label || 'Предмет');
    var fromTxt = Number.isFinite(from) ? from.toFixed(1) : '—';
    var toTxt = Number.isFinite(to) ? to.toFixed(1) : '—';
    showToast('<b>📉 Цена упала:</b> ' + esc(l) + '<br/>' + fromTxt + ' → ' + toTxt + ' chaos');
  });

  // №85: агент -> оверлей: тост-уведомление поверх игры от MCP-агента.
  window.poe2k.onAgentNotify(function (m) {
    if (!m) return;
    var t = String(m.title || '🤖 Агент');
    var x = String(m.text || '');
    showToast('<b>' + esc(t) + '</b>' + (x ? '<br/>' + esc(x) : ''));
  });

  function refreshWatchlist() {
    window.poe2k.watchList().then(function (r) {
      var entries = (r && r.entries) || [];
      var box = $('watchList');
      if (!box) return;
      if (!entries.length) {
        box.innerHTML = '<div class="empty">Список пуст. Нажмите «👁 Следить» в прайс-токе или «➕ Из буфера».</div>';
        requestSize();
        return;
      }
      box.innerHTML = entries.map(function (e) {
        var px = (e.lastPrice == null) ? '—' : Number(e.lastPrice).toFixed(1) + ' chaos';
        return '<div class="wl-row">' +
          '<span class="nm ' + (e.enabled ? '' : ' off') + '">' + esc(e.label) + (e.enabled ? '' : ' <small>(пауза)</small>') + '</span>' +
          '<span class="px ' + (e.enabled ? '' : ' off') + '">' + px + '</span>' +
          '<button data-act="tg" data-id="' + esc(e.id) + '">' + (e.enabled ? '⏸' : '▶') + '</button>' +
          '<button data-act="rm" data-id="' + esc(e.id) + '" title="Убрать">✕</button>' +
          '</div>';
      }).join('');
      requestSize();
    }).catch(function () {});
  }

  // Управление списком watchlist: пауза/вкл / удалить (делегирование).
  $('watchList').addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('button[data-act]') : null;
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    var id = btn.getAttribute('data-id');
    if (act === 'tg') window.poe2k.watchToggle(id).then(refreshWatchlist);
    else if (act === 'rm') window.poe2k.watchRemove(id).then(refreshWatchlist);
  });

  $('watchAddBuffer').addEventListener('click', function () {
    window.poe2k.watchAddBuffer().then(function (r) {
      refreshWatchlist();
      if (r && r.ok) showToast('✓ Предмет из буфера добавлен в watchlist');
      else showToast('Буфер пуст — нажмите Ctrl+C на предмете в игре');
    }).catch(function () {});
  });

  $('watchCheckNow').addEventListener('click', function () {
    showToast('Проверяю цены watchlist…');
    window.poe2k.watchCheck().then(function () { setTimeout(refreshWatchlist, 900); }).catch(function () {});
  });

  // Авторазмер окна: контент панели изменился — просим main подогнать высоту.
  // Панель не имеет CSS-клэмпа (иначе autosize зацикливается на размере окна,
  // лог-факты №60–61): меряем ЧЕСТНУЮ высоту контента без клэмпа, main возвращает
  // фактическую высоту окна (с учётом кэпа workArea) — ею клэмпим панель, чтобы
  // при кэпе включились локальные скроллы (#buildWrap/#listWrap/#lvlWrap).
  var _sizeTimer = null;
  function requestSize() {
    if (_sizeTimer) clearTimeout(_sizeTimer);
    _sizeTimer = setTimeout(function () {
      var p = document.getElementById('panel');
      var clamped = p.style.maxHeight;
      // Снимаем клэмп ТОЛЬКО на sync-измерение и возвращаем его В ТОЙ ЖЕ
      // задаче JS, ДО отрисовки кадра: асинхронный возврат (№61) держал панель
      // развёрнутой на естественную высоту (билд ~2000px) пару кадров —
      // визуально контент «скачет» (жалоба №63), ResizeObserver зацикливался.
      p.style.maxHeight = 'none';
      var h = Math.ceil(p.getBoundingClientRect().height);
      p.style.maxHeight = clamped || 'none';
      if (h > 40 && window.poe2k.autosize) {
        window.poe2k.autosize(h).then(function (actual) {
          var a = Math.max(0, Math.round(Number(actual) || 0));
          if (a > 0) p.style.maxHeight = a + 'px';
        }).catch(function () {});
      }
    }, 60);
  }
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(requestSize).observe(document.getElementById('panel'));
  }
  requestSize();

  window.poe2k.onPriceBusy(function (b) {
    if (b) setBusy(true);
  });

  // Режим перемещения: показываем полосу перетаскивания и прячем контент.
  window.poe2k.onMoveMode(function (state) {
    var grab = $('grab');
    grab.classList.toggle('hide', !state.unlocked);
    document.body.style.background = state.unlocked ? 'rgba(198,154,82,0.04)' : 'transparent';
    if (state.unlocked) {
      $('idle').classList.remove('hide');
      $('body').classList.add('hide');
    }
  });

  $('resetOffset').addEventListener('click', function () {
    window.poe2k.resetOffset();
  });

  function showMode(mode) {
    // mode: 'price' | 'level' | 'build' — показываем только нужные блоки.
    $('est').classList.toggle('hide', mode !== 'price');
    $('listWrap').classList.toggle('hide', mode !== 'price');
    $('buildNote').classList.toggle('hide', mode !== 'price');
    $('meta').classList.toggle('hide', mode !== 'price');
    $('watchBtnWrap').classList.toggle('hide', mode !== 'price');
    $('lvlWrap').classList.toggle('hide', mode !== 'level');
    $('buildWrap').classList.toggle('hide', mode !== 'build');
    $('gemsWrap').classList.toggle('hide', mode !== 'gems');
    $('mapsWrap').classList.toggle('hide', mode !== 'maps');
  }

  // ─── Вкладка «🧭 Плитки» (№85): крафт плиток смотрителя (Waystones) ────────
  // Статический справочник — факты poe2wiki.net (page 1720, проверено 2026-09-30).
  // Обновляется вручную при патче механик; источник даты — в подвале панели.
  function renderMapsTab() {
    var el = $('mapsContent');
    el.innerHTML =
      '<div class="lvl-hint">Плитки: тиры 1–16, моды до 6 (3 пре + 3 суф), обычная/волшебная/редкая. ' +
      'Моды переносятся на карту при активации.</div>' +
      '<table class="bld">' +
      '<tr><td colspan="4"><b>Самые ценные рецепты</b></td></tr>' +
      '<tr><td class="slot" colspan="4">1️⃣ <b>Тир 16</b> — только коррупцией Т15: 25% шанс «тир ±1» (реролл модов). ' +
      '<span class="sub">Единственный путь к Т16.</span></td></tr>' +
      '<tr class="wornrow"><td></td><td class="worn" colspan="3">Исходы коррупции (каждый 25%): ничего · тир ±1 · ' +
      'лок префиксов+рефж суффиксов (или наоборот, игнор лимита) · лок обоих + 0–4 доп. мода (до 8 всего)</td></tr>' +
      '<tr><td class="slot" colspan="4">2️⃣ <b>Верстак перековки</b>: 3 плитки одинакового тира и редкости → 1 плитка тиром выше. <span class="sub">Стабильный ап-тир без риска.</span></td></tr>' +
      '<tr><td class="slot" colspan="4">3️⃣ <b>Omens</b>: Omen of Chaotic Rarity / Quantity / Monsters — ' +
      'меняют редкость/количество/монстров необычным путём, недоступным базовой валюте. <span class="sub">Ключ к жирным картам.</span></td></tr>' +
      '<tr><td colspan="4" style="padding-top:6px"><b>Возрождения (revives)</b></td></tr>' +
      '<tr><td class="slot" colspan="4">Каждый явный мод плитки = −1 возрождение карты: 6 без модов → 0 при 6+ модах. ' +
      '<span class="sub">Жирная карта = без права на ошибку.</span></td></tr>' +
      '</table>' +
      '<div class="sub" style="color:#9aa4b0;margin-top:6px">Источник: poe2wiki.net «Waystone» (проверено 30.09.2026). ' +
      'Механики меняются патчами — панель обновляется в ките.</div>';
  }
  function showMapsView() {
    $('idle').classList.add('hide');
    $('body').classList.remove('hide');
    var h = $('priceHead');
    if (h) h.classList.remove('hide');
    $('itemName').textContent = '🧭 Крафт плиток смотрителя';
    showMode('maps');
    renderMapsTab();
    requestSize();
  }

  // ─── Вкладка «💎 Камни» (№66): сетапы камней билда — отдельная панель ──────
  // Данные — из payload build:update (gemSetups/gemColors/gemSeen), main не менялся.
  var lastBuildState = null;
  function gemKeySh(n) {
    return String(n || '').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function gemMarkSh(b, en, expLvl) {
    var sv = (b.gemSeen || {})[gemKeySh(en)];
    if (!sv) return '⬜';
    var lvlTxt = sv.level != null ? (' ур.' + sv.level) : '';
    return '<span title="Скопирован ' + (sv.level != null ? 'ур.' + sv.level : '') +
      (expLvl != null ? ' · в билде ур.' + expLvl : '') + '">✅' + lvlTxt + '</span>';
  }
  function gemDotSh(b, n) {
    var c = (b.gemColors || {})[gemKeySh(n)];
    if (!c) return '';
    return c.split(',').map(function (h) { return '<span style="color:' + h + '">●</span>'; }).join('') + ' ';
  }
  function renderGemsTab(b) {
    if (!$('gemsWrap').classList.contains('hide')) {
      $('itemName').textContent = b ? '💎 Камни билда' : '💎 Камни: билд не загружен';
    }
    var el = $('gemsContent');
    if (!b || !b.gemSetups || !b.gemSetups.length) {
      el.innerHTML = '<div class="lvl-hint">Сетапы камней появятся после импорта билда — Ctrl+F3 или вкладка «📥 Импорт».<br/>' +
        'Скопируйте камень навыка (Ctrl+C в окне умений) — он отметится ✅ здесь и в списке.</div>';
      return;
    }
    el.innerHTML = '<div class="lvl-hint">Куда вставлять. Ctrl+C по камню в игре отметит его ✅.</div>' +
      '<table class="bld">' + b.gemSetups.map(function (g) {
        var lvl = g.activeLevel != null ? (' <span class="sub">ур. ' + g.activeLevel + '</span>') : '';
        var html = '<tr><td>' + gemMarkSh(b, g.active, g.activeLevel) + '</td>' +
          '<td class="slot" colspan="3">' + gemDotSh(b, g.active) + '<b>' + esc(g.active) + '</b>' + lvl +
          ' <span class="sub">→ ' + esc(g.where) + '</span></td></tr>';
        if (g.supports && g.supports.length) {
          var sup = g.supports.map(function (s) {
            return '<span>' + gemDotSh(b, s) + gemMarkSh(b, s, null) + ' ' + esc(s) + '</span>';
          }).join(' · ');
          html += '<tr class="wornrow"><td></td><td class="worn" colspan="3">+ ' + sup + '</td></tr>';
        }
        return html;
      }).join('') + '</table>';
  }
  // Клик по вкладке «💎 Камни»: чисто рендерерская панель (без IPC) — данные
  // приходят с build:update; повторный клик обновляет из последнего payload.
  function showGemsView() {
    $('idle').classList.add('hide');
    var h = $('priceHead');
    if (h) h.classList.remove('hide');
    showMode('gems');
    renderGemsTab(lastBuildState);
  }

  // ─── Билд-ассистент (Ctrl+F2 / Ctrl+F3) ─────────────────────────────────────
  var SLOT_RU = {
    'Helm': 'Шлем', 'Body Armour': 'Броня', 'Gloves': 'Перчатки', 'Boots': 'Обувь',
    'Belt': 'Ремень', 'Amulet': 'Амулет', 'Ring': 'Кольцо', 'Ring 1': 'Кольцо 1',
    'Ring 2': 'Кольцо 2', 'Weapon 1': 'Оружие', 'Weapon 2': 'Оружие 2',
    'Weapon 3': 'Оружие 3', 'Gloves 2': 'Перчатки 2', 'Boots 2': 'Обувь 2',
    'Flask': 'Флакон', 'Flask 1': 'Флакон 1', 'Flask 2': 'Флакон 2',
    'Flask 3': 'Флакон 3', 'Flask 4': 'Флакон 4', 'Flask 5': 'Флакон 5'
  };

  function slotRu(s) {
    return SLOT_RU[s] || s || '—';
  }

  function fmtPrice(v) {
    if (v == null) return '…';
    return Number(v) >= 1000
      ? (Number(v) / 1000).toFixed(1) + 'k chaos'
      : Number(v).toFixed(1) + ' chaos';
  }

  // ── Помощник по пассивному дереву: кейнстоуны/нотабли PoB-билда + поиск нод ──
  var treeSearchTimer = null;
  function treeNodeRow(n) {
    var stats = (n.stats || []).slice(0, 2).map(esc).join(' / ');
    var asc = n.ascendancy ? ' <span class="tstats">[' + esc(n.ascendancy) + ']</span>' : '';
    var mark = n.isKeystone ? '⚡ ' : (n.isNotable ? '★ ' : '· ');
    return '<div class="tnode">' + mark + '<b>' + esc(n.name) + '</b>' + asc +
      (stats ? ' <span class="tstats">' + stats + '</span>' : '') + '</div>';
  }
  function renderTreeBlock(t) {
    var host = $('buildTree');
    if (!t || ((!t.keystones || !t.keystones.length) && (!t.notables || !t.notables.length))) {
      host.innerHTML = '';
      return;
    }
    var html = '<div class="sub-h sub">🌳 Дерево билда: ' + t.resolved + '/' + t.total + ' нод' +
      (t.version ? ' (v' + esc(t.version) + ')' : '') +
      (t.missing ? ' <span class="tstats">нераспознанных: ' + t.missing + '</span>' : '') + '</div>';
    if (t.keystones && t.keystones.length) {
      html += '<div class="sub">Кейнстоуны:</div>' + t.keystones.map(treeNodeRow).join('');
    }
    var notables = t.notables || [];
    html += '<div class="sub">Нотабли (' + notables.length + '):</div>';
    if (notables.length > 8) {
      html += '<div id="treeNotList" class="hide">' + notables.map(treeNodeRow).join('') + '</div>' +
        '<div class="tstats"><a href="#" id="treeNotToggle">показать все ' + notables.length + '</a></div>';
    } else if (notables.length) {
      html += notables.map(treeNodeRow).join('');
    }
    html += '<input id="treeSearch" placeholder="Поиск нод: имя или стат (напр. cold damage)">' +
      '<div id="treeResults"></div>';
    host.innerHTML = html;
    var tg = $('treeNotToggle');
    if (tg) {
      tg.onclick = function (ev) {
        ev.preventDefault();
        var list = $('treeNotList');
        list.classList.toggle('hide');
        tg.textContent = list.classList.contains('hide')
          ? 'показать все ' + notables.length
          : 'свернуть';
      };
    }
    var inp = $('treeSearch');
    var res = $('treeResults');
    inp.oninput = function () {
      clearTimeout(treeSearchTimer);
      var q = inp.value.trim();
      if (q.length < 2) {
        res.innerHTML = '';
        return;
      }
      treeSearchTimer = setTimeout(function () {
        window.poe2k.treeSearch(q).then(function (nodes) {
          res.innerHTML = (nodes || []).length
            ? nodes.map(treeNodeRow).join('')
            : '<div class="tstats">ничего не найдено</div>';
        }).catch(function () {});
      }, 250);
    };
    inp.onkeydown = function (ev) { ev.stopPropagation(); };
  }

  function renderBuild(state) {
    var wrap = $('buildWrap');
    var err = $('buildErr');
    var berr = $('buildErr');
    err.classList.add('hide');

    if (!state || !state.build) {
      $('itemName').textContent = 'Билд не загружен';
      if (state && state.error) {
        berr.classList.remove('hide');
        berr.textContent = '⚠ ' + state.error;
      }
      $('buildHead').textContent = '';
      $('buildBudget').textContent = '';
      $('buildSlots').innerHTML = '';
      $('buildSum').textContent = 'Ctrl+F3 — импорт: скопируйте PoB share-код / .build JSON и нажмите.';
      lastBuildState = null;
      renderGemsTab(null);
      return;
    }

    var b = state.build;
    var who = [b.ascendancy || b.className || 'Билд', b.level ? ('ур. ' + b.level) : '']
      .filter(Boolean).join(' · ');
    $('itemName').textContent = '🛒 Шопинг-лист билда';
    $('buildHead').innerHTML = esc(who) +
      (b.skills && b.skills.length
        ? ' <span class="sub">' + esc(b.skills.slice(0, 3).join(', ')) + '</span>'
        : '');

    var done = b.boughtCount + '/' + b.totalSlots + ' собрано';
    $('buildBudget').innerHTML =
      'Бюджет: ' + esc(fmtPrice(b.budgetLeft)) +
      '<span class="done"> · ' + esc(done) +
      (b.pricedCount < b.totalSlots ? ' · оценяется ' + b.pricedCount + '/' + b.totalSlots : '') +
      '</span>';

    // Индикатор автосинхронизации с персонажем poe.ninja.
    if (b.charSync && b.charSync.character) {
      var age = b.charSync.lastSyncAt ? Math.round((Date.now() - b.charSync.lastSyncAt) / 60000) : null;
      $('buildBudget').innerHTML +=
        '<span class="done"> · 🧍 ' + esc(b.charSync.character) +
        (b.charSync.syncing ? ' ⟳' : (age != null ? ' (' + (age < 1 ? 'свежо' : age + ' мин') + ')' : '')) +
        '</span>';
    }

    var rows = (b.slots || []).map(function (s) {
      var icon = s.status === 'bought' ? '✔' : '⬜';
      var price = s.median != null ? fmtPrice(s.median) : (state.pricing ? '…' : '—');
      var row = '<tr class="' + (s.status === 'bought' ? 'bought' : '') + '">' +
        '<td>' + icon + '</td>' +
        '<td class="slot">' + esc(slotRu(s.slot)) + '</td>' +
        '<td class="nm" title="' + esc(s.name) + '">' + esc(s.name) + '</td>' +
        '<td class="num">' + esc(price) + '</td>' +
        '</tr>';
      // Что сейчас надето в этом слоте на персонаже (poe.ninja), если не совпадает.
      if (s.worn && s.status !== 'bought') {
        row += '<tr class="wornrow"><td></td><td></td>' +
          '<td class="worn" colspan="1" title="Надето сейчас (poe.ninja)">↑ носите: ' + esc(s.worn) + '</td>' +
          '<td></td></tr>';
      }
      return row;
    }).join('');
    $('buildSlots').innerHTML = '<table class="bld">' + rows + '</table>';
    // №66: вкладка «💎 Камни» обновляется из того же payload.
    lastBuildState = b;
    renderGemsTab(b);

    // Дерево билда: кейнстоуны/нотабли PoB + поиск по всему дереву (офлайн).
    renderTreeBlock(b.tree);

    var sum = [];
    if (b.summary) {
      if (b.summary.worstEhp != null) {
        sum.push('Слабейший EHP: <b>' + Math.round(b.summary.worstEhp).toLocaleString('ru-RU') +
          '</b> (' + esc(b.summary.worstEhpType) + ')');
      }
      if (b.summary.weaponDps != null && b.summary.weaponDps > 0) {
        sum.push('DPS оружия (' + esc(b.summary.weapon || '?') + '): <b>' +
          Math.round(b.summary.weaponDps).toLocaleString('ru-RU') + '</b>');
      }
      (b.summary.gaps || []).forEach(function (g) {
        sum.push('<span class="gap">⚠ ' + esc(g.description) + '</span>');
      });
    }
    // №85: мост core.advice — диагноз + чек-лист «что чинить/покупать следующим».
    if (b.advice) {
      if (b.advice.classification) sum.push('Диагноз: <b>' + esc(b.advice.classification) + '</b>' +
        ' <span class="sub" style="color:#9aa4b0">(' + esc(b.advice.summary) + ')</span>');
      var PRIO_MARK = { blocking: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
      (b.advice.items || []).slice(0, 3).forEach(function (it) {
        sum.push('<span class="gap">' + (PRIO_MARK[it.priority] || '•') + ' ' + esc(it.title) +
          ' <span class="sub" style="color:#9aa4b0">— ' + esc(it.action) + '</span></span>');
      });
      (b.advice.checklist || []).slice(0, 3).forEach(function (c) {
        sum.push('✔ ' + esc(c));
      });
    }
    if (b.metaSkills && b.metaSkills.length) {
      sum.push('Мета ладдера: ' + b.metaSkills.slice(0, 3).map(function (s) {
        return esc(s.name) + ' ×' + s.count;
      }).join(', '));
    }
    sum.push('<span class="sub" style="color:#9aa4b0">Ctrl+F1 на купленном предмете — отметит слот ✔</span>');
    $('buildSum').innerHTML = sum.join('<br/>');

    if (state.error) {
      berr.classList.remove('hide');
      berr.textContent = '⚠ ' + state.error;
    }
  }

  window.poe2k.onBuildUpdate(function (state) {
    if (!state) return;
    if (!state.visible && !(state.error && !state.build) && !state.info) return;
    setBusy(false);
    $('idle').classList.add('hide');
    $('body').classList.remove('hide');
    $('est').classList.add('hide');
    $('busy').classList.add('hide');
    showMode('build');
    renderBuild(state);
    // Инфо-сообщение (например, «синхронизация включена») — тем же блоком, но без «⚠».
    if (state.info) {
      $('buildErr').classList.remove('hide');
      $('buildErr').textContent = state.info;
    }
  });


  window.poe2k.onLevelResult(function (lvl) {
    if (!lvl) return;
    setBusy(false);
    $('idle').classList.add('hide');
    $('body').classList.remove('hide');
    $('itemName').innerHTML = esc(lvl.summary || 'Персонаж');
    $('err').classList.add('hide');
    $('meta').classList.add('hide');
    showMode('level');

    var zoneEl = $('lvlZone');
    zoneEl.textContent = lvl.zone && (lvl.zone.name || lvl.zone.code)
      ? '📍 ' + (lvl.zone.name || lvl.zone.code)
      : (lvl.available ? 'Зона неизвестна' : '⚠️ ' + (lvl.reason || 'Client.txt не найден'));

    var hints = $('lvlHints');
    hints.innerHTML = '';
    var items = (lvl.hints || []).slice(0, 5);
    for (var i = 0; i < items.length; i++) {
      var d = document.createElement('div');
      d.className = 'lvl-hint';
      d.textContent = items[i].replace('📍 ', '').replace('➡️ ', '➡ ');
      hints.appendChild(d);
    }
    if (!items.length) {
      hints.innerHTML = '<div class="lvl-hint">Подсказок нет — идите вперёд по плану.</div>';
    }
  });

  function priceSingleView() {
    $('priceBatchWrap').classList.add('hide');
    var h = $('priceHead');
    if (h) h.classList.remove('hide');
  }
  function priceBatchView() {
    var h = $('priceHead');
    if (h) h.classList.add('hide');
    $('est').classList.add('hide');
    $('buildNote').classList.add('hide');
    $('meta').classList.add('hide');
    $('listWrap').classList.add('hide');
    $('err').classList.add('hide');
    $('watchBtnWrap').classList.add('hide');
    $('priceBatchWrap').classList.remove('hide');
  }

  // Один предмет из буфера — привычный детальный вид.
  function renderSinglePrice(res) {
    priceSingleView();

    // Название + редкость цветом.
    var name = $('itemName');
    name.classList.remove('rarity-rare','rarity-unique','rarity-magic','rarity-currency','rarity-normal','rarity-common');
    var rar = String(res.rarity || '').toLowerCase();
    name.classList.add('rarity-' + rar);
    name.innerHTML = esc(res.itemName || 'Предмет');

    // Оценка.
    var est = $('est');
    var note = $('buildNote');
    if (res.buildMatch) {
      note.classList.remove('hide');
      note.textContent = '✔ Слот билда: ' + res.buildMatch.slot + ' — отмечен собранным';
      note.title = res.buildMatch.name || '';
    } else {
      note.classList.add('hide');
      note.textContent = '';
    }
    if (res.estimate && res.estimate.median != null) {
      est.classList.remove('hide');
      var conf = res.estimate.confidence === 'exact' ? 'точно' : (res.estimate.confidence === 'approx' ? 'приблизительно' : 'грубо');
      var range = (res.estimate.min != null && res.estimate.max != null)
        ? ' ~' + Number(res.estimate.min).toFixed(1) + '–' + Number(res.estimate.max).toFixed(1) + ' chaos'
        : '';
      est.innerHTML = '<span class="value">' + Number(res.estimate.median).toFixed(1) + ' chaos</span>' +
        '<span class="range">' + esc(range) + '</span>' +
        '<span class="conf">(' + esc(conf) + ')</span>';
      est.querySelector('.range').textContent = '';
    } else {
      est.classList.add('hide');
    }

    // Ошибка (если только парсинг).
    var err = $('err');
    if (res.buildCodeHint) {
      err.classList.remove('hide');
      err.textContent = res.buildCodeHint;
    } else if (res.parseError) {
      err.classList.remove('hide');
      err.textContent = 'Оценка: ' + res.parseError;
    } else if (res.gemCheck) {
      // Гем: не предмет рынка — «не найдено в источниках» не показываем.
      err.classList.add('hide');
      err.textContent = '';
    } else if (!res.estimate) {
      err.classList.remove('hide');
      err.textContent = 'Оценка: не найдено в бесплатных источниках.';
    } else {
      err.classList.add('hide');
    }

    // Мета-источники.
    var meta = $('meta');
    if (res.sources && res.sources.length) {
      meta.classList.remove('hide');
      meta.innerHTML = 'Источники: <span class="src">' + esc(res.sources.join(', ')) + '</span>';
    } else {
      meta.classList.add('hide');
    }

    // Список похожих объявлений ИЛИ рекомендуемые саппорты гема.
    var lw = $('listWrap');
    var list = $('list');
    if (res.gemSupports && res.gemSupports.length) {
      var label = res.sources && res.sources[0] ? res.sources[0] : 'Рекомендуемые саппорты';
      var isMeta = res.gemSupports[0] && res.gemSupports[0].tier === 'meta';
      var srows = res.gemSupports.map(function (r) {
        var mark = r.inBuild ? ' <span class="done">✓ в билде</span>' : '';
        var rankCell = r.rank == null ? '—' : r.rank;
        var dot = r.color ? r.color.split(',').map(function (h) { return '<span style="color:' + h + '">●</span>'; }).join('') + ' ' : '';
        return '<tr><td class="num">' + rankCell + '</td><td colspan="2">' + dot + esc(r.name || r.ru || r.en) + mark + '</td></tr>';
      }).join('');
      var badge = isMeta
        ? '<span class="src" style="color:#7fd18c">⚡ эталон</span>'
        : '<span class="src" style="color:#9aa4b0">базово</span>';
      list.innerHTML =
        '<tr><td colspan="3" style="color:#9aa4b0">Саппорты ' + badge + ' — ' + esc(label) + ':</td></tr>' + srows;
      lw.classList.remove('hide');
    } else if (res.listings && res.listings.length) {
      // №67: сравнение с рынком — листинги сгруппированы по валюте, отсортированы
      // по возрастанию цены, полоска = доля от максимума группы, показана медиана.
      var ls = res.listings.slice().sort(function (a, b) { return (a.price || 0) - (b.price || 0); });
      var groups = {};
      for (var li = 0; li < ls.length; li++) {
        var cur = String(ls[li].currency || '?');
        (groups[cur] = groups[cur] || []).push(ls[li]);
      }
      var curNames = Object.keys(groups).sort(function (a, b) {
        return (groups[a][0].price || 0) - (groups[b][0].price || 0);
      });
      var rows = '';
      for (var gi = 0; gi < curNames.length; gi++) {
        var g = groups[curNames[gi]];
        var gmax = g[g.length - 1].price || 1;
        var gmid = g[Math.floor(g.length / 2)].price;
        // №68: медиана группы в chaos — если core проставил l.chaos (курс известен).
        var chVals = [];
        for (var ck = 0; ck < g.length; ck++) {
          if (g[ck].chaos != null) chVals.push(g[ck].chaos);
        }
        chVals.sort(function (a, b) { return a - b; });
        var chMid = chVals.length
          ? ' · ≈<b style="color:var(--accent)">' + Number(chVals[Math.floor(chVals.length / 2)]).toFixed(1) + '</b> chaos'
          : '';
        rows += '<tr><td colspan="3" class="grp">' + esc(curNames[gi]) +
          ' · предложений: ' + g.length + ' · медиана: <b>' + esc(String(gmid)) + '</b>' + chMid + '</td></tr>';
        for (var gj = 0; gj < g.length; gj++) {
          var l = g[gj];
          var w = Math.max(2, Math.round(((l.price || 0) / gmax) * 100));
          rows += '<tr><td class="num">' + esc(String(l.price)) + '</td>' +
            '<td colspan="2"><span class="cmpbar" style="display:inline-block;width:' + w + '%"></span>' +
            (l.whisper ? ' <span class="sub">' + esc(l.whisper) + '</span>' : '') + '</td></tr>';
        }
      }
      list.innerHTML = '<tr><td colspan="3" style="color:#9aa4b0">Рынок (по возрастанию цены):</td></tr>' + rows;
      lw.classList.remove('hide');
    } else {
      lw.classList.add('hide');
    }

    // Кнопка «Следить»: добавить предмет в watchlist (гемы не прайсятся — прячем).
    var ww = $('watchBtnWrap');
    if (res.itemText && !res.gemCheck) {
      watchTarget = { itemText: res.itemText, label: res.itemName || 'Предмет', rarity: res.rarity };
      ww.classList.remove('hide');
      var wb = $('watchBtn');
      wb.textContent = '👁 Следить за ценой';
      wb.disabled = false;
    } else {
      ww.classList.add('hide');
    }
  }

  // Несколько предметов из буфера — список с оценками в одном виджете.
  function renderBatchPrice(payload) {
    priceBatchView();
    var items = payload.items || [];
    batchWatchTargets = [];
    var head = $('priceBatchHead');
    var total = payload.totalEstimate;
    var headTxt = '📦 Предметов: ' + items.length;
    if (total != null) headTxt += ' · сумма ~' + Number(total).toFixed(1) + ' chaos';
    if (payload.elapsedMs != null) headTxt += ' · ' + Math.round(payload.elapsedMs / 1000) + 'с';
    head.textContent = headTxt;

    var cards = items.map(function (res, i) {
      var rar = String(res.rarity || '').toLowerCase();
      var estTxt;
      if (res.estimate && res.estimate.median != null) {
        var conf = res.estimate.confidence === 'exact' ? '' : (res.estimate.confidence === 'approx' ? ' ~' : ' грубо');
        estTxt = '<span class="value">≈' + Number(res.estimate.median).toFixed(1) + ' chaos</span>' + '<span class="conf">(' + esc(conf) + ')</span>';
      } else {
        estTxt = '<span class="muted">н/д</span>';
      }
      var note = '';
      if (res.buildMatch) {
        note = '<span style="color:var(--ok)">✔ слот: ' + esc(res.buildMatch.slot) + '</span>';
      } else if (res.buildCodeHint) {
        note = '<span class="err-inline">' + esc(res.buildCodeHint) + '</span>';
      } else if (res.parseError) {
        note = '<span class="err-inline">' + esc('Оценка: ' + res.parseError) + '</span>';
      } else if (!res.estimate) {
        note = '<span class="muted">не найдено в бесплатных источниках</span>';
      }
      batchWatchTargets.push(
        res.itemText ? { itemText: res.itemText, label: res.itemName || ('Предмет ' + (i + 1)), rarity: res.rarity } : null,
      );
      if (res.itemText) {
        note = note + '<button class="batch-ww" data-idx="' + i + '">👁 Следить</button>';
      }
      return '<div class="batch-item">' +
        '<div class="bi-name rarity-' + rar + '">' + esc(res.itemName || ('Предмет ' + (i + 1))) + '</div>' +
        '<div class="bi-est">' + estTxt + '</div>' +
        '<div class="bi-note">' + note + '</div>' +
        '</div>';
    }).join('') || '<div class="muted">Пустой буфер.</div>';
    $('priceBatchList').innerHTML = cards;
  }

  window.poe2k.onPriceBatch(function (payload) {
    if (!payload || !payload.items) { setBusy(false); return; }
    setBusy(false);
    $('idle').classList.add('hide');
    $('body').classList.remove('hide');
    showMode('price');
    if (payload.items.length === 1) {
      renderSinglePrice(payload.items[0]);
    } else {
      renderBatchPrice(payload);
    }
  });
// ─── Панель настроек (Ctrl+F6) ─────────────────────────────────────────────
  var setDirty = {};
  var HK_ACTIONS = [
    ['price', 'Прайс'],
    ['leveling', 'Прокачка'],
    ['move', 'Перемещение'],
    ['buildImport', 'Импорт билда'],
    ['buildPanel', 'Панель билда'],
    ['settings', 'Настройки']
  ];
  var hkInputs = {};

  function currentDraft() {
    return {
      corner: document.querySelector('#cornerRow .on')?.getAttribute('data-corner') || 'top-right',
      opacity: Number($('setOpacity').value) / 100,
      scale: Number($('setScale').value) / 100,
      width: Number($('setWidth').value),
      height: Number($('setHeight').value),
      autoHeight: !!$('setAutoHeight').checked,
      learn: !!$('setLearn').checked,
      bindWindow: !!$('setBindWindow').checked,
      autoClipboard: !!$('setAutoClip').checked,
      gemLang: $('gemLangEn').classList.contains('on') ? 'en' : 'ru',
      hotkeys: {}
    };
  }

  function collectHotkeys() {
    var hk = {};
    HK_ACTIONS.forEach(function (a) {
      var v = (hkInputs[a[0]] || {}).value || '';
      if (v) hk[a[0]] = v;
    });
    return hk;
  }

  function buildSettingsPanel(s) {
    setDirty = {};
    // Слайдеры.
    $('setOpacity').value = Math.round((s.opacity || 0.86) * 100);
    $('setScale').value = Math.round((s.scale || 1) * 100);
    $('setWidth').value = Math.round(s.width || 420);
    $('setHeight').value = Math.round(s.height || 480);
    $('setAutoHeight').checked = s.autoHeight === true;
    $('setLearn').checked = !!s.learn;
    $('setAutoClip').checked = !!s.autoClipboard;
    $('setBindWindow').checked = s.bindWindow !== false;
    paintGemLang(s.gemLang === 'en' ? 'en' : 'ru');
    setDirty.opacity = true; setDirty.scale = true; setDirty.width = true; setDirty.height = true;
    window.poe2k.learnInfo().then(function (li) {
      if (!li) return;
      $('learnRecords').textContent = li.enabled
        ? 'Включён · записей: ' + (li.records || 0)
        : 'Включить (opt-in)';
    }).catch(function () {});

    // Угол.
    var corners = document.querySelectorAll('#cornerRow button');
    for (var i = 0; i < corners.length; i++) {
      corners[i].classList.toggle('on', corners[i].getAttribute('data-corner') === s.corner);
    }

    // Хоткеи: поля для каждого действия; значения по умолчанию подсвечены как плейсхолдер.
    var grid = $('hkGrid');
    grid.innerHTML = '';
    hkInputs = {};
    HK_ACTIONS.forEach(function (a) {
      var action = a[0];
      var label = a[1];
      var val = (s.hotkeys && s.hotkeys[action]) || '';
      var def = (s.defaultHotkeys && s.defaultHotkeys[action]) || '';
      var row = document.createElement('div');
      row.className = 'hk';
      row.innerHTML = '<span>' + esc(label) +
        (val === '' ? ' <span class="tip">(' + esc(def) + ')</span>' : '') + '</span>';
      var inp = document.createElement('input');
      inp.placeholder = def;
      inp.value = val;
      inp.spellcheck = false;
      row.appendChild(inp);
      hkInputs[action] = inp;
      grid.appendChild(row);
    });
  }

  function refreshDraftValues() {
    $('setOpacityVal').textContent = Math.round(Number($('setOpacity').value)) + '%';
    $('setScaleVal').textContent = Math.round(Number($('setScale').value)) + '%';
    $('setWidthVal').textContent = Math.round(Number($('setWidth').value)) + ' px';
    $('setHeightVal').textContent = Math.round(Number($('setHeight').value)) + ' px';
  }

  function openSettings() {
    setBusy(false);
    $('idle').classList.add('hide');
    $('body').classList.add('hide');
    $('settingsPanel').classList.remove('hide');
    window.poe2k.settingsGet().then(function (s) {
      if (!s) return;
      buildSettingsPanel(s);
      refreshDraftValues();
      refreshWatchlist();
      refreshLeagueSelect();
      requestSize();
    }).catch(function () {});
  }

  // №82: селект лиги в ⚙. Список — poe2scout через IPC leagues:list (кэш 6 ч);
  // выбор применяется сразу (league:set → league.txt + пересчёт цен под лигу).
  function refreshLeagueSelect() {
    var sel = $('setLeague');
    sel.innerHTML = '<option>Загрузка списка лиг…</option>';
    window.poe2k.leaguesList().then(function (r) {
      var list = (r && r.leagues) || [];
      if (!list.length) {
        sel.innerHTML = '<option>Список недоступен (нет сети?)</option>';
        return;
      }
      var cur = r.current || list[0].name;
      var html = '';
      // Если активная лига не из списка (устарела/кастом) — показываем её сверху, чтобы селект не врал.
      var inList = list.some(function (l) { return l.name === cur; });
      if (!inList) html += '<option selected value="' + esc(cur) + '">' + esc(cur) + ' (текущая)</option>';
      list.forEach(function (l) {
        var lbl = l.name + (l.isCurrent ? ' ✦' : '');
        html += '<option value="' + esc(l.name) + '"' + (l.name === cur ? ' selected' : '') + '>' + esc(lbl) + '</option>';
      });
      sel.innerHTML = html;
    }).catch(function () {
      sel.innerHTML = '<option>Ошибка загрузки списка лиг</option>';
    });
  }

  $('setLeague').addEventListener('change', function () {
    var sel = $('setLeague');
    var v = sel.value;
    if (!v || v.indexOf('…') >= 0 || v.indexOf('недоступен') >= 0 || v.indexOf('Ошибка') >= 0) return;
    window.poe2k.setLeague(v).then(function (saved) {
      showToast('Лига: ' + (saved || v) + ' — цены пересчитаются под неё');
      window.poe2k.watchCheck().catch(function () {}); // watchlist-цены зависят от лиги — перепроверяем.
    }).catch(function () {
      showToast('Не удалось применить лигу');
    });
  });

  function closeSettings() {
    $('settingsPanel').classList.add('hide');
    $('idle').classList.remove('hide');
    requestSize();
  }

  $('settingsClose').addEventListener('click', closeSettings);
  $('settingsSave').addEventListener('click', function () {
    var draft = currentDraft();
    draft.hotkeys = collectHotkeys();
    window.poe2k.settingsApply(draft).then(function (res) {
      if (res && res.ok) {
        closeSettings();
      } else {
        var msg = (res && res.error) || 'Не удалось сохранить';
        $('settingsSave').textContent = '✕ ' + msg;
        setTimeout(function () { $('settingsSave').textContent = 'Сохранить'; }, 2500);
      }
    }).catch(function () {});
  });
  $('settingsResetHK').addEventListener('click', function () {
    HK_ACTIONS.forEach(function (a) { hkInputs[a[0]].value = ''; });
  });
  $('diagBtn').addEventListener('click', function () {
    var btn = $('diagBtn');
    var out = $('diagOut');
    btn.disabled = true;
    btn.textContent = 'Собираю…';
    window.poe2k.diagCollect().then(function (r) {
      if (r && r.ok) {
        out.textContent = '✓ ' + r.chars + ' симв. / ' + r.lines + ' строк — скопировано в буфер.\\nФайл: ' + r.file;
        showToast('Диагностика скопирована в буфер обмена');
      } else {
        out.textContent = 'Ошибка сбора: ' + ((r && r.error) || 'неизвестно');
      }
      btn.disabled = false;
      btn.textContent = '📋 Отправить диагностику';
      requestSize();
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = '📋 Отправить диагностику';
      out.textContent = 'Ошибка вызова диагностики';
      requestSize();
    });
  });
  $('learnShareBtn').addEventListener('click', function () {
    var btn = $('learnShareBtn');
    var out = $('learnOut');
    btn.disabled = true;
    btn.textContent = 'Готовлю…';
    window.poe2k.learnContribute().then(function (r) {
      if (r && r.ok) {
        out.textContent = '✓ ' + r.count + ' предметов — текст скопирован в буфер.\\nТеперь вставьте его в issue: sourcecraft.dev/volkovpartilaholin/poe2-kit/issues/new\\nФайл: ' + r.file;
        showToast('Вклад скопирован — вставьте в issue на SourceCraft');
      } else {
        out.textContent = 'Ошибка: ' + ((r && r.error) || 'неизвестно');
      }
      btn.disabled = false;
      btn.textContent = '📤 Поделиться предметами';
      requestSize();
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = '📤 Поделиться предметами';
      out.textContent = 'Ошибка вызова';
      requestSize();
    });
  });
  ['setOpacity', 'setScale', 'setWidth', 'setHeight'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      setDirty[id] = true;
      refreshDraftValues();
    });
  });
  var cornerBtns = document.querySelectorAll('#cornerRow button');
  for (var ci = 0; ci < cornerBtns.length; ci++) {
    cornerBtns[ci].addEventListener('click', function () {
      for (var c2 = 0; c2 < cornerBtns.length; c2++) cornerBtns[c2].classList.remove('on');
      this.classList.add('on');
      // Угол применяется мгновенно (без «Сохранить»): это дешёвая операция,
      // а её эффект видно только при игре в фокусе — просить ещё и «Сохранить»
      // путает («углы не работают»). Панель не закрываем; остальной draft
      // (слайдеры уже с live-preview) сохраняется тем же флоу, что и Save.
      var draft = currentDraft();
      draft.hotkeys = collectHotkeys();
      window.poe2k.settingsApply(draft).catch(function () {});
    });
  }

  // Язык имён камней: применяется мгновенно (как угол) — это лишь имена в панели.
  var gemLangBtns = { ru: $('gemLangRu'), en: $('gemLangEn') };
  ['ru', 'en'].forEach(function (lang) {
    gemLangBtns[lang].addEventListener('click', function () {
      if (this.classList.contains('on')) return;
      var draft = currentDraft();
      draft.gemLang = lang;
      draft.hotkeys = collectHotkeys();
      window.poe2k.settingsApply(draft).then(function () {
        paintGemLang(lang);
      }).catch(function () {});
    });
  });
  function paintGemLang(lang) {
    gemLangBtns.ru.classList.toggle('on', lang === 'ru');
    gemLangBtns.en.classList.toggle('on', lang === 'en');
  }

  // Открытие/закрытие панели настроек (Ctrl+F6 из main).
  window.poe2k.onSettingsToggle(function () {
    if ($('settingsPanel').classList.contains('hide')) openSettings();
    else closeSettings();
  });

  // №64: вкладки — кликом открывают те же панели, что и хоткеи.
  // Подсветка активной вкладки синхронизируется и с хоткейами (события main).
  var tabBtns = document.querySelectorAll('#tabRow button');
  function setActiveTab(tab) {
    for (var ti = 0; ti < tabBtns.length; ti++) {
      tabBtns[ti].classList.toggle('on', tabBtns[ti].getAttribute('data-tab') === tab);
    }
  }
  function bindTabs() {
    for (var bi = 0; bi < tabBtns.length; bi++) {
      tabBtns[bi].addEventListener('click', function () {
        var tab = this.getAttribute('data-tab');
        setActiveTab(tab);
        if (tab === 'gems') {
          showGemsView(); // локальная панель, IPC не нужен
        } else if (tab === 'maps') {
          showMapsView(); // №85: статический справочник крафта плиток, IPC не нужен
        } else {
          window.poe2k.panelOpen(tab).catch(function () {});
        }
      });
    }
  }
  bindTabs();
  // №65: клики по оверлею. Окно по умолчанию click-through
  // (setIgnoreMouseEvents(true,{forward:true}), main.ts) — ВСЕ кнопки UI
  // (вкладки/✕/слайдеры) были некликабельны вне режима Ctrl+F5. С forward:true
  // рендерею приходят mouseenter/mouseleave: курсор над оверлеем → включаем
  // интерактив, ушёл → выключили и снова не мешаем игре. Move-режим (там
  // интерактивом управляет main) не трогаем.
  var winUnlocked = false;
  window.poe2k.onMoveMode(function (st) { winUnlocked = !!(st && st.unlocked); });
  document.addEventListener('mouseenter', function () {
    if (winUnlocked) return;
    window.poe2k.setInteractive(true).catch(function () {});
  });
  document.addEventListener('mouseleave', function () {
    if (winUnlocked) return;
    window.poe2k.setInteractive(false).catch(function () {});
  });
  // Хоткей-пути красят ту же вкладку: параллельные слушатели событий main.
  window.poe2k.onPriceBatch(function () { setActiveTab('price'); });
  window.poe2k.onLevelResult(function () { setActiveTab('level'); });
  window.poe2k.onBuildUpdate(function (st) { setActiveTab(st && st.visible ? 'build' : ''); });
  window.poe2k.onSettingsToggle(function () {
    setActiveTab($('settingsPanel').classList.contains('hide') ? '' : 'settings');
  });

  // Применение настроек отображения из main (прозрачность/масштаб/ширина/угол).
  window.poe2k.onSettingsDisplay(function (s) {
    if (!s) return;
    // Прозрачность фона панели (свой --bg альфа), текст остаётся читаемым.
    var alpha = (typeof s.opacity === 'number' ? s.opacity : 0.86);
    document.documentElement.style.setProperty('--bg', 'rgba(13,17,23,' + alpha.toFixed(2) + ')');
    // Масштаб UI через zoom (учитывается в авторазмере высоты).
    var z = (typeof s.scale === 'number' ? s.scale : 1);
    var panel = $('panel');
    if (typeof panel.style.zoom === 'string') panel.style.zoom = String(z);
    else panel.style.transform = 'scale(' + z + ')';
    // Обновляем элементы панели настроек, если она открыта.
    if (!$('settingsPanel').classList.contains('hide')) {
      buildSettingsPanel({
        corner: s.corner, opacity: alpha, scale: z,
        width: (typeof s.width === 'number' ? s.width : 420),
        hotkeys: {}, defaultHotkeys: {}
      });
      refreshDraftValues();
    }
    requestSize();
  });
})();
</script>
</body>
</html>`;