#!/usr/bin/env node
// №234-Э4 e2e: вкладка «🗺 Карты» (headless Edge CDP 9223, preview-dist :5174).
// Проверки: вкладка открывается, datalist 135 карт, выбор карты Rustbowl,
// вставка мода 'Players have -(7-8)% to all maximum Resistances',
// вердикт рисуется (моды + чеки + unverified), console errors = 0.
const fail = [];
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? `  [${extra}]` : ''));
  if (!cond) fail.push(name);
};

const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('page target not found'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push(m.params.exceptionDetails?.text ?? 'exception');
  }
};
await new Promise((res) => { ws.onopen = res; });
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.enable');
await send('Page.enable');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result?.value;
}

// ── 1) открыть страницу и вкладку ─────────────────────────────────────────
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' });
let ready = false;
for (let i = 0; i < 40 && !ready; i++) {
  await sleep(250);
  ready = await ev(`!!document.querySelector('[data-tab="mapprep"]')`,).catch(() => false);
}
check('page-ready', ready);
await ev(`document.querySelector('[data-tab="mapprep"]').click(); 'tab'`);
await sleep(300);
check('pane-active', await ev(`document.querySelector('#pane-mapprep').classList.contains('active')`));

// ── 2) datalist: 135 карт (лениво наполняется при первом открытии вкладки) ──
let dl = 0;
for (let i = 0; i < 40 && dl < 135; i++) {
  await sleep(250);
  dl = await ev(`document.querySelectorAll('#mapprep-maps option').length`).catch(() => 0);
}
check('datalist-135', dl === 135, `options=${dl}`);

// ── 3) карта Rustbowl + мод Exposure + резисты вручную → «Вердикт» ────────
await ev(`(function(){
  document.getElementById('mapprep-map').value = 'Rustbowl (Map)';
  document.getElementById('mapprep-tier').value = '12';
  document.getElementById('mapprep-mods').value = 'Players have -(7-8)% to all maximum Resistances';
  document.getElementById('mapprep-res-fire').value = '75';
  document.getElementById('mapprep-res-cold').value = '75';
  document.getElementById('mapprep-res-lightning').value = '75';
  document.getElementById('mapprep-res-chaos').value = '30';
  document.getElementById('btn-mapprep').click(); 'click'
})()`);
let html = '';
for (let i = 0; i < 40 && !html; i++) {
  await sleep(250);
  html = await ev(`document.getElementById('out-mapprep').innerHTML`).catch(() => '');
}
check('verdict-rendered', html.includes('mp-head'), `len=${html.length}`);
check('tier-area-level-76', html.includes('area level <b>76</b>'), 'T12→76 (65+tier-1, endgame.ts)');
check('exposure-mod-recognized', html.includes('of Exposure') || html.includes('max_res'), '');
check('exposure-advice-res-compensation', html.includes('Exposure'), '');
check('chaos-check-present', html.includes('chaos'), '');
check('unverified-visible', html.includes('unverified'), '');
check('severity-bars', html.includes('mp-sev'), '');
check('no-scary-nodata', !html.includes('нет данных'), '');

// ── 4) fallback без билда и без резистов: честная пометка ─────────────────
await ev(`(function(){
  document.getElementById('mapprep-res-fire').value = '';
  document.getElementById('mapprep-res-cold').value = '';
  document.getElementById('mapprep-res-lightning').value = '';
  document.getElementById('mapprep-res-chaos').value = '';
  document.getElementById('btn-mapprep').click(); 'click2'
})()`);
let html2 = '';
for (let i = 0; i < 40 && !html2; i++) {
  await sleep(250);
  html2 = await ev(`document.getElementById('out-mapprep').innerHTML`).catch(() => '');
}
check('no-build-honest-note', html2.includes('Импорт билд'), '');

// ── 5) консоль чиста ─────────────────────────────────────────────────────
check('console-clean', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));

console.log(fail.length ? `\nFAILED: ${fail.length} (${fail.join(', ')})` : '\nALL OK');
if (ws.close) ws.close();
process.exit(fail.length ? 1 : 0);
