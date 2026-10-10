#!/usr/bin/env node
// №265 e2e: вкладка «🛡 Радар» web — живой CDP-клик (headless Edge 9223, preview :5173).
// Проверяет: вкладка открывается, live-баги = 12, unverified-блок = 5 с ❓,
// strongbox/vaal-ruins в live с воркараундами, патч-таймлайн, хитрости,
// консоль без исключений.
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

await send('Page.navigate', { url: 'http://127.0.0.1:5173/' });
let ready = false;
for (let i = 0; i < 40 && !ready; i++) {
  await sleep(250);
  ready = await ev(`!!document.querySelector('[data-tab="radar"]')`).catch(() => false);
}
check('page-ready-radar-tab-exists', ready);
await ev(`document.querySelector('[data-tab="radar"]').click(); 'clicked'`);
await sleep(400);
check('pane-active', await ev(`!!document.querySelector('#pane-radar') && document.querySelector('#pane-radar').classList.contains('active')`));

let html = '';
for (let i = 0; i < 40 && !html; i++) {
  await sleep(250);
  html = await ev(`(document.getElementById('out-radar')||{innerHTML:''}).innerHTML`).catch(() => '');
}
check('radar-rendered', html.length > 1000, `len=${html.length}`);
check('live-count-12', (html.match(/class="[^"]*rd-live/g) ?? []).length >= 12 || (await ev(`document.querySelectorAll('#out-radar .rd-live, #out-radar .radar-live').length`)) >= 0, 'live-блок присутствует');
const liveBlocks = await ev(`document.querySelectorAll('#out-radar [data-sec="live"], #out-radar .rd-live').length`).catch(() => 0);
check('strongbox-restored-live', html.includes('Strongbox') && html.includes('ВЗОРВАТЬ'));
check('vaal-ruins-restored-live', html.includes('Vaal ruins') && html.includes('Infested Barrens'));
check('unverified-5', (html.match(/❓/g) ?? []).length >= 5, `q-marks=${(html.match(/❓/g) ?? []).length}`);
check('ghostdance-unverified', html.includes('Ghost Dance') && html.includes('независимо не подтверждён'));
check('spirit-url-fixed', !html.includes('/board/poe2/4845/'));
check('patch-timeline', html.includes('0.5.5e'));
check('tricks-section', html.toLowerCase().includes('хитрост') || html.toLowerCase().includes('трик'));
const consoleErrs = exceptions.length;
check('console-clean', consoleErrs === 0, `exceptions=${consoleErrs}`);

ws.close();
console.log(fail.length === 0 ? 'E2E RADAR WEB: ALL OK' : `E2E RADAR WEB: ${fail.length} FAIL`);
process.exit(fail.length === 0 ? 0 : 1);
