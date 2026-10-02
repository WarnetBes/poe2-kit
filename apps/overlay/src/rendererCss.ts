/**
 * PoE2 Kit overlay — CSS оверлея (этап S1 разноса rendererHtml.ts).
 * Извлечён дословно из монолита 02.10.2026: ни один байт стилей не менялся
 * (доказательство: byte-diff emitted HTML до/после выноса, см. журнал №186).
 * В rendererHtml.ts вставляется как `<style>${OVERLAY_CSS}</style>`.
 *
 * ПРАВИЛО ФАЙЛА: только CSS в export-тилде. Изменения стилей — здесь,
 * не в rendererHtml.ts. Внутри запрещены бэктики и ${ (границы нарезки
 * проверяются генератором/смоками).
 */

export const OVERLAY_CSS = `
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
    /* №113: кнопки-вкладки — вертикальная колонка сбоку (была сверху — 8 кнопок
       перестали влезать в ширину). #panel теперь row: слева .tabrow, справа #content. */
    display: flex; flex-direction: row;
    gap: 8px;
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

  /* №103 Campaign Companion: маршрут акта */
  .camp-head { font-size: 13px; font-weight: 700; color: var(--accent); margin: 8px 0 2px; }
  .camp-prog { height: 5px; background: rgba(255,255,255,0.10); border-radius: 3px;
    overflow: hidden; margin: 4px 0 6px; }
  .camp-prog i { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
  .camp-row { padding: 4px 6px; border-radius: 6px; margin-bottom: 3px;
    border-left: 3px solid transparent; }
  .camp-row.done { opacity: 0.55; border-left-color: #4caf7d; }
  .camp-row.current { background: rgba(198,154,82,0.14); border-left-color: var(--accent); }
  .camp-row.todo { border-left-color: rgba(255,255,255,0.18); }
  .camp-zname { font-size: 13px; font-weight: 700; color: #fff; }
  .camp-row.done .camp-zname { color: var(--dim); text-decoration: line-through; }
  .camp-meta { font-size: 11px; color: var(--dim); margin-left: 6px; font-weight: 400; }
  .camp-badge { display: inline-block; font-size: 10px; padding: 0 5px; margin-left: 4px;
    border-radius: 6px; background: rgba(76,175,125,0.18); color: #7ddba8; }
  .camp-wp { color: var(--accent); font-size: 11px; margin-left: 4px; }
  .camp-note { font-size: 11px; color: var(--dim); line-height: 1.45; margin-top: 1px; }
  .camp-actnote { font-size: 11px; color: var(--dim); line-height: 1.5; margin: 6px 0 4px;
    border-top: 1px dashed rgba(255,255,255,0.12); padding-top: 4px; white-space: pre-line; }
  .camp-boss { display: inline-block; font-size: 10px; padding: 0 5px; margin-left: 4px;
    border-radius: 6px; background: rgba(200,80,80,0.20); color: #e8a0a0; }

  /* №104 Бестиарий боссов */
  .boss-sec { margin-top: 10px; }
  .boss-grp-title { font-size: 12px; font-weight: 700; color: var(--dim);
    margin: 8px 0 2px; text-transform: uppercase; letter-spacing: 0.5px; }
  .boss-entry { padding: 3px 6px 5px; margin-bottom: 4px; border-radius: 6px;
    background: rgba(255,255,255,0.04); border-left: 3px solid rgba(200,80,80,0.45); }
  .boss-entry.boss-cur { border-left-color: var(--accent); }
  .boss-name { font-size: 13px; font-weight: 700; color: #fff; }
  .boss-sub { font-size: 11px; color: var(--dim); line-height: 1.4; }
  .boss-tip { font-size: 11px; color: var(--dim); line-height: 1.45; }

  /* №109: неподтверждённые записи — приглушённо */
  .boss-entry.boss-unverified { opacity: 0.55; border-left-color: rgba(160,160,160,0.35); }

  .boss-unv-mark { display: inline-block; font-size: 10px; padding: 0 5px; margin-left: 4px;
    border-radius: 6px; background: rgba(160,160,160,0.18); color: var(--dim); }

  /* №143: таймер босса текущей зоны */
  .boss-timer { margin-top: 6px; padding: 4px 6px; border-radius: 6px;
    background: rgba(127,201,127,0.08); border: 1px dashed rgba(127,201,127,0.45); }

  /* №108: чек-лист квестовых наград */
  .quest-row { padding: 3px 6px 4px; border-radius: 6px; background: rgba(255,255,255,0.04);
    border-left: 3px solid rgba(120,170,255,0.45); margin-bottom: 4px; }
  .quest-row.quest-missed { border-left-color: rgba(230,160,60,0.6); }
  .quest-claim { display: inline-block; font-size: 10px; padding: 1px 6px; margin-left: 4px;
    border-radius: 6px; background: rgba(120,170,255,0.18); color: #a8c8ff; cursor: pointer;
    border: 0; }
  .quest-warn { font-size: 11px; color: #e8b45a; line-height: 1.4; }

  /* №111: чек-лист пиннакла */
  .pin-row { padding: 3px 6px 4px; border-radius: 6px; background: rgba(255,255,255,0.04);
    margin-bottom: 4px; font-size: 12px; }
  .pin-pass { color: #7fd18c; }
  .pin-fail { color: #e08585; }
  .pin-unknown { color: var(--dim); }
  .pin-detail { font-size: 11px; color: var(--dim); line-height: 1.4; }

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
  #listWrap { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 4px; }
  #lvlWrap { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 4px; }
  #gemsWrap { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 4px; }
  /* №113d: эти три врапа вообще не имели скролла (Плитки — большая таблица):
     низ срезался #body{overflow:hidden}. Единый паттерн как у #buildWrap. */
  #mapsWrap, #pinnacleWrap, #importWrap, #slangWrap, #craftWrap, #ratesWrap, #genWrap {
    display: flex; flex-direction: column; gap: 4px;
    min-height: 0; flex: 1 1 auto; overflow-y: auto; padding-right: 4px; }
  /* №67: полоска сравнения цены с максимумом группы (внутри td, % от ширины). */
  .cmpbar { display: inline-block; height: 8px; background: var(--accent);
    border-radius: 2px; vertical-align: middle; min-width: 2px; }
  .grp { color: #9aa4b0; font-size: 11px; font-weight: normal; }
  .grp b { color: var(--accent); }
  .grp td, td.grp { padding-top: 5px; }
  /* №106: бейдж привязки к оружейному набору */
  .wset-badge { font-size: 10px; font-weight: 700; color: var(--warn);
    border: 1px solid var(--warn); border-radius: 6px; padding: 1px 5px; cursor: help; }
  #buildWrap::-webkit-scrollbar, #listWrap::-webkit-scrollbar,
  #gemsWrap::-webkit-scrollbar, #mapsWrap::-webkit-scrollbar,
  #pinnacleWrap::-webkit-scrollbar, #importWrap::-webkit-scrollbar,
  #slangWrap::-webkit-scrollbar, #craftWrap::-webkit-scrollbar, #ratesWrap::-webkit-scrollbar,
  #genWrap::-webkit-scrollbar,
  #lvlWrap::-webkit-scrollbar, #priceBatchList::-webkit-scrollbar { width: 6px; }
  #buildWrap::-webkit-scrollbar-thumb, #listWrap::-webkit-scrollbar-thumb,
  #gemsWrap::-webkit-scrollbar-thumb, #mapsWrap::-webkit-scrollbar-thumb,
  #pinnacleWrap::-webkit-scrollbar-thumb, #importWrap::-webkit-scrollbar-thumb,
  #slangWrap::-webkit-scrollbar-thumb, #craftWrap::-webkit-scrollbar-thumb,
  #ratesWrap::-webkit-scrollbar-thumb, #genWrap::-webkit-scrollbar-thumb,
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
  /* №91: кнопки стартовых билдов новичка (на пустой панели билда). */
  .starter-row { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 8px; }
  .starter-btn { font-size: 10px; padding: 4px 7px; cursor: pointer; color: var(--fg);
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 5px; }
  .starter-btn:hover { background: rgba(255,255,255,0.14); }
  .starter-btn.on { background: rgba(200,150,60,0.35); border-color: var(--accent); }
  .starter-info { margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.12); }
  .corner-row { display: flex; gap: 6px; }
  .corner-row button { flex: 1; font-size: 10px; padding: 4px 2px; cursor: pointer;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
    color: var(--dim); border-radius: 6px; }
  .corner-row button.on { background: rgba(198,154,82,0.22); border-color: var(--accent); color: var(--accent); }
  /* №105: пипетки цветов доступности */
  .color-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
  .color-row label { font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px; cursor: pointer; }
  .color-row input[type="color"] { width: 28px; height: 20px; padding: 0; border: 1px solid rgba(255,255,255,0.25);
    border-radius: 4px; background: transparent; cursor: pointer; }
  .color-row button { font-size: 10px; padding: 3px 8px; cursor: pointer; background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.15); color: var(--dim); border-radius: 6px; }
  /* №64: вкладки-кнопки — открывают кликом то же, что хоткеи. */
  /* №113: боковая колонка вкладок — вертикальный ряд кнопок во всю высоту. */
  /* №144: 11+ вкладок — колонка сама скроллится при нехватке высоты панели,
     а длинные подписи обрезаются многоточием вместо выпирания поверх контента. */
  .tabrow { display: flex; flex-direction: column; gap: 4px; flex: 0 0 auto;
    justify-content: flex-start; width: 88px; min-height: 0;
    overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; }
  .tabrow button { font-size: 10px; padding: 5px 4px; cursor: pointer; white-space: nowrap;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
    color: var(--dim); border-radius: 6px; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; }
  .tabrow button:hover { color: var(--fg); border-color: rgba(198,154,82,0.5); }
  .tabrow button.on { background: rgba(198,154,82,0.22); border-color: var(--accent); color: var(--accent); }
  .tabrow button.info-btn { margin-top: 6px; border-style: dashed; color: #9aa4b0; }
  /* №128: инфоокно функции — «что делает эта вкладка» */
  #infoWin { position: absolute; left: 0; right: 0; top: 0; bottom: 0; z-index: 60;
    background: rgba(12,14,18,0.97); overflow-y: auto; padding: 10px 12px; font-size: 12px; }
  #infoWin .h2 { font-weight: bold; color: var(--accent); margin-bottom: 6px; font-size: 13px; }
  #infoWin .hk { display: inline-block; border: 1px solid var(--accent); border-radius: 3px;
    padding: 0 4px; font-size: 10px; color: var(--accent); }
  #infoWin li { margin: 3px 0 3px 14px; }
  #infoWin .close-info { float: right; cursor: pointer; color: #9aa4b0; }
  #infoWin .sub { color: #9aa4b0; }
  /* №132: кнопки прокрутки панели (детерминированный скролл мышью —
     колесо над нефокусируемым click-through окном не гарантировано) */
  #scrollCtl { position: absolute; right: 2px; bottom: 2px; display: flex;
    flex-direction: column; gap: 2px; z-index: 30; opacity: 0.55; }
  #scrollCtl:hover { opacity: 1; }
  #scrollCtl button { width: 20px; height: 20px; font-size: 10px; line-height: 1;
    cursor: pointer; background: rgba(20,24,32,0.85); color: var(--accent);
    border: 1px solid rgba(198,154,82,0.5); border-radius: 4px; padding: 0; }
  #scrollCtl button:hover { background: rgba(198,154,82,0.25); }
  /* №133: словарь слэнга */
  .slang-row { display: flex; flex-direction: column; gap: 1px; padding: 4px 2px;
    border-bottom: 1px solid rgba(255,255,255,0.07); }
  .slang-term { color: var(--accent); font-weight: 700; font-size: 12px; }
  .slang-def { color: #cfd6df; font-size: 11px; line-height: 1.35; }
  .slang-hint { color: var(--dim); font-size: 10px; margin: 2px 0 4px; }
  /* №129: чипсы-фильтр нод — поиск мышью без клавиатуры */
  .tree-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 2px 0; }
  .tree-chips .chip { font-size: 10px; padding: 3px 6px; cursor: pointer; white-space: nowrap;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
    color: var(--dim); border-radius: 9px; }
  .tree-chips .chip:hover { color: var(--fg); border-color: rgba(198,154,82,0.5); }
  .tree-chips .chip.on { background: rgba(198,154,82,0.22); border-color: var(--accent); color: var(--accent); }
  /* №113: правая часть панели — бывшие прямые потомки #panel (grab/idle/body/settings). */
  #content { display: flex; flex-direction: column; gap: 6px; flex: 1 1 auto; min-width: 0; position: relative; }
  .hk-grid { display: flex; flex-direction: column; gap: 4px; }
  /* №113b: чекбоксы видимости вкладок. */
  .tabs-grid { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 4px; }
  .tabs-grid label { display: flex; align-items: center; gap: 5px; font-size: 11px;
    font-weight: 400; cursor: pointer; color: var(--fg); }
  .tabs-grid input { width: auto; }
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
`;
