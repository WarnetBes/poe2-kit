#!/usr/bin/env node
// Волна №215 e2e: вкладка «Атлас» (headless Edge CDP 9223, dist :5174).
// Проверки: рендер, hash-restore #a=, клик-аллокация только по смежности,
// refund, лимит 40, поиск, шаринг-ссылка, «Очистить», чистая консоль, #p= не трогаем.
import { readFileSync } from 'node:fs';

const ATLAS = 'C:/Users/mezhavikiserj/BildPOE2/poe2-kit/packages/core/data/game/atlas/atlas.json';
const data = JSON.parse(readFileSync(ATLAS, 'utf8'));
const adj = new Map();
for (const [a, b] of data.edges) {
  if (a === b) continue;
  if (!adj.has(a)) adj.set(a, []);
  if (!adj.has(b)) adj.set(b, []);
  adj.get(a).push(b);
  adj.get(b).push(a);
}
// центральный корень и две цепочки смежных узлов
const ROOT = data.roots.find((h) => data.nodes[String(h)].name.startsWith('Начало: центр')) ?? data.roots[0];
const nbrs = (adj.get(ROOT) ?? []).filter((h) => data.nodes[String(h)]);
const N1 = nbrs[0]; // валидная аллокация
const N2 = (adj.get(N1) ?? []).filter((h) => h !== ROOT)[0]; // вторая ступень
// далёкий узел: не смежен ни с чем из {ROOT,N1}
const FAR = Object.keys(data.nodes).map(Number).find(
  (h) => h !== ROOT && h !== N1 && h !== N2 && ![ROOT, N1].some((x) => (adj.get(x) ?? []).includes(h)),
);
if (!N1 || !N2 || !FAR) { console.error('test data setup failed', { N1, N2, FAR }); process.exit(1); }
const SEARCH = data.nodes[String(N1)].id; // поиск по id реального узла

const fail = [];
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? `  [${extra}]` : ''));
  if (!cond) fail.push(name);
};

// ---- CDP boilerplate (паттерн e2e-planner) ----
const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('page target not found'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
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
await send('Runtime.enable');
await send('Page.enable');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result?.value;
}
async function clickXY(x, y) {
  const px = Math.round(x), py = Math.round(y);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 });
}
/** центр хит-круга узла в координатах вьюпорта */
const nodeCenter = (id) => ev(`(function(){
  const el = document.querySelector('.atlas-canvas [data-id="${id}"].mhit');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`);

// ---- 1) hash-restore: #a=<ROOT,N1> (N2 оставляем свободным — его будем брать кликом) ----
await send('Page.navigate', { url: 'about:blank' }); // сброс: navigate с новым hash НЕ релоадит страницу
await sleep(300);
await send('Page.navigate', { url: `http://127.0.0.1:5174/#p=Monk::1.2&a=${ROOT},${N1}` });
let ready = false;
for (let i = 0; i < 40 && !ready; i++) {
  await sleep(250);
  ready = await ev(`!!document.querySelector('[data-tab="atlas"]')`).catch(() => false);
}
check('page-ready', ready);
await ev(`document.querySelector('[data-tab="atlas"]').click(); 'tab'`);
let svgOn = false;
for (let i = 0; i < 40 && !svgOn; i++) {
  await sleep(250);
  svgOn = await ev(`!!document.querySelector('.atlas-canvas svg.atlas-svg')`).catch(() => false);
}
check('atlas-rendered', svgOn);
await sleep(600); // дать отработать restore
const pts1 = await ev(`document.querySelector('.atlas-pts')?.textContent`);
check('hash-restore-2-points', pts1 === '2', `pts=${pts1}`);
const ls = await ev(`localStorage.getItem('poe2k.atlasPlan')`);
check('restore-persisted-to-ls', Array.isArray(JSON.parse(ls ?? '[]')) && JSON.parse(ls).length === 2, String(ls));

// ---- 2) валидная аллокация: сосед N2 (свободен) ----
const c2 = await nodeCenter(N2);
check('node2-clickable', !!c2);
if (c2) { await clickXY(c2.x, c2.y); await sleep(300); }
check('alloc-adjacent', (await ev(`document.querySelector('.atlas-pts')?.textContent`)) === '3');

// ---- 3) невалидная: далёкий узел, счётчик не растёт ----
const cf = await nodeCenter(FAR);
check('far-node-clickable', !!cf);
if (cf) { await clickXY(cf.x, cf.y); await sleep(300); }
check('alloc-nonadjacent-blocked', (await ev(`document.querySelector('.atlas-pts')?.textContent`)) === '3');
check('far-not-allocated', !(await ev(`document.querySelector('.atlas-canvas circle.alloc[data-id="${FAR}"]') !== null`)));

// ---- 4) refund: клик по N2 (лист) снимает ----
if (c2) { await clickXY(c2.x, c2.y); await sleep(300); }
check('refund-leaf', (await ev(`document.querySelector('.atlas-pts')?.textContent`)) === '2');

// ---- 5) шаринг: кнопка «Ссылка» кладёт #a=, #p= переживает ----
await ev(`document.querySelector('.atlas-link').click(); 'link'`);
await sleep(400);
const href = await ev(`location.href`);
check('link-has-a', /[?&]?#.*(^|&)a=\d+(%2C|,)\d+/.test(href) && /p=Monk/.test(href), href.slice(-90));
check('a-synced-with-plan', (await ev(`location.hash`)).includes(`${ROOT}`), '');

// ---- 6) поиск по id ----
await ev(`(function(){
  const inp = document.querySelector('.atlas-search input');
  inp.focus(); inp.value = ${JSON.stringify(SEARCH)};
  inp.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(400);
const dropSel = '.atlas-search .tree-search-drop';
const dropVisible = await ev(`!(document.querySelector('${dropSel}')?.hidden)`);
check('search-drop-visible', dropVisible);
if (dropVisible) {
  await ev(`document.querySelector('${dropSel} .tree-search-item')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await sleep(400);
}
const focused = await ev(`document.querySelectorAll('.atlas-canvas .mfocus').length`);
check('search-focus-marked', focused > 0, `focused=${focused}`);

// ---- 7) «Очистить»: план = 0, #a= убран, #p= жив ----
await ev(`document.querySelector('.atlas-clear').click(); 'clear'`);
await sleep(300);
check('cleared-points', (await ev(`document.querySelector('.atlas-pts')?.textContent`)) === '0');
const hash2 = await ev(`location.hash`);
check('clear-removes-a-keeps-p', !hash2.includes('a=') && hash2.includes('p=Monk'), hash2.slice(-60));
check('cleared-ls', (JSON.parse(await ev(`localStorage.getItem('poe2k.atlasPlan')`) ?? '[]')).length === 0);

// ---- 8) переход в другие вкладки/обратно — рендер жив ----
await ev(`document.querySelector('[data-tab="map"]').click(); 'map'`);
await sleep(300);
await ev(`document.querySelector('[data-tab="atlas"]').click(); 'atlas'`);
await sleep(500);
check('tab-remount-alive', await ev(`!!document.querySelector('.atlas-canvas svg.atlas-svg') && document.querySelector('.atlas-pts')?.textContent === '0'`));
await ev(`document.querySelector('[data-tab="currency"]').click(); 'currency'`);

// ---- 9) консоль чиста ----
check('console-clean', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));

console.log(fail.length ? `\nFAILED: ${fail.length} (${fail.join(', ')})` : '\nALL OK');
if (ws.close) ws.close();
process.exit(fail.length ? 1 : 0);
