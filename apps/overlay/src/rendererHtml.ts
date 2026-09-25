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
    --border: rgba(240, 136, 62, 0.55);
    --fg: #e6edf3;
    --dim: #9aa4b0;
    --ok: #3fb950;
    --warn: #d29922;
    --err: #f85149;
    --accent: #f0883e;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden;
    font-family: "Segoe UI", system-ui, sans-serif; color: var(--fg); }
  #panel {
    position: absolute; inset: 0;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 12px;
    display: flex; flex-direction: column;
    gap: 6px;
    box-shadow: 0 6px 24px rgba(0,0,0,.5);
  }
  #idle {
    color: var(--dim); font-size: 12px; margin: auto;
    text-align: center; line-height: 1.6;
  }
  #idle b { color: var(--accent); font-family: Consolas, monospace; }
  .hide { display: none !important; }

  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .item-name { font-size: 15px; font-weight: 700; color: #fff; line-height: 1.2; }
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
    background: rgba(240,136,62,0.10); border: 1px solid rgba(240,136,62,0.3);
  }
  .est .value { font-size: 20px; font-weight: 800; color: var(--accent); }
  .est .range { font-size: 12px; color: var(--dim); }
  .est .conf { font-size: 11px; color: var(--dim); }

  .status-busy { color: var(--dim); font-size: 12px; }
  .err-box { color: var(--warn); font-size: 12px; }

  .meta { font-size: 11px; color: var(--dim); }
  .meta .src { color: var(--accent); }

  table.list { width: 100%; font-size: 11px; border-collapse: collapse; margin-top: 2px; }
  table.list td { padding: 2px 6px; border-top: 1px solid rgba(255,255,255,0.06); }
  table.list .num { text-align: right; font-variant-numeric: tabular-nums; }
  #priceBatchWrap { display: flex; flex-direction: column; gap: 4px; min-height: 0; flex: 1; overflow: hidden; }
  #priceBatchHead { font-size: 12px; color: var(--dim); }
  #priceBatchList { flex: 1; overflow-y: auto; min-height: 0; display: flex; flex-direction: column; gap: 4px; }
  .batch-item { border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 6px 8px;
    background: rgba(255,255,255,0.03); }
  .batch-item .bi-name { font-size: 13px; font-weight: 700; }
  .batch-item .bi-est { font-size: 16px; font-weight: 800; color: var(--accent); }
  .batch-item .bi-note { font-size: 11px; color: var(--dim); }
  .batch-item .bi-note .err-inline { color: var(--err); }
  .muted { color: var(--dim); font-size: 11px; }
  .batch-ww { cursor: pointer; background: none; border: 1px solid rgba(255,255,255,0.15);
    color: var(--dim); border-radius: 6px; font-size: 11px; padding: 1px 6px; margin-top: 3px; }
  .batch-ww:hover { color: var(--accent); border-color: var(--accent); }

  .watch-btn { display: block; width: 100%; margin-top: 6px; cursor: pointer;
    background: rgba(240,136,62,0.14); border: 1px solid var(--accent); color: var(--accent);
    border-radius: 8px; padding: 5px 10px; font-size: 12px; font-weight: 600; }
  .watch-btn:hover { background: rgba(240,136,62,0.24); }

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
  .watch-actions button { flex: 1; cursor: pointer; background: rgba(240,136,62,0.14);
    border: 1px solid var(--accent); color: var(--accent); border-radius: 8px;
    padding: 4px 8px; font-size: 12px; }
  .watch-actions button:hover { background: rgba(240,136,62,0.24); }

  #diagSection { border-top: 1px solid rgba(255,255,255,0.08); margin-top: 4px; }
  .diag-actions { display: flex; gap: 6px; margin-top: 6px; }
  .diag-actions button { flex: 1; cursor: pointer; background: rgba(240,136,62,0.12);
    border: 1px solid rgba(240,136,62,0.4); color: var(--text); border-radius: 8px;
    padding: 5px 8px; font-size: 12px; }
  .diag-actions button:hover { background: rgba(240,136,62,0.24); }
  .diag-actions button:disabled { opacity: 0.55; cursor: default; }
  #diagOut { margin-top: 6px; font-size: 10px; color: var(--dim); line-height: 1.4;
    word-break: break-all; white-space: pre-line; }

  .lvl-hint { font-size: 12px; line-height: 1.5; }
  .lvl-hint b { color: var(--accent); }
  .lvl-zone { font-size: 13px; font-weight: 700; color: #fff; }

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
    background: rgba(240,136,62,0.16);
    border-bottom: 1px solid rgba(240,136,62,0.35);
    border-radius: 10px 10px 0 0;
    text-align: center;
  }
  #grab .reset { -webkit-app-region: no-drag; cursor: pointer; color: var(--dim);
    text-decoration: underline; font-size: 11px; }

  /* Панель билда (Ctrl+F2). */
  #buildWrap { display: flex; flex-direction: column; gap: 4px; min-height: 0; flex: 1; overflow: hidden; }
  #buildHead { font-size: 12px; color: #fff; font-weight: 700; }
  #buildHead .sub { font-weight: 400; font-size: 11px; color: var(--dim); }
  #buildBudget { font-size: 12px; color: var(--accent); font-weight: 700; }
  #buildBudget .done { color: var(--ok); font-weight: 400; font-size: 11px; }
  #buildSlots { overflow-y: auto; flex: 1; min-height: 0; }
  table.bld { width: 100%; font-size: 11px; border-collapse: collapse; }
  table.bld td { padding: 1px 6px 1px 0; border-top: 1px solid rgba(255,255,255,0.06); }
  table.bld .slot { color: var(--dim); white-space: nowrap; max-width: 80px; overflow: hidden;
    text-overflow: ellipsis; }
  table.bld .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 210px; }
  table.bld .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.bld tr.bought td { color: var(--ok); }
  table.bld tr.bought .nm { text-decoration: line-through; }
  #buildSum { font-size: 11px; color: var(--dim); line-height: 1.45; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 3px; }
  #buildSum b { color: var(--fg); }
  #buildSum .gap { color: var(--warn); }
  #buildNote { font-size: 12px; color: var(--ok); }
  #buildErr { font-size: 11px; color: var(--warn); }

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
  .corner-row { display: flex; gap: 6px; }
  .corner-row button { flex: 1; font-size: 10px; padding: 4px 2px; cursor: pointer;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
    color: var(--dim); border-radius: 6px; }
  .corner-row button.on { background: rgba(240,136,62,0.22); border-color: var(--accent); color: var(--accent); }
  .hk-grid { display: flex; flex-direction: column; gap: 4px; }
  .hk-grid .hk { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 11px; }
  .hk-grid .hk input { font-size: 11px; font-family: Consolas, monospace; padding: 2px 4px;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
    color: var(--fg); border-radius: 5px; width: 130px; }
  .set-actions { display: flex; gap: 6px; margin-top: auto; padding-top: 4px; }
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
      <div id="buildWrap" class="hide">
        <div id="buildHead"></div>
        <div id="buildBudget"></div>
        <div id="buildSlots"></div>
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
        <span>Угол прикрепления</span>
        <div class="corner-row" id="cornerRow">
          <button data-corner="top-left">В·л</button>
          <button data-corner="top-right">В·п</button>
          <button data-corner="bottom-left">Н·л</button>
          <button data-corner="bottom-right">Н·п</button>
        </div>
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

      <div class="set-row" id="diagSection">
        <div class="lbl"><span>Диагностика</span></div>
        <div class="diag-actions">
          <button id="diagBtn">📋 Отправить диагностику</button>
        </div>
        <div id="diagOut" class="diag-out"></div>
        <div class="tip">Соберёт хвост <b>overlay.log</b> + конфиг машины, скопирует всё в буфер обмена и сохранит файл в userData — готово для вставки в отчёт/issue, файлы искать вручную не нужно.</div>
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
  var _sizeTimer = null;
  function requestSize() {
    if (_sizeTimer) clearTimeout(_sizeTimer);
    _sizeTimer = setTimeout(function () {
      var h = Math.ceil(document.getElementById('panel').getBoundingClientRect().height);
      if (h > 40 && window.poe2k.autosize) {
        window.poe2k.autosize(h).catch(function () {});
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
    document.body.style.background = state.unlocked ? 'rgba(240,136,62,0.04)' : 'transparent';
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
    // Сетапы камней: какие камни и куда вставлять.
    var gemRows = '';
    if (b.gemSetups && b.gemSetups.length) {
      gemRows = '<tr><td colspan="4" style="padding-top:5px;border-top:1px solid #2a3344">' +
        '<span class="sub">💎 Камни билда — куда вставлять</span></td></tr>';
      gemRows += b.gemSetups.map(function (g) {
        var lvl = g.activeLevel != null ? (' <span class="sub">ур. ' + g.activeLevel + '</span>') : '';
        var html = '<tr><td>💎</td>' +
          '<td class="slot" colspan="3"><b>' + esc(g.active) + '</b>' + lvl +
          ' <span class="sub">→ ' + esc(g.where) + '</span></td></tr>';
        if (g.supports && g.supports.length) {
          html += '<tr class="wornrow"><td></td><td class="worn" colspan="3">+ ' + esc(g.supports.join(', ')) + '</td></tr>';
        }
        return html;
      }).join('');
    }
    $('buildSlots').innerHTML = '<table class="bld">' + rows + gemRows + '</table>';

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

    // Список похожих объявлений.
    var lw = $('listWrap');
    var list = $('list');
    if (res.listings && res.listings.length) {
      var rows = res.listings.slice(0, 8).map(function (l) {
        return '<tr><td class="num">' + esc(l.price) + '</td><td>' + esc(l.currency) + '</td><td>' + esc(l.whisper || '') + '</td></tr>';
      }).join('');
      list.innerHTML = '<tr><td colspan="3" style="color:#9aa4b0">Похожие (trade2):</td></tr>' + rows;
      lw.classList.remove('hide');
    } else {
      lw.classList.add('hide');
    }

    // Кнопка «Следить»: добавить предмет в watchlist (если есть сырой itemText).
    var ww = $('watchBtnWrap');
    if (res.itemText) {
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
    setDirty.opacity = true; setDirty.scale = true; setDirty.width = true;

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
      requestSize();
    }).catch(function () {});
  }

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
  ['setOpacity', 'setScale', 'setWidth'].forEach(function (id) {
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
    });
  }

  // Открытие/закрытие панели настроек (Ctrl+F6 из main).
  window.poe2k.onSettingsToggle(function () {
    if ($('settingsPanel').classList.contains('hide')) openSettings();
    else closeSettings();
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