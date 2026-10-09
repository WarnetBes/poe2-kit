#!/usr/bin/env node
// №239 e2e: вкладка «🌀 Simulacrum» (headless Edge CDP 9223, preview-dist :5174).
// Проверки: вкладка открывается, гайд рендерится лениво (fact-box, 7 волн,
// финал-строка, 3 карточки боссов, лут-таблица, атлас-ноды, чек-лист,
// unverified-пометки, severity-бары), повторный клик не перерисовывает,
// консоль чиста.
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
  ready = await ev(`!!document.querySelector('[data-tab="simulacrum"]')`).catch(() => false);
}
check('page-ready-tab-exists', ready);
await ev(`document.querySelector('[data-tab="simulacrum"]').click(); 'tab'`);
await sleep(400);
check('pane-active', await ev(`document.querySelector('#pane-simulacrum').classList.contains('active')`));

// ── 2) ленивый рендер гайда ─────────────────────────────────────────────────
let html = '';
for (let i = 0; i < 40 && !html; i++) {
  await sleep(250);
  html = await ev(`document.getElementById('out-simulacrum').innerHTML`).catch(() => '');
}
check('guide-rendered', html.includes('sim-facts'), `len=${html.length}`);
check('factbox-7-waves', html.includes('<b>7</b>') && html.includes('волн'));
check('access-stepper', html.includes('Как попасть') && html.includes('Grand Mirror'));
check('waves-table-7-rows', (await ev(`document.querySelectorAll('.sim-waves tbody tr').length`)) === 7);
check('final-wave-highlighted', await ev(`!!document.querySelector('.sim-waves tr.sim-final')`));
check('shards-3-cards', (await ev(`document.querySelectorAll('.sim-shard').length`)) === 3);
check('bosses-3-cards', (await ev(`document.querySelectorAll('.sim-boss').length`)) === 3);
check('boss-telegraph-tables', (await ev(`document.querySelectorAll('.sim-boss table tbody tr').length`)) >= 6);
check('tangmazu-script-heal', html.includes("Tang'Mazu") && html.includes('НЕ роллится'));
check('loot-table-voices', html.includes('Voices') && html.includes('Megalomaniac'), '');
check('loot-no-catalysts-lie', !/\bCatalysts?\b.*падя|Catalyst дроп/.test(html), '');
check('atlas-nodes-table', (await ev(`document.querySelectorAll('.sim-scroll table tbody tr').length`)) >= 17);
check('atlas-mandatory-node', html.includes('Is this about me... or you?') && html.includes('обязательная'));
check('strategies-collapse', (await ev(`document.querySelectorAll('.sim-collapse').length`)) === 4);
check('checklist-7-items', (await ev(`document.querySelectorAll('#out-simulacrum .mp-check').length`)) === 7);

check('known-issues-simulacrum', html.includes('Известные баги') && html.includes('unable to proceed') && html.includes('End Delirium Encounter'));
check('copy-button', await ev(`!!document.getElementById('sim-copy-checklist')`));
check('unverified-markers', (html.match(/unverified/g) ?? []).length >= 5, `count=${(html.match(/unverified/g) ?? []).length}`);
check('severity-bars', html.includes('mp-sev'));

// ── 3) повторный клик по вкладке не должна перерисовывать (lazy-флаг) ───────
const before = await ev(`document.getElementById('out-simulacrum').innerHTML.length`);
await ev(`document.querySelector('[data-tab="simulacrum"]').click(); 'tab2'`);
await ev(`document.querySelector('[data-tab="mapprep"]').click(); 'away'`);
await ev(`document.querySelector('[data-tab="simulacrum"]').click(); 'back'`);
await sleep(300);
const after = await ev(`document.getElementById('out-simulacrum').innerHTML.length`);
check('lazy-rerender-guard', before === after, `before=${before} after=${after}`);

// ── 4) консоль чиста ───────────────────────────────────────────────────────
check('console-clean', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));

console.log(fail.length ? `\nFAILED: ${fail.length} (${fail.join(', ')})` : '\nALL OK');
if (ws.close) ws.close();
process.exit(fail.length ? 1 : 0);
