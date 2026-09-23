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

  #hint { font-size: 11px; color: var(--dim); margin-top: auto; padding-top: 4px;
    border-top: 1px solid rgba(255,255,255,0.08); }
</style>
</head>
<body>
  <div id="panel">
    <div id="idle">
      Готово. Нажми <b>Ctrl+Alt+Space</b><br/>
      в игре, чтобы оценить предмет из буфера.
    </div>
    <div id="body" class="hide">
      <div class="head">
        <div class="item-name" id="itemName"></div>
      </div>
      <div id="est" class="est hide"></div>
      <div id="busy" class="status-busy hide">Оценка цены…</div>
      <div id="err" class="err-box hide"></div>
      <div id="meta" class="meta hide"></div>
      <div id="listWrap" class="hide">
        <table class="list" id="list"></table>
      </div>
      <div id="hint">Хоткей Ctrl+Alt+Space · клики сквозь оверлей</div>
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

  window.poe2k.onPriceBusy(function (b) {
    if (b) setBusy(true);
  });

  window.poe2k.onPriceResult(function (res) {
    if (!res) { setBusy(false); return; }
    setBusy(false);
    $('idle').classList.add('hide');
    $('body').classList.remove('hide');

    // Название + редкость цветом.
    var name = $('itemName');
    name.classList.remove('rarity-rare','rarity-unique','rarity-magic','rarity-currency','rarity-normal','rarity-common');
    var rar = String(res.rarity || '').toLowerCase();
    name.classList.add('rarity-' + rar);
    name.innerHTML = esc(res.itemName || 'Предмет');

    // Оценка.
    var est = $('est');
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
    if (res.parseError) {
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
  });
})();
</script>
</body>
</html>`;