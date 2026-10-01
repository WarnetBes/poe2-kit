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
  .tabrow { display: flex; flex-direction: column; gap: 4px; flex: 0 0 auto;
    justify-content: flex-start; width: 88px; }
  .tabrow button { font-size: 10px; padding: 5px 4px; cursor: pointer; white-space: nowrap;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
    color: var(--dim); border-radius: 6px; white-space: nowrap; }
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
      <button data-tab="slang" title="Словарь игрового слэнга PoE2: сокращения и жаргон — по-человечески">📖 Слэнг</button>
      <button data-tab="craft" title="Окно крафта: план по предмету (Ctrl+C в игре), все рецепты 0.5.5, эссенции и омены">⚒ Крафт</button>
      <button data-tab="rates" title="Курсы валют по лигам: сколько стоит валюта в chaos (poe2scout + poe.ninja)">💱 Курс</button>
      <button data-tab="gen" title="Генератор билдов: живые билды топ-игроков poe.ninja по всем классам — скиллы, узлы, DPS/EHP">🧬 Билды</button>
      <button data-tab="pinnacle" title="Чекап перед пиннаклом: резисты/EHP/стан (Ctrl+F7)">🛡 Пиннакл</button>
      <button data-tab="settings" title="Настройки (Ctrl+F6)">⚙</button>
      <button class="info-btn" id="tabInfoBtn" title="Что делает активная вкладка — окно с описанием функции и хоткеями">ℹ ?</button>
    </div>
    <div id="content">
    <div id="infoWin" class="hide"></div>
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
      <div id="augLine" class="meta hide"></div>
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
        <div id="campWrap"></div>
        <div id="lvlHints"></div>
      </div>
      <div id="gemsWrap" class="hide">
        <div id="gemsContent"></div>
      </div>
      <div id="mapsWrap" class="hide">
        <div id="mapsContent"></div>
      </div>
      <div id="slangWrap" class="hide">
        <div id="slangContent"></div>
      </div>
      <div id="craftWrap" class="hide">
        <div id="craftContent"></div>
      </div>
      <div id="ratesWrap" class="hide">
        <div id="ratesContent"></div>
      </div>
      <div id="genWrap" class="hide">
        <div id="genContent"></div>
      </div>
      <div id="pinnacleWrap" class="hide">
        <div id="pinnacleContent"></div>
      </div>
      <div id="scrollCtl">
        <button id="scrlUp" title="Прокрутить панель вверх (замена колеса мыши, если оно над оверлеем не работает)">▲</button>
        <button id="scrlDn" title="Прокрутить панель вниз">▼</button>
      </div>
      <div id="buildWrap" class="hide">
        <div id="buildHead"></div>
        <div id="buildBudget"></div>
        <div id="buildSlots"></div>
        <div id="buildTree"></div>
        <div id="buildSum"></div>
        <div id="buildErr" class="hide"></div>
      </div>
      <div id="importWrap" class="hide">
        <div id="importContent"></div>
      </div>
      <div id="hint">Прайс: Ctrl+F1 · Билд: Ctrl+F2 · Импорт: Ctrl+F3 · Прокачка: Ctrl+F4 · Двигать: Ctrl+F5 · Настройки: Ctrl+F6 · Пиннакл: Ctrl+F7</div>
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

      <div class="set-row" id="tabsSection">
        <div class="lbl">
          <span>Вкладки панели <small>— скрыть неиспользуемые кнопки из боковой колонки</small></span>
          <div class="tabs-grid" id="tabsGrid"></div>
        </div>
        <div class="tip">Как у аналогов: отмечено = кнопка видна, снято = скрыта (сама функция остаётся доступной по хоткею). «⚙ Настройки» скрыть нельзя — иначе теряется управление.</div>
      </div>

      <div class="set-row">
        <span>Лига (для цен и курсов)</span>
        <select id="setLeague"></select>
        <div class="tip">Список — из poe2scout (✦ = актуальная челлендж-лига). Применяется сразу и сохраняется — цены пересчитаются под выбранную лигу.</div>
      </div>

      <div class="set-row">
        <div class="lbl"><span>🎨 Цвета <small>— доступность: дальтонизм, контраст</small></span></div>
        <div class="corner-row" id="themeRow">
          <button data-theme="default" title="Стандартная тема kit">Обычная</button>
          <button data-theme="contrast" title="Чёрный фон, белый текст — максимальный контраст">Контраст</button>
          <button data-theme="cb" title="Палитра Okabe-Ito: безопасна при красно-зелёной и сине-жёлтой слепоте (статусы различимы и по светлоте)">Дальтонизм</button>
          <button data-theme="custom" title="Свои цвета — пипетки ниже">Свои</button>
        </div>
        <div class="color-row">
          <label>Фон <input type="color" id="setColBg" value="#0d1117" /></label>
          <label>Текст <input type="color" id="setColFg" value="#f0e6d2" /></label>
          <label>Второстеп. <input type="color" id="setColDim" value="#a89a83" /></label>
          <label>Акцент <input type="color" id="setColAccent" value="#c69a52" /></label>
          <button id="setColReset" title="Вернуть стандартную тему">↺ Сброс</button>
        </div>
        <div class="tip">Применяется сразу. При проблемах восприятия цвета пробуйте «Дальтонизм» (универсальная палитра Okabe-Ito) или «Контраст». «Свои» — точечная настройка фона/текста пипетками; статусы (✅/⚠/✕) меняет только тема.</div>
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
    </div><!-- /#content №113 -->
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
    var fromTxt = Number.isFinite(from) ? fmtChaosNum(from) : '—';
    var toTxt = Number.isFinite(to) ? fmtChaosNum(to) : '—';
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
        var px = (e.lastPrice == null) ? '—' : fmtChaosNum(e.lastPrice) + ' chaos';
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
    // mode: 'price' | 'level' | 'build' | 'gems' | 'maps' | 'pinnacle' | 'slang' | 'craft' | 'rates' | 'gen' | 'import' — показываем только нужные блоки.
    $('est').classList.toggle('hide', mode !== 'price');
    $('augLine').classList.toggle('hide', mode !== 'price');
    $('listWrap').classList.toggle('hide', mode !== 'price');
    $('buildNote').classList.toggle('hide', mode !== 'price');
    $('meta').classList.toggle('hide', mode !== 'price');
    $('watchBtnWrap').classList.toggle('hide', mode !== 'price');
    $('lvlWrap').classList.toggle('hide', mode !== 'level');
    $('buildWrap').classList.toggle('hide', mode !== 'build');
    $('gemsWrap').classList.toggle('hide', mode !== 'gems');
    $('mapsWrap').classList.toggle('hide', mode !== 'maps');
    $('pinnacleWrap').classList.toggle('hide', mode !== 'pinnacle');
    $('slangWrap').classList.toggle('hide', mode !== 'slang');
    $('craftWrap').classList.toggle('hide', mode !== 'craft');
    $('ratesWrap').classList.toggle('hide', mode !== 'rates');
    $('genWrap').classList.toggle('hide', mode !== 'gen');
    $('importWrap').classList.toggle('hide', mode !== 'import');
    updateScrollCtl();
  }

  // ─── №132: детерминированная прокрутка панели мышью (кнопки ▲/▼) ──────────
  // Живой репорт: колесо над оверлеем не прокручивает панель Билда —
  // окно нефокусируемое/click-through, доставка wheel-событий не гарантирована.
  // Кнопки работают во ВСЕХ режимах с локальным скроллом и не зависят от фокуса.
  var SCROLL_WRAPS = ['buildWrap', 'listWrap', 'lvlWrap', 'gemsWrap', 'mapsWrap', 'pinnacleWrap', 'slangWrap', 'craftWrap', 'ratesWrap', 'genWrap', 'importWrap'];
  function activeScrollWrap() {
    for (var i = 0; i < SCROLL_WRAPS.length; i++) {
      var el = $(SCROLL_WRAPS[i]);
      if (el && !el.classList.contains('hide') && el.scrollHeight > el.clientHeight + 20) return el;
    }
    return null;
  }
  function updateScrollCtl() {
    var ctl = $('scrollCtl');
    if (!ctl) return;
    ctl.classList.toggle('hide', !activeScrollWrap());
  }
  (function () {
    var ctl = $('scrollCtl');
    if (!ctl) return;
    var SCROLL_STEP_PX = 220; // ~ треть высоты панели за клик
    $('scrlUp').addEventListener('click', function () {
      var w = activeScrollWrap();
      if (w) w.scrollBy({ top: -SCROLL_STEP_PX, behavior: 'smooth' });
    });
    $('scrlDn').addEventListener('click', function () {
      var w = activeScrollWrap();
      if (w) w.scrollBy({ top: SCROLL_STEP_PX, behavior: 'smooth' });
    });
  })();
  // Телеметрия №132: приходят ли wheel-события в renderer вообще (первое за
  // сессию пишем в консоль → overlay.log через console-message дубликатор).
  var wheelSeen = false;
  document.addEventListener('wheel', function (ev) {
    if (!wheelSeen) {
      wheelSeen = true;
      console.log('[overlay] renderer: wheel дошёл (deltaY=' + (ev.deltaY || 0) + ', режим=' + (winUnlocked ? 'move' : 'hover') + ')');
    }
  }, { passive: true, capture: true });
  // Контент в врапе вырос/скролл появился — перепроверяем кнопки.
  if (typeof ResizeObserver !== 'undefined') {
    var ro2 = new ResizeObserver(function () { updateScrollCtl(); });
    SCROLL_WRAPS.forEach(function (id) {
      var el = $(id);
      if (el) ro2.observe(el);
    });
  }

  // ─── Вкладка «📥 Импорт» (№101): собственный вью вместо прыжка на «Билд» ─────
  // Раньше клик по табу сразу запускал runBuildImport и onBuildUpdate
  // переключал showMode('build') — друг читал это как «вкладку перекинуло».
  // Теперь таб показывает инструкцию/результат; запуск — кнопкой или Ctrl+F3.
  var importResult = null; // последний build:update от импорта (для повтора клика)
  function showImportView() {
    $('idle').classList.add('hide');
    $('body').classList.remove('hide');
    var h = $('priceHead');
    if (h) h.classList.remove('hide');
    showMode('import');
    var el = $('importContent');
    var html =
      '<div class="sub-h sub">📥 Импорт билда из буфера обмена</div>' +
      '<div class="lvl-hint">Скопируйте <b>PoB share-код</b>, ссылку профиля poe.ninja или .build JSON и нажмите кнопку ниже (или <b>Ctrl+F3</b>).</div>' +
      '<button class="watch-btn" id="importRun" style="margin:4px 0 6px">📥 Импортировать из буфера (Ctrl+F3)</button>';
    if (importResult) {
      if (importResult.error) {
        html += '<div class="err-box">⚠ ' + esc(importResult.error) + '</div>';
      } else if (importResult.ok) {
        html += '<div class="lvl-hint">✅ Импортировано: <b>' + esc(importResult.ok) +
          '</b><br/><span class="sub">Панель слотов — во вкладке «🛒 Билд» (Ctrl+F2).</span></div>';
      }
    } else if (lastBuildState && lastBuildState.slots && lastBuildState.slots.length) {
      html += '<div class="lvl-hint">Текущий билд: <b>' + esc(String(lastBuildState.className || '?')) + '</b>, ' +
        lastBuildState.slots.length + ' слотов — будет заменён новым импортом.</div>';
    }
    el.innerHTML = html;
    $('importRun').addEventListener('click', function () {
      el.innerHTML = '<div class="status-busy">Импорт из буфера…</div>';
      window.poe2k.panelOpen('import').catch(function () {});
    });
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
      '<div class="lvl-hint">🎯 Персональный план: скопируйте Waystone-плитку в игре (Ctrl+C) и нажмите Ctrl+F1 — ' +
      'кит покажет крафт-план под её тир (3:1 перековка / коррупция Т15→Т16 омены/качество).</div>' +
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

  // ─── Вкладка «📖 Слэнг» (№133): словарь игрового слэнга/сокращений ─────────
  // Жаргон PoE2 по-человечески: что говорят в чатах/гайдах и что это значит.
  // Только устоявшиеся термины сообщества; разделы переключаются чипсами
  // (паттерн №129 — мышь, без клавиатуры). Фильтр-чипсы + таблица.
  var SLANG_SECTIONS = [
    ['all', 'Все'],
    ['stats', 'Билд и статы'],
    ['craft', 'Крафт и валюта'],
    ['combat', 'Бой и карты'],
    ['trade', 'Трейд'],
    ['general', 'Общее'],
  ];
  // [ термин, пояснение по-человечески, раздел ]
  var SLANG_GLOSSARY = [
    ['CI', 'Chaos Inoculation — ключевая пассивка «Хаос-прививка»: жизнь становится 1, но хаос-урон её не пробивает; живём на энергетическом щите (ЭС).', 'stats'],
    ['ЭС / ES', 'Energy Shield — энергетический щит: «дополнительная жизнь» поверх ХП, восстанавливается после паузы в получении урона.', 'stats'],
    ['EHP', 'Effective HP — «эффективная жизнь»: сколько урона ты реально выдержишь с учётом щита, резистов и блока. Не то же, что голое ХП.', 'stats'],
    ['HP / ХП', 'Hit Points — жизнь персонажа. «Пул ХП» = общий запас жизни+щита.', 'stats'],
    ['Резист / кап резистов', 'Сопротивление урону (огонь/холод/молния/хаос). Максимум 75% — «кап»; добить до 75% — базовая защита в эндгейме.', 'stats'],
    ['ilvl', 'item level — уровень предмета (виден в деталях). Определяет, какие аффиксы могут выпасть на предмете при крафте.', 'stats'],
    ['T1 / тир', 'Tier — «ряд» аффикса. T1 — самый сильный вариант мода, дальше T2, T3 и т.д. «Тир-мод» = мод определённого уровня силы.', 'stats'],
    ['DPS', 'Damage Per Second — урон в секунду. Теоретический показатель силы билда.', 'stats'],
    ['APS', 'Attacks Per Second — скорость атаки (ударов/кастов в секунду).', 'stats'],
    ['MS', 'Movement Speed — скорость бега. Базовая кап-скорость на сапогах — главное качество жизни.', 'stats'],
    ['MF', 'Magic Find — «магический поиск»: шанс найти лучшие предметы. У нас это IIR/IIQ (количество/качество предметов).', 'stats'],
    ['AOE', 'Area of Effect — радиус действия/площадь эффекта умения.', 'stats'],
    ['AoE-урон', 'см. AOE — урон по площади.', 'stats'],
    ['PoB', 'Path of Building — внелинейный планировщик билдов: собираешь билд на бумаге, видишь статы до покупки. PoB-код — текстовый импорт такого билда.', 'general'],
    ['Крафт', 'Изготовление/улучшение предмета: сламы, эссенции, оммены, руны — любой способ переделать предмет под себя.', 'craft'],
    ['Слэм / slam', 'Использовать орб-экзальт (Exalted Orb) или аналог — «шлёпнуть» новый случайный мод на предмет. Ставка на удачу.', 'craft'],
    ['Якорь / пул', 'Якорить мод = «залочить» нужный аффикс, чтобы он не затёрся при следующем крафте. Пул = набор возможных модов, которые могут выпасть.', 'craft'],
    ['Фракчер / fractured', '«Треснувший» предмет с одним зафиксированным (неизменяемым) модом — экономит шаги крафта.', 'craft'],
    ['Коррупт / Vaal', 'Испортить предмет через Corruption: необратимо, может дать сильный скрытый мод или испортить вещь. Назад дороги нет.', 'craft'],
    ['Эссенция', 'Essence — валютный предмет: «запечатывает» случайный мод на базе, превращая её в крафтованную вещь. Частый способ добить резисты/жизнь.', 'craft'],
    ['Омен', 'Omen — «знамение»: валютный предмет, который вмешивается в крафт (меняет результат следующего крафт-действия, например сохраняет моды от затирания).', 'craft'],
    ['Руна', 'Rune — вставляется в предмет с гнездом под руну, даёт мод. Выбирай под билд (резист/жизнь/урон).', 'craft'],
    ['Сокет', 'Socket — гнездо (под руну или камень, в завис. от предмета).', 'craft'],
    ['Хаос-орб', 'Chaos Orb — валюта: меняет НЕ-выбранные моды предмета на случайные. И валюта «деньги» трейда.', 'craft'],
    ['Сфера/орб превращения', 'Orb of Transmutation — превращает белый предмет в синий (магический) с 1-2 модами. База любого крафта.', 'craft'],
    ['Augment / ауги', 'Orb of Augmentation — добавляет один мод на предмет, где есть свободный слот под мод.', 'craft'],
    ['Алхимика', 'Orb of Alchemy — превращает белый предмет в жёлтый (редкий) с несколькими модами.', 'craft'],
    ['Рекрафт / reforge', 'Перекрафтить — заново переделать моды предмета (слот-машина, старые моды теряются).', 'craft'],
    ['Атлас', 'Атлас — глобальная карта эндгейма: сеть Waystone-карт, боссов и механик.', 'combat'],
    ['Waystone / плитка', 'Предмет-ключ на следующую карту («камень пути»). «Плитки» — сленговое название в нашей панели.', 'combat'],
    ['Пиннакл-босс', 'Pinnacle boss — финальные боссы игры (вершина контента): Uбер-версии мощнее обычных. «Убер» = усиленная финальная версия.', 'combat'],
    ['Моб / пачка', 'Монстр; «пачка» — группа монстров. «Зачистить пачку» = убить группу.', 'combat'],
    ['Аффикс-мобы', 'Монстры с модификаторами (усиленные, с аурой и т.п.).', 'combat'],
    ['Гейтить', 'Требовать порог статов/билда для входа в контент («не ходи к боссу без 75% резистов» — гейтинг).', 'general'],
    ['One-shot / ваншот', 'Убить с одного удара (тебя убили с одного удара — «ваншотнуло»).', 'combat'],
    ['Клатч / clutch', 'Действие, сделанное в последний момент и спасшее ситуацию («клатч-спасение»).', 'general'],
    ['SSF', 'Solo Self-Found — режим «всё сам»: без трейда, только добытое своими руками.', 'general'],
    ['HC / SC', 'Hardcore (жизнь одна, смерть = конец лиги персонажа) / Softcore (обычный режим, после смерти респавнишься).', 'general'],
    ['Лига', 'Сезон: несколько месяцев с новой механикой и свежей экономикой, потом стартует новая.', 'general'],
    ['Фарм/гринд', 'Повторять выгодную активность ради лута/валюты.', 'general'],
    ['Мета', 'Meta — набор самых сильных текущих билдов/умений (most effective tactics available).', 'general'],
    ['Twink / твинк', 'Персонаж, которого качают с финансовой/гир-поддержкой другого персонажа.', 'general'],
    ['WTB / WTS', 'Want To Buy / Want To Sell — «куплю» / «продаю» в трейд-чатах.', 'trade'],
    ['WTT', 'Want To Trade — обмен предметами (без валюты).', 'trade'],
    ['B/O / buyout', 'Buyout — цена «покупаю сразу», без торга.', 'trade'],
    ['C/O', 'Current Offer — текущая лучшая ставка (аукцион).', 'trade'],
    ['~b/o 5c', 'Цена покупки — 5 хаос-орбов (c = chaos).', 'trade'],
    ['c / ex / div', ' Chaos Orb / Exalted Orb / Divine Orb — основная валюта-деньги трейда (div — самая крупная).', 'trade'],
    ['price-check', 'Оценка рыночной стоимости предмета (наша панель 💰 Прайс делает это по API).', 'trade'],
  ];
  var slangFilter = 'all';
  function renderSlangTab() {
    var host = $('slangContent');
    if (!host) return;
    var chips = SLANG_SECTIONS.map(function (s) {
      return '<button class="tree-chip' + (slangFilter === s[0] ? ' on' : '') +
        '" data-sf="' + s[0] + '">' + s[1] + '</button>';
    }).join('');
    var rows = SLANG_GLOSSARY
      .filter(function (e) { return slangFilter === 'all' || e[2] === slangFilter; })
      .sort(function (a, b) { return a[0].toLowerCase() < b[0].toLowerCase() ? -1 : 1; })
      .map(function (e) {
        return '<div class="slang-row"><div class="slang-term">' + e[0] + '</div>' +
          '<div class="slang-def">' + e[1] + '</div></div>';
      }).join('');
    host.innerHTML =
      '<div class="tree-chips" id="slangChips">' + chips + '</div>' +
      '<div class="slang-hint">Слэнг и сокращения PoE2 — по-человечески. Разделы — мышкой.</div>' +
      rows;
    var ch = host.querySelectorAll('#slangChips .tree-chip');
    for (var i = 0; i < ch.length; i++) {
      ch[i].addEventListener('click', function () {
        slangFilter = this.getAttribute('data-sf');
        renderSlangTab();
      });
    }
  }
  function showSlangView() {
    $('idle').classList.add('hide');
    $('body').classList.remove('hide');
    var h = $('priceHead');
    if (h) h.classList.remove('hide');
    $('itemName').textContent = '📖 Словарь слэнга PoE2';
    showMode('slang');
    renderSlangTab();
    requestSize();
  }

  // ─── Вкладка «⚒ Крафт» (№134): план + каталог рецептов в одном окне ────────
  // UX-паттерн друга: только мышь (чипсы/кнопки), никакого ввода с клавиатуры.
  // Данные — из ядра poe2-kit по IPC (единый источник правды craftGuide.ts):
  // каталог статичен → кэшируем ответ один раз за сессию.
  var CRAFT_SYSTEMS = [
    ['all', 'Все'],
    ['currency', 'Валюта'],
    ['essence', 'Эссенции'],
    ['omen', 'Омены'],
    ['rune', 'Руны/сокеты'],
    ['quality', 'Качество'],
    ['bench', 'Верстаки'],
    ['desecration', 'Дезекрация'],
    ['special', 'Спец'],
    ['waystone', 'Плитки'],
  ];
  var craftCatalog = null; // кэш ответа craft:catalog
  var lastCraftPlan = null; // №134: последний успешный план — переживает переключения под-вью
  var craftSub = 'plan';   // plan | recipes | essences | omens
  var craftSysFilter = 'all';
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function craftSubChips() {
    var subs = [['plan', '🎯 План'], ['recipes', '📋 Рецепты'], ['essences', '💧 Эссенции'], ['omens', '🔮 Омены']];
    return '<div class="tree-chips">' + subs.map(function (s) {
      return '<button class="tree-chip' + (craftSub === s[0] ? ' on' : '') +
        '" data-cs="' + s[0] + '">' + s[1] + '</button>';
    }).join('') + '</div>';
  }
  function renderCraftPlan(craftData) {
    // craftData: последний успешный ответ craft:plan (или null)
    if (!craftData) {
      return '<div class="lvl-hint">Наведи на предмет в игре → <b>Ctrl+C</b> → нажми кнопку ниже: ' +
        'кит составит пошаговый план «двух якорей» под этот слот' +
        ' (резисты/ЭС — эссенциями, орбы — с оменами, руны — в сокеты).</div>';
    }
    var rows = (craftData.plan || []).map(function (s, i) {
      return '<div class="slang-row"><div class="slang-term">' + (i + 1) + '. ' + esc(s.step) + '</div>' +
        '<div class="slang-def">' + esc(s.detail) + '</div></div>';
    }).join('');
    var ess = (craftData.essences || []).slice(0, 6).map(function (e) {
      return '<button class="tree-chip" title="' + esc(e.guaranteed) + '">' + esc(e.ru || e.en) + '</button>';
    }).join('');
    return '<div class="slang-hint">Предмет: <b>' + esc(craftData.name) + '</b>' +
      (craftData.ilvl ? ' · ilvl ' + esc(craftData.ilvl) : '') + '</div>' + rows +
      (ess ? '<div class="slang-hint">Эссенции под этот слот (наведи — мод):</div>' +
        '<div class="tree-chips">' + ess + '</div>' : '');
  }
  function renderCraftView(craftData) {
    var host = $('craftContent');
    if (!host) return;
    var html = craftSubChips();
    if (craftSub === 'plan') {
      html += renderCraftPlan(craftData) +
        '<button id="craftPlanBtn" class="tabbtn" style="margin-top:6px">📋 План по предмету (буфер обмена)</button>' +
        '<div class="slang-hint">Порядок: Ctrl+C по предмету в игре → кнопка. План обновится под этот предмет.</div>';
    } else if (craftSub === 'recipes') {
      var cat = craftCatalog;
      if (!cat || !cat.ok) {
        html += '<div class="lvl-hint">Каталог загружается… если не появился — см. overlay.log.</div>';
      } else {
        html += '<div class="tree-chips">' + CRAFT_SYSTEMS.map(function (s) {
          return '<button class="tree-chip' + (craftSysFilter === s[0] ? ' on' : '') +
            '" data-csys="' + s[0] + '">' + s[1] + '</button>';
        }).join('') + '</div>';
        var list = cat.recipes.filter(function (r) {
          return craftSysFilter === 'all' || r.system === craftSysFilter;
        });
        html += list.map(function (r) {
          return '<div class="slang-row"><div class="slang-term">' + esc(r.name) + '</div>' +
            '<div class="slang-def">' + esc(r.recipe) +
            (r.ssfNote ? ' <span style="color:var(--dim)">SSF: ' + esc(r.ssfNote) + '</span>' : '') +
            '</div></div>';
        }).join('');
        html += '<div class="slang-hint">Всего рецептов в базе: ' + cat.recipes.length +
          ' · источник: crafting_knowledge_base.md (0.5.5).</div>';
      }
    } else if (craftSub === 'essences') {
      var cat2 = craftCatalog;
      if (!cat2 || !cat2.ok) {
        html += '<div class="lvl-hint">Каталог загружается…</div>';
      } else {
        html += cat2.essences.map(function (e) {
          return '<div class="slang-row"><div class="slang-term">' + esc(e.ru || e.en) +
            (e.ru ? ' <span style="color:var(--dim)">' + esc(e.en) + '</span>' : '') + '</div>' +
            '<div class="slang-def">' + esc(e.guaranteed) +
            ' · ' + (e.action === 'magicToRare' ? 'Magic → Rare + мод' : 'Rare: заменить мод') +
            (e.perfect ? ' <span style="color:var(--dim)">Perfect: ' + esc(e.perfect) + '</span>' : '') +
            '</div></div>';
        }).join('');
        html += '<div class="lvl-hint">' + esc(cat2.perfectHint) + '</div>';
        if (cat2.specEssences && cat2.specEssences.length) {
          html += '<div class="lvl-group" style="margin:6px 0"><div class="lvl-title" style="color:#c88">Спец-эссенции (Rare: удалить мод + гарантированный)</div>' +
            cat2.specEssences.map(function (e) {
              return '<div class="slang-row"><div class="slang-term">' + esc(e.en) + '</div>' +
                '<div class="slang-def">' + esc(e.perSlot) + '</div></div>';
            }).join('') + '</div>';
        }
        if (cat2.alloys && cat2.alloys.length) {
          html += '<div class="lvl-group" style="margin:6px 0"><div class="lvl-title" style="color:#c88">Alloys (Экспедиция, Runes of Aldur; занимает crafted-слот)</div>' +
            cat2.alloys.map(function (e) {
              return '<div class="slang-row"><div class="slang-term">' + esc(e.en) + '</div>' +
                '<div class="slang-def">' + esc(e.perSlot) + '</div></div>';
            }).join('') + '</div>';
        }
      }
    } else if (craftSub === 'omens') {
      var cat3 = craftCatalog;
      if (!cat3 || !cat3.ok) {
        html += '<div class="lvl-hint">Каталог загружается…</div>';
      } else {
        html += cat3.omens.map(function (o) {
          return '<div class="slang-row"><div class="slang-term">' + esc(o.en) + '</div>' +
            '<div class="slang-def">' + esc(o.purpose) +
            (o.drop ? ' <span style="color:var(--dim)">[' + esc(o.drop) + ']</span>' : '') +
            '</div></div>';
        }).join('');
        html += '<div class="slang-hint">Омены активируются ДО применения валюты и действуют на ОДНУ операцию. ' +
          'Крафтовые (Ritual) стакаются; часть отключена от дропа — помечена ⚠️. Полная таблица: poe2db.tw/us/Omen.</div>';
      }
    }
    host.innerHTML = html;
    // Кнопки под-вью
    var subBtns = host.querySelectorAll('[data-cs]');
    for (var i = 0; i < subBtns.length; i++) {
      subBtns[i].addEventListener('click', function () {
        craftSub = this.getAttribute('data-cs');
        renderCraftView(craftData);
      });
    }
    // Чипсы-фильтр систем рецептов
    var sysBtns = host.querySelectorAll('[data-csys]');
    for (var j = 0; j < sysBtns.length; j++) {
      sysBtns[j].addEventListener('click', function () {
        craftSysFilter = this.getAttribute('data-csys');
        renderCraftView(craftData);
      });
    }
    // План по буферу
    var planBtn = host.querySelector('#craftPlanBtn');
    if (planBtn) planBtn.addEventListener('click', function () {
      planBtn.textContent = '⏳ Читаю буфер…';
      window.poe2k.craftPlanBuffer().then(function (res) {
        if (!res || !res.ok) {
          craftLastError = (res && res.error) || 'Ошибка плана (см. overlay.log)';
          renderCraftView(null);
          return;
        }
        craftLastError = null;
        lastCraftPlan = res;
        renderCraftView(res);
      }).catch(function (err) {
        craftLastError = 'IPC error: ' + err;
        renderCraftView(null);
      });
    });
  }
  var craftLastError = null;
  function showCraftView() {
    $('idle').classList.add('hide');
    $('body').classList.remove('hide');
    var h = $('priceHead');
    if (h) h.classList.remove('hide');
    $('itemName').textContent = '⚒ Крафт: план и рецепты';
    showMode('craft');
    if (craftLastError) {
      var host = $('craftContent');
      if (host) host.innerHTML = craftSubChips() + '<div class="lvl-hint" style="color:#e08080">' + craftLastError + '</div>';
      craftLastError = null; // показали один раз
    } else {
      renderCraftView(lastCraftPlan);
    }
    requestSize();
    // Каталог нужен для вью рецептов/эссенций/оменов — тянем один раз за сессию.
    if (!craftCatalog) {
      window.poe2k.craftCatalog().then(function (res) {
        craftCatalog = res;
        if (craftSub !== 'plan') renderCraftView(null);
      }).catch(function (err) {
        console.warn('[overlay] renderer: craft:catalog failed: ' + err);
      });
    }
  }

  // ─── Вкладка «💱 Курс» (№135): курсы валют по лигам ────────────────────────
  // IPC currency:rates (main): лиги чипсами (✦ — актуальная), таблица
  // валюта → chaos (+divine и тренд ▲/▼, если poe.ninja отдаёт sparkline).
  // Кэш main 10 мин; в renderer держим последний ответ для мгновенного рендера.
  var ratesData = null;   // последний ответ currency:rates
  var ratesLeague = null; // выбранная лига (чипс)
  function fmtChaos(v) {
    if (v == null) return '—';
    if (v >= 100) return v.toFixed(0);
    if (v >= 1) return v.toFixed(2);
    if (v >= 0.01) return v.toFixed(2);
    return '<0.01';
  }
  function renderRatesView() {
    var host = $('ratesContent');
    if (!host) return;
    if (!ratesData || !ratesData.ok) {
      host.innerHTML = '<div class="lvl-hint">' +
        (ratesData && ratesData.error ? ratesData.error : 'Загружаю курсы валют…') + '</div>';
      return;
    }
    var leagues = ratesData.leagues || [];
    var chips = '<div class="tree-chips">' + leagues.map(function (l) {
      return '<button class="tree-chip' + (ratesLeague === l.name ? ' on' : '') +
        '" data-league="' + esc(l.name) + '">' + (l.isCurrent ? '✦ ' : '') + esc(l.name) + '</button>';
    }).join('') + '</div>';
    var rows = (ratesData.rates || []).map(function (r) {
      var tr = r.trend == null ? '' :
        ' <span style="color:' + (r.trend > 0 ? '#e08080' : '#7fc97f') + '">' +
        (r.trend > 0 ? '▲+' : r.trend < 0 ? '▼' : '') + r.trend.toFixed(1) + '%</span>';
      var dv = r.divine != null ? ' <span style="color:var(--dim)">' + r.divine.toFixed(1) + ' div</span>' : '';
      // №138-ter: RU-имя (из словаря poe2db) + EN рядом приглушённо; нет RU — только EN.
      var nm = r.ru && r.ru.toLowerCase() !== String(r.name).toLowerCase()
        ? esc(r.ru) + ' <span style="color:#9aa4b0">' + esc(r.name) + '</span>'
        : esc(r.name);
      return '<div class="slang-row"><div class="slang-term">' + nm + '</div>' +
        '<div class="slang-def">' + fmtChaos(r.chaos) + ' chaos' + dv + tr + '</div></div>';
    }).join('');
    host.innerHTML = chips +
      '<div class="slang-hint">Лига: <b>' + esc(ratesData.league) + '</b> · ' +
      (ratesData.cached ? 'кэш' : 'свежие данные') + ' · источник: poe2scout + poe.ninja</div>' +
      (rows || '<div class="lvl-hint">Для этой лиги нет данных о валютах.</div>');
    var btns = host.querySelectorAll('[data-league]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        ratesLeague = this.getAttribute('data-league');
        loadRates();
      });
    }
  }
  function loadRates() {
    var host = $('ratesContent');
    if (host) host.innerHTML = '<div class="lvl-hint">Загружаю курсы (' + (ratesLeague || 'актуальная лига') + ')…</div>';
    window.poe2k.currencyRates(ratesLeague || undefined).then(function (res) {
      ratesData = res;
      if (res && res.ok && !ratesLeague) ratesLeague = res.league;
      renderRatesView();
    }).catch(function (err) {
      ratesData = { ok: false, error: 'IPC error: ' + err };
      renderRatesView();
    });
  }
  function showRatesView() {
    $('idle').classList.add('hide');
    $('body').classList.remove('hide');
    var h = $('priceHead');
    if (h) h.classList.remove('hide');
    $('itemName').textContent = '💱 Курсы валют по лигам';
    showMode('rates');
    // Первый вход: грузим; повторный (другая вкладка → назад) — рисуем кэш.
    if (ratesData) renderRatesView();
    else loadRates();
    requestSize();
  }

  // ─── Вкладка «🧬 Билды» (№136): генератор по ладдеру poe.ninja ────────────
  // IPC buildgen:meta (main): один запрос ладдера → группировка по классам:
  // частые скиллы/ключевые узлы, медианные DPS/EHP, топ-3 примера. Ни один
  // «совет» не выдуман — всё из живых билдов топ-игроков.
  var genData = null;   // последний ответ buildgen:meta
  var genLeague = null; // выбранный slug лиги
  var genClass = null;  // выбранный класс (чипс)
  function renderGenView() {
    var host = $('genContent');
    if (!host) return;
    // №139: два режима — мета ладдера и конструктор связок.
    if (genMode === 'combo') { renderComboView(); return; }
    if (!genData || !genData.ok) {
      host.innerHTML = '<div class="lvl-hint">' +
        (genData && genData.error ? genData.error : 'Загружаю мета билдов…') + '</div>';
      return;
    }
    var lc = (genData.slugs || []).map(function (s) {
      return '<button class="tree-chip' + (genLeague === s ? ' on' : '') +
        '" data-genslug="' + esc(s) + '">' + esc(s) + '</button>';
    }).join('');
    var cc = (genData.classes || []).map(function (c) {
      return '<button class="tree-chip' + (genClass === c.label ? ' on' : '') +
        '" data-genclass="' + esc(c.label) + '">' + esc(c.label) + ' <span style="color:var(--dim)">' + c.count + '</span></button>';
    }).join('');
    var cls = genData.classes.find(function (c) { return c.label === genClass; });
    var body = '';
    if (cls) {
      body += '<div class="slang-hint"><b>' + esc(cls.label) + '</b> · ' + cls.count + ' билдов · медианные <b>DPS ' +
        (cls.medianDps || '—') + '</b> / <b>EHP ' + (cls.medianEhp || '—') + '</b></div>';
      body += '<div class="lvl-group" style="margin:4px 0"><div class="lvl-title" style="color:#c88">Скиллы (частые)</div>' +
        cls.topSkills.map(function (s) {
          return '<div class="slang-row"><div class="slang-term">' + esc(s.name) + '</div><div class="slang-def">×' + s.count + '</div></div>';
        }).join('') + '</div>';
      if (cls.topPassives && cls.topPassives.length) {
        body += '<div class="lvl-group" style="margin:4px 0"><div class="lvl-title" style="color:#c88">Ключевые узлы (частые)</div>' +
          cls.topPassives.map(function (p) {
            return '<div class="slang-row"><div class="slang-term">' + esc(p.name) + '</div><div class="slang-def">×' + p.count + '</div></div>';
          }).join('') + '</div>';
      }
      body += '<div class="lvl-group" style="margin:4px 0"><div class="lvl-title" style="color:#c88">Примеры (топ по уровню)</div>' +
        cls.top.map(function (t) {
          return '<div class="slang-row"><div class="slang-term">ур.' + t.level + ' · ' + esc(String(t.name)) + '</div>' +
            '<div class="slang-def">DPS ' + t.dps + ' · EHP ' + t.ehp + '<br><span style="color:var(--dim)">' +
            (t.skills || []).map(esc).join(', ') + '</span></div></div>';
        }).join('') + '</div>';
    } else {
      body = '<div class="lvl-hint">Выбери класс чипсом выше — покажу, что играют топы: скиллы, узлы, DPS/EHP.</div>';
    }
    host.innerHTML =
      genModeChips() +
      '<div class="tree-chips">' + lc + '</div>' +
      '<div class="slang-hint">Выборка: ' + genData.sample + ' билдов · ' + (genData.cached ? 'кэш' : 'свежие данные') + ' · poe.ninja</div>' +
      '<div class="tree-chips">' + cc + '</div>' + body;
    var s1 = host.querySelectorAll('[data-genslug]');
    for (var i = 0; i < s1.length; i++) {
      s1[i].addEventListener('click', function () {
        genLeague = this.getAttribute('data-genslug');
        genClass = null; // классы меняются вместе с лигой
        loadGen();
      });
    }
    var s2 = host.querySelectorAll('[data-genclass]');
    for (var j = 0; j < s2.length; j++) {
      s2[j].addEventListener('click', function () {
        genClass = this.getAttribute('data-genclass');
        renderGenView();
      });
    }
    bindGenMode(host);
  }
  // ─── №139: «🔗 Конструктор связок» — актив + саппорты, фильтр по типам ─────
  // Данные: офлайн-датасет (skillTypes у активов, compatible_with у саппортов),
  // RU-имена гемов — верифицированный gemsRuEn. Совпадения — чистая арифметика
  // по датасету, ничего не выдумано. Саппорты совместимы по attack/spell.
  var genMode = 'meta';          // 'meta' | 'combo'
  var comboData = null;          // ответ buildgen:gemdata (офлайн, на сессию)
  var comboTags = [];            // выбранные EN-теги (AND-фильтр)
  var comboSel = [];             // EN-имена выбранных активных (макс 5)
  var comboSups = {};            // EN(актив) -> [EN(саппорт), …]
  var COMBO_TAGS = [
    ['Молния', 'Lightning'], ['Приспешники', 'Minion'], ['По площади', 'Area'],
    ['Снаряды', 'Projectile'], ['Чары', 'Spell'], ['Атака', 'Attack'],
    ['Холод', 'Cold'], ['Огонь', 'Fire'], ['Хаос', 'Chaos'],
    ['Физический', 'Physical'], ['Длительность', 'Duration'],
  ];
  function comboName(x) {
    var ru = x.ru ? esc(x.ru) : esc(x.en);
    return x.ru && x.ru.toLowerCase() !== String(x.en).toLowerCase()
      ? ru + ' <span style="color:#9aa4b0">' + esc(x.en) + '</span>'
      : ru;
  }
  function bindGenMode(host) {
    var m = host.querySelectorAll('[data-genmode]');
    for (var i = 0; i < m.length; i++) {
      m[i].addEventListener('click', function () {
        genMode = this.getAttribute('data-genmode');
        renderGenView();
      });
    }
  }
  function genModeChips() {
    return '<div class="tree-chips">' +
      '<button class="tree-chip' + (genMode === 'meta' ? ' on' : '') + '" data-genmode="meta">🏆 Мета ладдера</button>' +
      '<button class="tree-chip' + (genMode === 'combo' ? ' on' : '') + '" data-genmode="combo">🔗 Конструктор связок</button>' +
      '</div>';
  }
  function loadCombo() {
    var host = $('genContent');
    if (host) host.innerHTML = '<div class="lvl-hint">Загружаю датасет гемов…</div>';
    window.poe2k.buildgenGemData().then(function (res) {
      comboData = res;
      renderGenView();
    }).catch(function (err) {
      comboData = { ok: false, error: 'IPC error: ' + err };
      renderGenView();
    });
  }
  function renderComboView() {
    var host = $('genContent');
    if (!host) return;
    if (!comboData) { loadCombo(); return; }
    if (!comboData.ok) {
      host.innerHTML = genModeChips() + '<div class="lvl-hint">' +
        (comboData.error ? comboData.error : 'Датасет гемов недоступен.') + '</div>';
      bindGenMode(host);
      return;
    }
    var A = comboData.actives || [];
    var S = comboData.supports || [];
    var tc = COMBO_TAGS.map(function (t) {
      return '<button class="tree-chip' + (comboTags.indexOf(t[1]) >= 0 ? ' on' : '') +
        '" data-cmbtag="' + t[1] + '">' + t[0] + '</button>';
    }).join('');
    var filtered = A.filter(function (a) {
      return comboTags.every(function (t) { return (a.types || []).indexOf(t) >= 0; });
    }).sort(function (a, b) { return (a.unlock || 0) - (b.unlock || 0); });
    var MAX_SHOW = 60;
    var shown = filtered.slice(0, MAX_SHOW);
    var actRows = shown.map(function (a) {
      var on = comboSel.indexOf(a.en) >= 0;
      return '<div class="slang-row" data-cmben="' + esc(a.en) + '"><div class="slang-term">' +
        (on ? '<span style="color:#7fc97f">✔</span> ' : '') + comboName(a) +
        '</div><div class="slang-def">ур.' + (a.unlock || 0) +
        (on ? ' · <span style="color:var(--dim)">выбран</span>' : '') +
        '</div></div>';
    }).join('');
    var actList = '<div class="lvl-group" style="margin:4px 0"><div class="lvl-title" style="color:#c88">' +
      'Активные навыки (клик — в связку)</div>' +
      (filtered.length > MAX_SHOW
        ? '<div class="lvl-hint">Показаны первые ' + MAX_SHOW + ' из ' + filtered.length + ' — уточни фильтром выше.</div>'
        : '') +
      '<div data-cmblist>' + (actRows || '<div class="lvl-hint">Ничего не найдено — сними часть фильтров.</div>') + '</div></div>';
    // Блоки выбранных активов + их совместимые саппорты.
    var supBlocks = comboSel.map(function (en) {
      var a = A.find(function (x) { return x.en === en; });
      if (!a) return '';
      var lo = (a.types || []).map(function (t) { return String(t).toLowerCase(); });
      var comp = S.filter(function (sp) {
        return (sp.compat || []).some(function (c) { return lo.indexOf(String(c)) >= 0; });
      });
      if (!comp.length) comp = S; // редкий случай: unknown compat — показываем все
      var picked = comboSups[en] || [];
      var MAX_SP = 24;
      var spChips = comp.slice(0, MAX_SP).map(function (sp) {
        var on = picked.indexOf(sp.en) >= 0;
        return '<button class="tree-chip' + (on ? ' on' : '') +
          '" data-cmbsup="' + esc(en) + '||' + esc(sp.en) + '">' +
          (on ? '✔ ' : '') + comboName(sp) + '</button>';
      }).join('');
      var supNote = (comp.length > MAX_SP ? '<div class="lvl-hint">Показаны ' + MAX_SP + ' из ' + comp.length + ' саппортов (сортировка датасета).</div>' : '');
      var pickedList = picked.length
        ? '<div class="lvl-hint" style="margin-top:3px"> В связке: <b>' +
          picked.map(function (p) { return esc(p); }).join('</b>, <b>') + '</b></div>'
        : '';
      return '<div class="lvl-group" style="margin:4px 0"><div class="lvl-title" style="color:#7fc97f">' +
        comboName(a) + ' · ур.' + (a.unlock || 0) + ' · ' + (a.types || []).slice(0, 6).join(', ') +
        '</div><div class="tree-chips">' + spChips + '</div>' + supNote + pickedList + '</div>';
    }).join('');
    var comboSum = comboSel.length
      ? '<div class="lvl-group" style="margin:4px 0"><div class="lvl-title" style="color:#7fc97f">Ваша связка</div>' +
        comboSel.map(function (en) {
          var a = A.find(function (x) { return x.en === en; });
          var ps = (comboSups[en] || []);
          return '<div class="slang-row"><div class="slang-term">' + comboName(a) +
            '</div><div class="slang-def">Uncut Skill Gem ур.' + (a ? (a.unlock || 0) : 0) +
            (ps.length ? '<br><span style="color:var(--dim)">+ ' + ps.map(esc).join(', ') + '</span>' : '') +
            '</div></div>';
        }).join('') +
        '<div class="lvl-hint">Саппорты: Uncut Support Gem того же уровня, что и активный гем.</div></div>'
      : '';
    host.innerHTML = genModeChips() +
      '<div class="lvl-hint">Собери атаку: фильтр → активные → саппорты. Пример друга ⬇ одним кликом.</div>' +
      '<div class="tree-chips"><button class="tree-chip" data-cmbpreset="1">⚡ Молния по карте + стая волков + комета с неба</button></div>' +
      (tc ? '<div class="tree-chips">' + tc + '</div>' : '') +
      actList + supBlocks + comboSum;
    bindGenMode(host);
    var p = host.querySelector('[data-cmbpreset]');
    if (p) p.addEventListener('click', function () {
      comboTags = [];
      comboSel = ['Ball Lightning', 'Azmerian Wolf', 'Comet'];
      comboSups = {};
      renderComboView();
    });
    var tt = host.querySelectorAll('[data-cmbtag]');
    for (var i = 0; i < tt.length; i++) {
      tt[i].addEventListener('click', function () {
        var t = this.getAttribute('data-cmbtag');
        var ix = comboTags.indexOf(t);
        if (ix >= 0) comboTags.splice(ix, 1); else comboTags.push(t);
        renderComboView();
      });
    }
    var ll = host.querySelectorAll('[data-cmblist] .slang-row');
    for (var k = 0; k < ll.length; k++) {
      ll[k].addEventListener('click', function () {
        var en = this.getAttribute('data-cmben');
        if (!en) return;
        var ix = comboSel.indexOf(en);
        if (ix >= 0) { comboSel.splice(ix, 1); delete comboSups[en]; }
        else if (comboSel.length < 5) comboSel.push(en);
        renderComboView();
      });
    }
    var ss = host.querySelectorAll('[data-cmbsup]');
    for (var q = 0; q < ss.length; q++) {
      ss[q].addEventListener('click', function () {
        var kv = this.getAttribute('data-cmbsup').split('||');
        if (!comboSups[kv[0]]) comboSups[kv[0]] = [];
        var arr = comboSups[kv[0]];
        var ix = arr.indexOf(kv[1]);
        if (ix >= 0) arr.splice(ix, 1);
        else if (arr.length < 5) arr.push(kv[1]);
        renderComboView();
      });
    }
  }
  function loadGen() {
    var host = $('genContent');
    if (host) host.innerHTML = '<div class="lvl-hint">Загружаю ладдер ' + (genLeague || '') + '…</div>';
    window.poe2k.buildgenMeta(genLeague || undefined).then(function (res) {
      genData = res;
      if (res && res.ok && !genLeague) genLeague = res.league;
      renderGenView();
    }).catch(function (err) {
      genData = { ok: false, error: 'IPC error: ' + err };
      renderGenView();
    });
  }
  function showGenView() {
    $('idle').classList.add('hide');
    $('body').classList.remove('hide');
    var h = $('priceHead');
    if (h) h.classList.remove('hide');
    $('itemName').textContent = genMode === 'combo'
      ? '🧬 Конструктор связок (датасет PoE2)'
      : '🧬 Генератор билдов (ладдер poe.ninja)';
    showMode('gen');
    if (genMode === 'combo') {
      if (comboData) renderGenView(); else loadCombo();
    } else if (genData) renderGenView();
    else loadGen();
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
        // №106: бейдж привязки к оружейному набору (set1/set2 из PoB).
        var wset = '';
        if (g.weaponSet === '1' || g.weaponSet === '2') {
          wset = ' <span class="wset-badge" title="Камень привязан к набору оружия — вне набора игра пишет «нельзя использовать с текущими настройками оружия». В игре: окно умения → привязка набора, или переключите набор (X).">⚔ набор ' + (g.weaponSet === '1' ? 'I' : 'II') + '</span>';
        } else if (g.weaponSet === 'both') {
          wset = ' <span class="sub" title="Работает в любом наборе оружия (set1+set2 в PoB)">· любой набор</span>';
        }
        var html = '<tr><td>' + gemMarkSh(b, g.active, g.activeLevel) + '</td>' +
          '<td class="slot" colspan="3">' + gemDotSh(b, g.active) + '<b>' + esc(g.active) + '</b>' + lvl + wset +
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
    $('body').classList.remove('hide'); // №66-fix: с idle-экрана body был скрыт — вкладка показывала пустоту
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

  // №92: блок стартового билда — выбор асценданси (кейстоуны из датасета)
  // и приоритеты дерева (реальные нотабли по статам гайда).
  function renderStarterInfo(b) {
    var st = b.starter;
    var host = $('buildSlots');
    if (!host || !st) return;
    var html = '<div class="starter-info">'
      + '<div class="sub-h sub">🏆 Асценданси (кейстоуны — из датасета дерева):</div><div class="starter-row">';
    st.ascendancies.forEach(function (a) {
      var on = st.ascPicked === a.name;
      var t = a.name + (a.hint ? '\\n⚡ ' + a.hint : '');
      html += '<button class="starter-btn' + (on ? ' on' : '') + '" data-asc="' + esc(a.name) + '" title="' + esc(t) + '">' + esc(a.name) + '</button>';
    });
    html += '</div>';
    if (st.ascKeystones && st.ascKeystones.length) {
      html += '<div class="sub" style="margin:2px 0 6px">⚡ ' + st.ascKeystones.map(esc).join(' · ') + '</div>';
    }
    if (st.treePriorities && st.treePriorities.length) {
      html += '<div class="sub-h sub">🌳 Приоритеты дерева (нотабли — поиск по датасету):</div><div class="sub">';
      st.treePriorities.slice(0, 8).forEach(function (p) {
        html += '• ' + esc(p.priority) + ' → <b>' + p.notables.map(esc).join(', ') + '</b><br/>';
      });
      html += '</div>';
    }
    html += '</div>';
    host.insertAdjacentHTML('beforeend', html);
    var btns = host.querySelectorAll('[data-asc]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        window.poe2k.starterPickAsc(this.getAttribute('data-asc')).catch(function () {});
      });
    }
  }

  function slotRu(s) {
    return SLOT_RU[s] || s || '—';
  }

  // №91: стартовые билды новичка (сюжет) — кнопки 8 классов на пустой панели билда.
  function renderStarterBuilds() {
    var host = $('buildSlots');
    if (!host) return;
    host.innerHTML = '<div class="sub-h sub">🌱 Стартовый билд новичка (проход сюжета)</div>' +
      '<div class="starter-row" id="starterRow"><span class="sub">Загрузка классов…</span></div>' +
      '<div class="sub-h sub">…или импорт готового билда</div>';
    window.poe2k.starterList().then(function (list) {
      var row = $('starterRow');
      if (!row || !list || !list.length) return;
      var html = '';
      list.forEach(function (c) {
        html += '<button class="starter-btn" data-class="' + esc(c.className) + '" title="' + esc(c.tagline) + '">' +
          esc(c.className) + '</button>';
      });
      row.innerHTML = html;
      var btns = row.querySelectorAll('.starter-btn');
      for (var i = 0; i < btns.length; i++) {
        btns[i].addEventListener('click', function () {
          window.poe2k.starterImport(this.getAttribute('data-class')).catch(function () {});
        });
      }
    }).catch(function () {});
  }

  // №113c: адаптивная точность (медиана бывает < 0.1 хаоса — toFixed(1) давал «0.0»).
  function fmtChaosNum(v) {
    var a = Math.abs(Number(v));
    if (!Number.isFinite(a)) return String(v);
    if (a >= 10) return a.toFixed(1);
    if (a >= 1) return a.toFixed(2);
    return a.toFixed(3);
  }

  function fmtPrice(v) {
    if (v == null) return '…';
    return Number(v) >= 1000
      ? (Number(v) / 1000).toFixed(1) + 'k chaos'
      : fmtChaosNum(v) + ' chaos';
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
      // №129: кликабельный фильтр по нодам — ввод текста у друга не гарантирован
      // (окно зависит от focus-режимов), popular-запросы должны работать мышью.
      '<div id="treeChips" class="tree-chips"></div>' +
      '<div id="treeResults"></div>';
    host.innerHTML = html;
    var QUICK_TREE = [
      ['резисты', 'resist'],
      ['жизнь', 'life'],
      ['эн. щит', 'energy shield'],
      ['урон', 'damage'],
      ['крит', 'critical'],
      ['скор. атаки', 'attack speed'],
      ['скор. магии', 'cast speed'],
      ['мана', 'mana'],
    ];
    var chipsBox = $('treeChips');
    if (chipsBox) {
      chipsBox.innerHTML = QUICK_TREE.map(function (q, i) {
        return '<button class="chip" data-q="' + esc(q[1]) + '" title="Показать ноды: ' + esc(q[1]) + '">' + esc(q[0]) + '</button>';
      }).join('');
    }
    function runTreeSearch(q) {
      clearTimeout(treeSearchTimer);
      if (q.length < 2) { res.innerHTML = ''; return; }
      treeSearchTimer = setTimeout(function () {
        window.poe2k.treeSearch(q).then(function (nodes) {
          res.innerHTML = (nodes || []).length
            ? '<div class="sub">Найдено: ' + nodes.length + '</div>' + nodes.map(treeNodeRow).join('')
            : '<div class="tstats">ничего не найдено</div>';
        }).catch(function () {});
      }, 120);
    }
    if (chipsBox) {
      chipsBox.onclick = function (ev) {
        var b = ev.target;
        if (!b || !b.getAttribute || !b.getAttribute('data-q')) return;
        // подсветка активного чипа; повторный клик — сброс
        var was = b.classList.contains('on');
        var all = chipsBox.querySelectorAll('button.chip');
        for (var i = 0; i < all.length; i++) all[i].classList.remove('on');
        if (was) { res.innerHTML = ''; return; }
        b.classList.add('on');
        var q = b.getAttribute('data-q');
        if (inp) inp.value = ''; // чипсы и текстовый поиск не смешиваются
        runTreeSearch(q);
      };
    }
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
      // сброс подсветки чипсов при ручном вводе
      if (chipsBox) {
        var all = chipsBox.querySelectorAll('button.chip');
        for (var i = 0; i < all.length; i++) all[i].classList.remove('on');
      }
      runTreeSearch(inp.value.trim());
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
      renderStarterBuilds();
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
        '<td class="nm" title="' + esc(s.name) + (s.note ? ' — искать: ' + esc(s.note) : '') + '">' + esc(s.name) + '</td>' +
        '<td class="num">' + esc(price) + '</td>' +
        '</tr>';
      // №92-бис: подсказка «что искать» видима строкой (тултип никто не найдёт),
      // не только в title.
      if (s.note && s.status !== 'bought') {
        row += '<tr class="wornrow"><td></td><td></td>' +
          '<td class="worn" title="' + esc(s.note) + '">🔍 иск: ' + esc(s.note) + '</td>' +
          '<td></td></tr>';
      }
      // Что сейчас надето в этом слоте на персонаже (poe.ninja), если не совпадает.
      if (s.worn && s.status !== 'bought') {
        row += '<tr class="wornrow"><td></td><td></td>' +
          '<td class="worn" colspan="1" title="Надето сейчас (poe.ninja)">↑ носите: ' + esc(s.worn) + '</td>' +
          '<td></td></tr>';
      }
      return row;
    }).join('');
    $('buildSlots').innerHTML = '<table class="bld">' + rows + '</table>';
    // №91+92: стартовые билды доступны и с загруженным билдом — полоска внизу таблицы.
    var stWrap = document.createElement('div');
    stWrap.className = 'starter-row';
    stWrap.innerHTML = '<span class="sub-h sub">🌱 Стартовый билд новичка:</span>';
    window.poe2k.starterList().then(function (list) {
      if (!list) return;
      list.forEach(function (c) {
        var btn = document.createElement('button');
        btn.className = 'starter-btn';
        btn.title = c.tagline;
        btn.textContent = c.className;
        btn.addEventListener('click', function () {
          // №92-бис: случайный клик не должен стереть импортированный PoB-билд.
          if (lastBuildState && !lastBuildState.isStarter &&
              !window.confirm('Заменить текущий билд стартовым (' + c.className + ')?\\n' +
                'Импортированный билд будет удалён из панели (слоты/цены/чек-лист).')) {
            return;
          }
          window.poe2k.starterImport(c.className).catch(function () {});
        });
        stWrap.appendChild(btn);
      });
      $('buildSlots').appendChild(stWrap);
      if (b.starter) renderStarterInfo(b);
    }).catch(function () {});
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
        // №131: полноценный DPS-блок с разбивкой + честная пометка «расчётный, не живой»
        var dpsParts = [];
        if (b.summary.weaponPhysDps != null && b.summary.weaponPhysDps > 0) dpsParts.push('физ ' + Math.round(b.summary.weaponPhysDps).toLocaleString('ru-RU'));
        if (b.summary.weaponElemDps != null && b.summary.weaponElemDps > 0) dpsParts.push('элем ' + Math.round(b.summary.weaponElemDps).toLocaleString('ru-RU'));
        var dpsBreak = dpsParts.length ? ' <span class="sub" style="color:#9aa4b0">(' + dpsParts.join(' + ') +
          (b.summary.weaponAps ? ' · ' + b.summary.weaponAps + ' уд/с' : '') + ')</span>' : '';
        sum.push('⚔ DPS по гиру (' + esc(b.summary.weapon || '?') + '): <b title="Расчётный DPS из гира (PoB-оценка), не живой замер: GGG не отдаёт урон внешним тулам. Живой замер — время убийства тренировочного манекена в убежище.">' +
          Math.round(b.summary.weaponDps).toLocaleString('ru-RU') + '</b>' + dpsBreak);
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
    // №101: пользователь на вкладке «Импорт» и это результат импорта (успех/ошибка) —
    // остаёмся во вью импорта, рисуем итог там; showMode('build') не дёргаем.
    if (activeTab === 'import' && (state.error || state.visible)) {
      importResult = state.error
        ? { error: state.error }
        : {
            ok:
              (state.build.className ? state.build.className + ' / ' : '') +
              (state.build.ascendancy ? state.build.ascendancy + ' / ' : '') +
              (state.build.slots ? state.build.slots.length : 0) + ' слотов',
          };
      showImportView();
      return;
    }
    // №138-бис (живой репорт: «открыл Курс — перекидывает на Билд»): build:update
    // приходит фоном (charSync/watch/прайсинг) — НЕ воровать активную вкладку.
    // Данные рендерим (buildSum свежий при возврате), но showMode('build')
    // дёргаем только если юзер на Билде или панель ещё в idle-старте.
    const steal = activeTab === '' || activeTab === 'build';
    if (steal) {
      setBusy(false);
      $('idle').classList.add('hide');
      $('body').classList.remove('hide');
      $('est').classList.add('hide');
      $('busy').classList.add('hide');
      showMode('build');
    }
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

    // №103 Campaign Companion: маршрут акта
    renderCamp(lvl.camp);
    // №104: бестиарий боссов
    renderBosses(lvl.bosses, lvl.camp);
    // №108: чек-лист неполученных квестовых наград
    renderQuests(lvl.quests);
    // №112-lite: обзор эндгейм-механик + этажность Sekhemas
    renderEndgame(lvl.endgame);

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
    // №103: пока открыта панель прокачки — подпитывать контекст каждые 20 с
    // (зоны меняются часто; panelOpen — no-op если панель уже открыта).
    campStartPoll(lvl.camp);
  });

  /** №103: отрисовать маршрут акта (campWrap). */
  function renderCamp(camp) {
    var wrap = $('campWrap');
    wrap.innerHTML = '';
    if (!camp || !camp.rows || !camp.rows.length) return;

    var head = document.createElement('div');
    head.className = 'camp-head';
    head.textContent = camp.actName + '  ·  ' + camp.done + '/' + camp.total + ' зон';
    wrap.appendChild(head);

    var prog = document.createElement('div');
    prog.className = 'camp-prog';
    var bar = document.createElement('i');
    bar.style.width = Math.round(((camp.done + (camp.currentIndex >= 0 ? 1 : 0)) / camp.total) * 100) + '%';
    prog.appendChild(bar);
    wrap.appendChild(prog);

    for (var i = 0; i < camp.rows.length; i++) {
      var r = camp.rows[i];
      var row = document.createElement('div');
      row.className = 'camp-row ' + r.status;

      var name = document.createElement('div');
      name.className = 'camp-zname';
      name.textContent = r.status === 'current' ? '📍 ' + r.zone :
        (r.status === 'done' ? '✔ ' + r.zone : '○ ' + r.zone);
      var meta = document.createElement('span');
      meta.className = 'camp-meta';
      meta.textContent = 'ур. ' + r.monsterLevel +
        (r.levelDelta != null && r.status !== 'done'
          ? (r.levelDelta < -2 ? ' (⚠ зона на ' + (-r.levelDelta) + ' выше вас)' : (r.levelDelta > 3 ? ' (зона на ' + r.levelDelta + ' ниже вас — быстро)' : (r.levelDelta < 0 ? ' (выше вас на ' + (-r.levelDelta) + ')' : '')))
          : '');
      name.appendChild(meta);
      if (r.hasWaypoint) {
        var wp = document.createElement('span');
        wp.className = 'camp-wp';
        wp.title = 'В зоне есть вэпоинт (быстрый телепорт)';
        wp.textContent = '⌖WP';
        name.appendChild(wp);
      }
      for (var j = 0; j < (r.rewards || []).length; j++) {
        var b = document.createElement('span');
        b.className = 'camp-badge';
        b.textContent = r.rewards[j];
        name.appendChild(b);
      }
      if (r.boss) {
        var bo = document.createElement('span');
        bo.className = 'camp-boss';
        bo.textContent = '⚔ ' + r.boss.name;
        if (r.boss.reward) bo.title = r.boss.reward;
        name.appendChild(bo);
      }
      row.appendChild(name);

      if (r.note) {
        var note = document.createElement('div');
        note.className = 'camp-note';
        note.textContent = r.note;
        row.appendChild(note);
      }
      wrap.appendChild(row);
    }

    if (camp.actNote) {
      var an = document.createElement('div');
      an.className = 'camp-actnote';
      an.textContent = '🎁 ' + camp.actNote;
      wrap.appendChild(an);
    }
  }

  /** №104: бестиарий боссов (все сюжетные по актам + триалы + пиннакл). */
  function renderBosses(bosses, camp) {
    var wrap = $('campWrap');
    if (!bosses || !bosses.story) return;
    var curAct = camp && camp.act;

    var sec = document.createElement('div');
    sec.className = 'boss-sec';
    var head = document.createElement('div');
    head.className = 'camp-head';
    head.textContent = '⚔ Боссы';
    sec.appendChild(head);

    function entry(b, cur) {
      var e = document.createElement('div');
      e.className = 'boss-entry' + (cur ? ' boss-cur' : '') + (b.verified === false ? ' boss-unverified' : '');
      var nm = document.createElement('div');
      nm.className = 'boss-name';
      // №109: двойное имя, если RU-локализация подтверждена (name_ru задан).
      nm.textContent = (b.floor ? 'Этаж ' + b.floor + ' · ' : '') + b.name +
        (b.name_ru ? ' (' + b.name_ru + ')' : '');
      if (b.verified === false) {
        // №109: ничего не выдумываем — запись из источников, но не подтверждена.
        var unv = document.createElement('span');
        unv.className = 'boss-unv-mark';
        unv.textContent = 'не подтверждено';
        unv.title = b.unverifiedNote || 'Запись не верифицирована по живым источникам — проверить в игре.';
        nm.appendChild(unv);
      }
      e.appendChild(nm);
      var sub = document.createElement('div');
      sub.className = 'boss-sub';
      sub.textContent = (b.zone ? b.zone : (b.access ? '🔑 ' + b.access : '')) +
        (b.act && b.zone ? ' · акт ' + b.act : '') +
        (b.reward ? ' · 🎁 ' + b.reward : '');
      e.appendChild(sub);
      if (b.access && b.zone) {
        var ac = document.createElement('div');
        ac.className = 'boss-sub';
        ac.textContent = '🔑 ' + b.access;
        e.appendChild(ac);
      }
      if (b.tips) {
        for (var t = 0; t < b.tips.length; t++) {
          var tp = document.createElement('div');
          tp.className = 'boss-tip';
          tp.textContent = '• ' + b.tips[t];
          e.appendChild(tp);
        }
      }
      return e;
    }

    // Сюжет — по актам
    var byAct = {};
    for (var i = 0; i < bosses.story.length; i++) {
      var b = bosses.story[i];
      var k = b.act;
      (byAct[k] = byAct[k] || []).push(b);
    }
    var actKeys = Object.keys(byAct);
    actKeys.sort(function (a, b2) { return a.localeCompare(b2, 'ru', { numeric: true }); });
    for (var a = 0; a < actKeys.length; a++) {
      var grp = document.createElement('div');
      grp.className = 'boss-grp';
      var gt = document.createElement('div');
      gt.className = 'boss-grp-title';
      var isInter = actKeys[a] === 'I' || actKeys[a] === 'II' || actKeys[a] === 'III';
      gt.textContent = isInter ? 'Интерлюдия ' + actKeys[a] : 'Акт ' + actKeys[a];
      grp.appendChild(gt);
      var list = byAct[actKeys[a]];
      for (var j = 0; j < list.length; j++) grp.appendChild(entry(list[j], !isInter && Number(actKeys[a]) === curAct));
      sec.appendChild(grp);
    }
    if (bosses.trials && bosses.trials.length) {
      var tg = document.createElement('div');
      tg.className = 'boss-grp';
      var tt = document.createElement('div');
      tt.className = 'boss-grp-title';
      tt.textContent = 'Триалы асценданси';
      tg.appendChild(tt);
      for (var x = 0; x < bosses.trials.length; x++) tg.appendChild(entry(bosses.trials[x]));
      sec.appendChild(tg);
    }
    if (bosses.sekhemas && bosses.sekhemas.length) {
      var sg = document.createElement('div');
      sg.className = 'boss-grp';
      var st = document.createElement('div');
      st.className = 'boss-grp-title';
      st.textContent = 'Trial of the Sekhemas (лестница)'
      sg.appendChild(st);
      // №109: лестница этажей — сортировка по floor, вход через Djorn Barya (act 2).
      var sk = bosses.sekhemas.slice().sort(function (a, b3) { return (a.floor || 0) - (b3.floor || 0); });
      for (var s = 0; s < sk.length; s++) sg.appendChild(entry(sk[s]));
      sec.appendChild(sg);
    }
    if (bosses.pinnacle && bosses.pinnacle.length) {
      var pg = document.createElement('div');
      pg.className = 'boss-grp';
      var pt = document.createElement('div');
      pt.className = 'boss-grp-title';
      pt.textContent = 'Пиннакл (эндгейм)';
      pg.appendChild(pt);
      for (var y = 0; y < bosses.pinnacle.length; y++) pg.appendChild(entry(bosses.pinnacle[y]));
      sec.appendChild(pg);
    }
    wrap.appendChild(sec);
  }

  /** №108: чек-лист неполученных квестовых наград (Spirit/резисты/асц/пассивки). */
  function renderQuests(quests) {
    var wrap = $('campWrap');
    var sec = document.createElement('div');
    sec.className = 'boss-sec';
    var list = (quests && quests.list) || [];
    var head = document.createElement('div');
    head.className = 'camp-head';
    head.textContent = '🎖 Неполученные квесты' + (list.length ? ' · ' + list.length : '');
    sec.appendChild(head);
    if (!list.length) {
      var okRow = document.createElement('div');
      okRow.className = 'boss-tip';
      okRow.textContent = 'Все важные награды собраны или отмечены «забрал».';
      sec.appendChild(okRow);
    } else if (quests && quests.coverage) {
      var cov = document.createElement('div');
      cov.className = 'boss-tip';
      cov.textContent = quests.coverage;
      sec.appendChild(cov);
    }
    var res = quests ? quests.resists : null;
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      var row = document.createElement('div');
      row.className = 'quest-row' + (q.status === 'missed' ? ' quest-missed' : '');
      var t = document.createElement('div');
      t.className = 'boss-sub';
      t.textContent = (q.status === 'missed' ? '⚠ упущено · ' : '◻ впереди · ') +
        'Акт ' + q.act + ' · ' + q.zone + ' — ' + q.rewardRu +
        (q.boss ? ' (за ' + q.boss + ')' : '');
      row.appendChild(t);
      // №108: подсветка — у персонажа этот резист < 75%, награда закрывает дыру.
      if (q.kind === 'resist' && res) {
        var low = q.resistKind === 'all'
          ? Math.min(res.fire, res.cold, res.lightning)
          : res[q.resistKind];
        if (low != null && low < 75) {
          var w = document.createElement('div');
          w.className = 'quest-warn';
          w.textContent = q.resistKind === 'all'
            ? 'Ваш худший элем. резист ' + low + '% (меньше 75%) — награда очень желательна'
            : 'Резист сейчас ' + low + '% (меньше 75%) — взять в первую очередь';
          row.appendChild(w);
        }
      }
      var btn = document.createElement('button');
      btn.className = 'quest-claim';
      btn.textContent = '✔ забрал';
      btn.title = 'Отметить награду полученной — уйдёт из чек-листа навсегда';
      btn.addEventListener('click', (function (rowEl, key) {
        return function () {
          rowEl.style.opacity = '0.4';
          rowEl.querySelector('.quest-claim').disabled = true;
          window.poe2k.levelClaim(key).then(function (r) {
            if (r && r.ok) {
              rowEl.remove();
            } else {
              rowEl.style.opacity = '';
              rowEl.querySelector('.quest-claim').disabled = false;
              showToast('Не удалось отметить награду — прогресс прокачки ещё не создан. Побывайте в любой зоне и попробуйте снова.');
            }
          }).catch(function () { rowEl.style.opacity = ''; });
        };
      })(row, q.key));
      row.appendChild(btn);
      sec.appendChild(row);
    }
    wrap.appendChild(sec);
  }

  /** №112-lite: обзор эндгейм-механик атласа + этажность Sekhemas по уровню. */
  function renderEndgame(endgame) {
    var wrap = $('campWrap');
    var sec = document.createElement('div');
    sec.className = 'boss-sec';
    var head = document.createElement('div');
    head.className = 'camp-head';
    head.textContent = '🗺 Эндгейм';
    sec.appendChild(head);
    if (!endgame) { wrap.appendChild(sec); return; }

    if (endgame.sekhemasFloors != null) {
      var fl = document.createElement('div');
      fl.className = 'boss-sub';
      fl.style.marginBottom = '4px';
      fl.textContent = '💒 Trial of the Sekhemas на вашем уровне: этажей до финала — ' + endgame.sekhemasFloors +
        ' (лестница боссов — раздел «⚔ Боссы» выше).';
      sec.appendChild(fl);
    }
    var rows = endgame.overview || [];
    for (var i = 0; i < rows.length; i++) {
      var m = rows[i];
      var r = document.createElement('div');
      r.className = 'boss-entry boss-cur';
      var nm = document.createElement('div');
      nm.className = 'boss-sub';
      nm.textContent = (m.name_ru || m.name) +
        (m.region ? ' · ' + (m.region === 'SE' ? 'ЮВ' : m.region === 'S' ? 'Ю' : m.region === 'W' ? 'З' : m.region === 'N' ? 'С' : m.region === 'E' ? 'В' : m.region) : '') +
        (m.kind === 'trial' ? ' · триал' : m.kind === 'citadel' ? ' · цитадель' : '');
      r.appendChild(nm);
      var sh = document.createElement('div');
      sh.className = 'boss-tip';
      sh.textContent = m.short_ru || '';
      r.appendChild(sh);
      if (m.access_ru) {
        var ac2 = document.createElement('div');
        ac2.className = 'boss-tip';
        ac2.textContent = '🔑 ' + m.access_ru;
        r.appendChild(ac2);
      }
      sec.appendChild(r);
    }
    var tips = endgame.waystoneTips || [];
    if (tips.length) {
      var wt = document.createElement('div');
      wt.className = 'boss-grp-title';
      wt.textContent = 'Плитки смотрителя (Waystones)';
      sec.appendChild(wt);
      for (var w2 = 0; w2 < tips.length; w2++) {
        var tr2 = document.createElement('div');
        tr2.className = 'boss-tip';
        tr2.textContent = '• ' + tips[w2].text_ru + (tips[w2].verified === false ? ' (цифры не верифицированы — проверить в игре)' : '');
        sec.appendChild(tr2);
      }
    }
    wrap.appendChild(sec);
  }

  /** №103: автообновление контекста прокачки, пока вкладка видима. */
  var campTimer = null;
  function campStartPoll(camp) {
    if (campTimer) { clearInterval(campTimer); campTimer = null; }
    if (!camp || !camp.rows || !camp.rows.length) return;
    campTimer = setInterval(function () {
      // Панель сменилась/закрылась — таймер не нужен (у панелей single-mode,
      // но showMode других вкладок прячет lvlWrap).
      var wrap = $('campWrap');
      if (!wrap || wrap.classList.contains('hide') || !$('lvlWrap') || $('lvlWrap').classList.contains('hide')) {
        clearInterval(campTimer);
        campTimer = null;
        return;
      }
      window.poe2k.panelOpen('level');
    }, 20000);
  }

  function priceSingleView() {
    $('priceBatchWrap').classList.add('hide');
    var h = $('priceHead');
    if (h) h.classList.remove('hide');
  }
  function priceBatchView() {
    var h = $('priceHead');
    if (h) h.classList.add('hide');
    $('est').classList.add('hide');
    $('augLine').classList.add('hide');
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
        ? ' ~' + fmtChaosNum(res.estimate.min) + '–' + fmtChaosNum(res.estimate.max) + ' chaos'
        : '';
      est.innerHTML = '<span class="value">' + fmtChaosNum(res.estimate.median) + ' chaos</span>' +
        '<span class="range">' + esc(range) + '</span>' +
        '<span class="conf">(' + esc(conf) + ')</span>';
      est.querySelector('.range').textContent = '';
    } else {
      est.classList.add('hide');
    }

    // №110: руна/ядро души в предмете — тир и вид (эффект НЕ выдумываем).
    var augEl = $('augLine');
    if (res.augment && res.augment.kindRu) {
      augEl.classList.remove('hide');
      augEl.innerHTML = '⇗ эффект: <b>' + esc(res.augment.kindRu) + '</b> · тир <b>' +
        esc(res.augment.tierRu || res.augment.tier || '?') + '</b>' +
        (res.augment.name ? ' · ' + esc(res.augment.name) : '');
      augEl.title = 'Руна/ядро души: тир и вид из core.runes. Точный эффект смотрите в игре — в датасете его нет.';
    } else {
      augEl.classList.add('hide');
      augEl.innerHTML = '';
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
          ? ' · ≈<b style="color:var(--accent)">' + fmtChaosNum(chVals[Math.floor(chVals.length / 2)]) + '</b> chaos'
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
    if (total != null) headTxt += ' · сумма ~' + fmtChaosNum(total) + ' chaos';
    if (payload.elapsedMs != null) headTxt += ' · ' + Math.round(payload.elapsedMs / 1000) + 'с';
    head.textContent = headTxt;

    var cards = items.map(function (res, i) {
      var rar = String(res.rarity || '').toLowerCase();
      var estTxt;
      if (res.estimate && res.estimate.median != null) {
        var conf = res.estimate.confidence === 'exact' ? '' : (res.estimate.confidence === 'approx' ? ' ~' : ' грубо');
        estTxt = '<span class="value">≈' + fmtChaosNum(res.estimate.median) + ' chaos</span>' + '<span class="conf">(' + esc(conf) + ')</span>';
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

  // №111 «Чекап перед пиннаклом» (Ctrl+F7 / таб «🛡 Пиннакл»).
  window.poe2k.onPinnacleResult(function (p) {
    if (!p) return;
    setBusy(false);
    $('idle').classList.add('hide');
    $('body').classList.remove('hide');
    renderPinnacle(p);
    showMode('pinnacle');
    setActiveTab('pinnacle');
  });

  /** №111: отрисовать чек-лист готовности к пиннаклу. */
  function renderPinnacle(p) {
    var wrap = $('pinnacleContent');
    wrap.innerHTML = '';
    var sec = document.createElement('div');
    sec.className = 'boss-sec';
    var head = document.createElement('div');
    head.className = 'camp-head';
    sec.appendChild(head);

    if (p.available === false) {
      head.textContent = '🛡 Чекап перед пиннаклом';
      var errRow = document.createElement('div');
      errRow.className = 'boss-entry boss-unverified';
      var et = document.createElement('div');
      et.className = 'boss-sub';
      et.textContent = '⚠ ' + (p.error || 'Чек-лист недоступен.');
      errRow.appendChild(et);
      sec.appendChild(errRow);
      wrap.appendChild(sec);
      return;
    }

    head.textContent = '🛡 Чекап перед пиннаклом · доступно проверок: ' +
      (p.availableChecks != null ? p.availableChecks + '/' + p.totalChecks : '?');

    if (p.enemy) {
      var en = document.createElement('div');
      en.className = 'boss-tip';
      en.style.marginBottom = '4px';
      en.textContent = 'Модель врага: уровень ' + p.enemy.level + ' · режим ' + p.enemy.boss +
        ' · пенетрация элем-резистов ' + p.enemy.elementalPenetration + '%';
      sec.appendChild(en);
    }
    var checks = p.checks || [];
    for (var i = 0; i < checks.length; i++) {
      var c = checks[i];
      var row = document.createElement('div');
      row.className = 'pin-row pin-' + (c.verdict || 'unknown');
      var mark = c.verdict === 'pass' ? '✔' : (c.verdict === 'fail' ? '✖' : '—');
      row.textContent = mark + ' ' + c.item + (c.detail ? ' · ' + c.detail : '');
      row.title = 'Источник: ' + (c.kind === 'computed' ? 'вычислено по правилу' : 'оценка из гира (может отличаться от игры)');
      sec.appendChild(row);
    }
    var note = document.createElement('div');
    note.className = 'boss-tip';
    note.textContent = '«—» = данных для проверки нет (импортируйте билд Ctrl+F3). ⚠ Оценки из гира — перед пиннаклом сверьтесь в игре.';
    sec.appendChild(note);
    wrap.appendChild(sec);
  }
// ─── Панель настроек (Ctrl+F6) ─────────────────────────────────────────────
  var setDirty = {};
  var HK_ACTIONS = [
    ['price', 'Прайс'],
    ['leveling', 'Прокачка'],
    ['move', 'Перемещение'],
    ['buildImport', 'Импорт билда'],
    ['buildPanel', 'Панель билда'],
    ['pinnacle', 'Чекап перед пиннаклом'],
    ['settings', 'Настройки']
  ];
  var hkInputs = {};

  // №113b: видимость вкладок боковой колонки. id синхронны с data-tab в HTML.
  var TABS_META = [
    ['price', '💰 Прайс'],
    ['build', '🛒 Билд'],
    ['gems', '💎 Камни'],
    ['import', '📥 Импорт'],
    ['level', '📈 Прокачка'],
    ['maps', '🧭 Плитки'],
    ['slang', '📖 Слэнг'],
    ['craft', '⚒ Крафт'],
    ['rates', '💱 Курс'],
    ['gen', '🧬 Билды'],
    ['pinnacle', '🛡 Пиннакл'],
    ['settings', '⚙ Настройки'],
  ];
  function applyTabVisibility(hidden) {
    var hid = Array.isArray(hidden) ? hidden : [];
    TABS_META.forEach(function (t) {
      var btn = document.querySelector('#tabRow button[data-tab="' + t[0] + '"]');
      if (btn) btn.classList.toggle('hide', hid.indexOf(t[0]) >= 0);
    });
    if (activeTab && hid.indexOf(activeTab) >= 0) setActiveTab('');
  }
  function collectHiddenTabs() {
    var out = [];
    TABS_META.forEach(function (t) {
      if (t[0] === 'settings') return; // встроенно: настройки не прячем
      var cb = document.querySelector('#tabsGrid input[data-tab="' + t[0] + '"]');
      if (cb && !cb.checked) out.push(t[0]);
    });
    return out;
  }
  function buildTabsGrid(s) {
    var hidden = (s && Array.isArray(s.hiddenTabs)) ? s.hiddenTabs : [];
    var grid = $('tabsGrid');
    grid.innerHTML = '';
    TABS_META.forEach(function (t) {
      var lab = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('data-tab', t[0]);
      cb.checked = hidden.indexOf(t[0]) < 0;
      if (t[0] === 'settings') { cb.checked = true; cb.disabled = true; cb.title = 'Настройки нельзя скрыть'; }
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(t[1]));
      grid.appendChild(lab);
    });
  }

  function currentDraft() {
    var themeBtn = document.querySelector('#themeRow .on');
    var draftTheme = themeBtn ? themeBtn.getAttribute('data-theme') : 'default';
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
      // №105: тема доступности + свои цвета (пипетки).
      theme: draftTheme,
      colors: draftTheme === 'custom' ? {
        bg: $('setColBg').value,
        fg: $('setColFg').value,
        dim: $('setColDim').value,
        accent: $('setColAccent').value,
      } : {},
      hiddenTabs: collectHiddenTabs(),
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
    // №105: тема доступности + пипетки.
    paintTheme((s.theme === 'contrast' || s.theme === 'cb' || s.theme === 'custom') ? s.theme : 'default');
    if (s.colors) {
      if (s.colors.bg) $('setColBg').value = s.colors.bg;
      if (s.colors.fg) $('setColFg').value = s.colors.fg;
      if (s.colors.dim) $('setColDim').value = s.colors.dim;
      if (s.colors.accent) $('setColAccent').value = s.colors.accent;
    }
    setDirty.opacity = true; setDirty.scale = true; setDirty.width = true; setDirty.height = true;
    buildTabsGrid(s); // №113b: чекбоксы видимости вкладок
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
        applyTabVisibility(res.settings && res.settings.hiddenTabs); // №113b
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

  // №105: тема цветов применяется мгновенно (как угол) — эффект виден сразу
  // на открытой панели, «Сохранить» для неё не нужен.
  var themeBtns = document.querySelectorAll('#themeRow button');
  for (var th = 0; th < themeBtns.length; th++) {
    themeBtns[th].addEventListener('click', function () {
      var theme = this.getAttribute('data-theme');
      paintTheme(theme);
      var draft = currentDraft();
      draft.hotkeys = collectHotkeys();
      applyThemeColors(draft.theme, draft.colors, Number($('setOpacity').value) / 100);
      window.poe2k.settingsApply(draft).catch(function () {});
    });
  }
  ['setColBg', 'setColFg', 'setColDim', 'setColAccent'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      // Пипетка = режим «Свои»: автоматически переключаем тему и красим живьём.
      paintTheme('custom');
      var draft = currentDraft();
      draft.hotkeys = collectHotkeys();
      applyThemeColors('custom', draft.colors, Number($('setOpacity').value) / 100);
      window.poe2k.settingsApply(draft).catch(function () {});
    });
  });
  $('setColReset').addEventListener('click', function () {
    paintTheme('default');
    var draft = currentDraft();
    draft.hotkeys = collectHotkeys();
    applyThemeColors('default', null, Number($('setOpacity').value) / 100);
    window.poe2k.settingsApply(draft).catch(function () {});
  });

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

  // №105: цвета доступности. Пресеты (CSS-переменные :root):
  //  - contrast: чёрный/белый — максимальная светимость текста; статусы
  //    различимы и по светлоте (✕ ярче ⚠ ярче ✅ по насыщенности, все с иконками).
  //  - cb: палитра Okabe-Ito (Okabe & Ito, 2008) — универсально безопасна при
  //    красно-зелёной (де-/протанопия) и сине-жёлтой (тританопия) слепоте:
  //    небесно-синий/жёлтый/киноварь/сине-зелёный различимы по тону И светлоте.
  var lastOpacity = 0.86;
  var THEME_PRESETS = {
    default: null,
    contrast: { bg: '#000000', fg: '#ffffff', dim: '#e0e0e0', accent: '#ffd700',
      border: 'rgba(255,215,0,0.85)', ok: '#00e676', warn: '#ffffff', err: '#ff4040' },
    cb: { bg: '#10151b', fg: '#ffffff', dim: '#b0bec5', accent: '#56b4e9',
      border: 'rgba(86,180,233,0.65)', ok: '#009e73', warn: '#f0e442', err: '#d55e00' },
  };
  function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (alpha == null ? 1 : alpha).toFixed(2) + ')';
  }
  /** Применить тему/цвета к CSS-переменным. theme='custom' — только пипетки. */
  function applyThemeColors(theme, colors, opacity) {
    var rootStyle = document.documentElement.style;
    if (typeof opacity === 'number') lastOpacity = opacity;
    // Сброс к дефолту (:root) — снимаем все переопределения.
    ['--bg', '--fg', '--dim', '--accent', '--border', '--ok', '--warn', '--err'].forEach(function (v) {
      rootStyle.removeProperty(v);
    });
    var bg = null, fg = '#f0e6d2', dim = '#a89a83', accent = '#c69a52';
    var preset = THEME_PRESETS[theme];
    if (preset) {
      bg = preset.bg; fg = preset.fg; dim = preset.dim; accent = preset.accent;
      rootStyle.setProperty('--border', preset.border);
      rootStyle.setProperty('--ok', preset.ok);
      rootStyle.setProperty('--warn', preset.warn);
      rootStyle.setProperty('--err', preset.err);
    }
    if (theme === 'custom' && colors) {
      if (colors.bg) bg = colors.bg;
      if (colors.fg) fg = colors.fg;
      if (colors.dim) dim = colors.dim;
      if (colors.accent) accent = colors.accent;
    }
    // 'default' — не трогаем :root вовсе (CSS-дефолты). Любая другая тема —
    // перекрашиваем фон (с сохранением альфы прозрачности) и текст.
    if (theme !== 'default') {
      if (bg) rootStyle.setProperty('--bg', hexToRgba(bg, lastOpacity));
      rootStyle.setProperty('--fg', fg);
      rootStyle.setProperty('--dim', dim);
      rootStyle.setProperty('--accent', accent);
    }
  }
  function paintTheme(theme) {
    var btns = document.querySelectorAll('#themeRow button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].getAttribute('data-theme') === theme);
  }

  // Открытие/закрытие панели настроек (Ctrl+F6 из main).
  window.poe2k.onSettingsToggle(function () {
    if ($('settingsPanel').classList.contains('hide')) openSettings();
    else closeSettings();
  });

  // №64: вкладки — кликом открывают те же панели, что и хоткеи.
  // Подсветка активной вкладки синхронизируется и с хоткейами (события main).
  var tabBtns = document.querySelectorAll('#tabRow button');
  // №101: активная вкладка — onBuildUpdate не должен силой перекрашивать её,
  // когда пользователь смотрит результат импорта (это и был «прыжок на Билд»).
  var activeTab = '';
  function setActiveTab(tab) {
    activeTab = tab;
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
        } else if (tab === 'slang') {
          showSlangView(); // №133: локальный словарь слэнга, IPC не нужен
        } else if (tab === 'craft') {
          showCraftView(); // №134: локальный вью; план/каталог тянутся по IPC
        } else if (tab === 'rates') {
          showRatesView(); // №135: курсы валют по лигам (IPC currency:rates)
        } else if (tab === 'gen') {
          showGenView(); // №136: генератор билдов по ладдеру poe.ninja
        } else if (tab === 'import') {
          showImportView(); // №101: свой вью; запуск импорта — кнопкой/Ctrl+F3
        } else {
          window.poe2k.panelOpen(tab).catch(function () {});
        }
      });
    }
  }
  bindTabs();
  // №105: применить сохранённую тему/цвета при загрузке (main шлёт settings:display
  // только при изменениях, а не на старте) — берём настройки сами.
  window.poe2k.settingsGet().then(function (s) {
    if (!s) return;
    applyThemeColors(
      s.theme === 'contrast' || s.theme === 'cb' || s.theme === 'custom' ? s.theme : 'default',
      s.colors || null,
      typeof s.opacity === 'number' ? s.opacity : 0.86
    );
    applyTabVisibility(s.hiddenTabs); // №113b: скрытые вкладки убираем при старте
  }).catch(function () {});
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
  // №113e: клавиатура для полей ввода (поиск нод в Билде и т.п.). Окно
  // focusable:false — без этого текст в поля не вводился. Включаем фокус
  // ТОЛЬКО пока поле в фокусе: focusin на input → отдать клавиатуру панели,
  // focusout → вернуть игре. Наведение мыши на панель фокус не ворует.
  document.addEventListener('focusin', function (ev) {
    var t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
      window.poe2k.captureKeyboard(true).catch(function () {});
    }
  });
  document.addEventListener('focusout', function (ev) {
    var t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
      window.poe2k.captureKeyboard(false).catch(function () {});
    }
  });
  // №113e-b: focusin в блюрнутом renderer (окно без OS-фокуса) может НЕ
  // сработать — по живому логу друга keyboard:set не вызывался вовсе.
  // mousedown доходит всегда: хватаем клавиатуру на нажатии по полю и
  // принудительно фокусим элемент после (клик в блюрнутом окне не
  // обязательно ставит DOM-фокус).
  document.addEventListener('mousedown', function (ev) {
    var t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
      window.poe2k.captureKeyboard(true).catch(function () {});
      setTimeout(function () {
        if (document.activeElement !== t && t.focus) {
          try { t.focus(); } catch (e) { /* элемент мог уйти из DOM */ }
        }
      }, 0);
    }
  });
  // №128: у каждой функции — окно с информацией (что делает вкладка, хоткеи).
  var TAB_INFO = {
    price: { t: '💰 Прайс', h: 'Ctrl+F1', b: [
      'Копируешь предмет в игре (Ctrl+C) — жмёшь <span class="hk">Ctrl+F1</span>: оверлей покажет оценку по его клир-тексту.',
      'Показывает группы листингов с медианами (в хаосе, если известен курс), линк на торговый сайт.',
      'SSF-режим: вместо цены — план: сохранить ли фрактуред-мод, целевой крафт «двух якорей» (эссенции/омены/руны), зоны дропа базы.',
      'Watchlist: мониторинг ваших позиций, алерт при падении цены ≥10%.' ] },
    build: { t: '🛒 Билд', h: 'Ctrl+F2', b: [
      'Шопинг-лист эталонного билда: что искать на каждом слоте, дефициты (жизнь/резисты/ЭС) на основе импортированного PoB.',
      'Поиск по дереву (поле «поиск нод» + чипсы под ним: резисты/жизнь/урон — мышью без клавиатуры): ключевые камни и заметные ноды с их эффектами.',
      '⚔ DPS по гиру — расчётный (PoB-оценка оружия: физ+элем×скорость), НЕ живой замер: игра не отдаёт урон внешним тулам. Живой замер — тайминг убийства манекена в убежище.',
      'Уровневые метки: что капать на текущем уровне кампаньи.' ] },
    gems: { t: '💎 Камни', h: '—', b: [
      'Чек-лист камней сетапов билда: имя, уровень требований, ссылки для покупки/поиска.',
      'Привязка к наборам оружия: бейдж «⚔ набор I/II» — как игра это видит и как чинить «нельзя использовать».' ] },
    import: { t: '📥 Импорт', h: 'Ctrl+F3', b: [
      'Импорт билда из PoB-кода (Path of Building 2): вставил код в буфер → <span class="hk">Ctrl+F3</span>.',
      'Ссылка профиля poe.ninja + Ctrl+F3 — автосинхронизация реального гира персонажа со слотами билда.' ] },
    level: { t: '📈 Прокачка', h: 'Ctrl+F4', b: [
      'Маршрут текущего акта: зоны, что в них искать, квестовые награды (✔ забрал — персист), вэйпоинты.',
      'Бестиарий боссов: сюжет, триалы, пиннакл — ключи и награды.',
      'Эндгейм-механики (карты/лиги) и чек-лист резистов до 75%.' ] },
    maps: { t: '🧭 Плитки', h: '—', b: [
      'Рецепты крафта Waystone (плитки смотрителя): таблица тиры/рецепты/ингредиенты.' ] },
    slang: { t: '📖 Слэнг', h: '—', b: [
      'Словарь жаргона и сокращений PoE2 по-человечески: CI, EHP, слэм, якорь, WTS и т.д.',
      'Разделы переключаются чипсами мышью (клавиатура не нужна).' ] },
    craft: { t: '⚒ Крафт', h: '—', b: [
      '<b>План</b>: Ctrl+C по предмету в игре → кнопка «План по предмету» — пошаговый крафт «двух якорей» под этот слот (эссенции/омены/руны).',
      '<b>Рецепты</b>: все системы 0.5.5 (валюта, эссенции, омены, руны, качество, верстаки, Дезекрация, плитки) — фильтр чипсами.',
      '<b>Эссенции/Омены</b>: таблицы с гарантированными модами и поведением.' ] },
    rates: { t: '💱 Курс', h: '—', b: [
      'Курсы валют по лигам: сколько стоит каждая валюта в chaos-эквиваленте.',
      'Лига выбирается чипсами (✦ — актуальная); тренд ▲/▼ — движение цены за окно poe.ninja.',
      'Источник: poe2scout + poe.ninja; кэш 10 минут, чтобы не спамить API.' ] },
    gen: { t: '🧬 Билды', h: '—', b: [
      '<b>Генератор билдов</b>: живые билды топ-игроков poe.ninja по всем классам выбранной лиги.',
      'По каждому классу: самые частые скиллы и ключевые узлы, медианные DPS/EHP, топ-3 примера.',
      'Выборка — ладдер (первые по уровню); кэш 30 минут. Класс и лига — чипсами.' ] },
    pinnacle: { t: '🛡 Пиннакл', h: 'Ctrl+F7', b: [
      'Чекап перед боссом-пиннаклом: резисты, EHP, стан-порог — честные «—» при неизвестных данных.',
      'Что фармить до попытки: weakest-звенья билда по эталону.' ] },
    settings: { t: '⚙ Настройки', h: 'Ctrl+F6', b: [
      'Лига (список действующих), прозрачность, тема (вкл. палитра для дальтоников).',
      'Видимость вкладок панели: скрыть ненужные (функция остаётся на хоткеях).',
      'Диагностика пишется в overlay.log в userData.' ] }
  };
  function hideInfoWin() { document.getElementById('infoWin').classList.add('hide'); }
  document.getElementById('tabInfoBtn').addEventListener('click', function () {
    var w = document.getElementById('infoWin');
    if (!w.classList.contains('hide')) { hideInfoWin(); return; } // повторное ℹ закрывает
    var w = document.getElementById('infoWin');
    var inf = TAB_INFO[activeTab] || { t: 'Оверлей poe2-kit', h: '—', b: [
      'Выбери вкладку слева — «ℹ ?» расскажет, что она делает и каким хоткеем открывается.',
      'Ctrl+F1 прайс · Ctrl+F2 билд · Ctrl+F3 импорт · Ctrl+F4 прокачка · Ctrl+F5 закрепить позицию · Ctrl+F6 настройки · Ctrl+F7 чекап пиннакла.' ] };
    var html = '<div class="h2">' + inf.t + ' <span class="hk">' + inf.h + '</span>' +
      '<span class="close-info" id="infoWinClose" title="Закрыть">✕</span></div>';
    for (var i = 0; i < inf.b.length; i++) html += '<div>· ' + inf.b[i] + '</div>';
    html += '<div class="sub" style="margin-top:8px">ℹ — повторное нажатие закрывает это окно.</div>';
    w.innerHTML = html;
    w.classList.remove('hide');
    document.getElementById('infoWinClose').addEventListener('click', hideInfoWin);
  });
  // повторное ℹ закрывает; клик по другой вкладке закрывает инфоокно
  document.getElementById('tabInfoBtn').addEventListener('dblclick', hideInfoWin);
  var tabRowEl = document.getElementById('tabRow');
  if (tabRowEl) tabRowEl.addEventListener('click', function (ev) {
    var b = ev.target;
    if (b && b.getAttribute && b.getAttribute('data-tab')) hideInfoWin();
  });
  // Хоткей-пути красят ту же вкладку: параллельные слушатели событий main.
  window.poe2k.onPriceBatch(function () { setActiveTab('price'); });
  window.poe2k.onLevelResult(function () { setActiveTab('level'); });
  window.poe2k.onBuildUpdate(function (st) {
    // №101: на вкладке «Импорт» подсветка не перекрашивается в «Билд» — там свой вью.
    if (activeTab === 'import') return;
    setActiveTab(st && st.visible ? 'build' : '');
  });
  window.poe2k.onSettingsToggle(function () {
    setActiveTab($('settingsPanel').classList.contains('hide') ? '' : 'settings');
  });

  // Применение настроек отображения из main (прозрачность/масштаб/ширина/угол).
  window.poe2k.onSettingsDisplay(function (s) {
    if (!s) return;
    // Прозрачность фона панели + тема/цвета доступности (№105) — единым путём:
    applyThemeColors(
      s.theme === 'contrast' || s.theme === 'cb' || s.theme === 'custom' ? s.theme : 'default',
      s.colors || null,
      typeof s.opacity === 'number' ? s.opacity : 0.86
    );
    // Масштаб UI через zoom (учитывается в авторазмере высоты).
    var z = (typeof s.scale === 'number' ? s.scale : 1);
    var panel = $('panel');
    if (typeof panel.style.zoom === 'string') panel.style.zoom = String(z);
    else panel.style.transform = 'scale(' + z + ')';
    // Обновляем элементы панели настроек, если она открыта.
    if (!$('settingsPanel').classList.contains('hide')) {
      buildSettingsPanel({
        corner: s.corner,
        // №107-fix: было opacity: alpha — несуществующая переменная, ReferenceError
        // при каждом settings:display с открытой панелью настроек.
        opacity: (typeof s.opacity === 'number' ? s.opacity : 0.86), scale: z,
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