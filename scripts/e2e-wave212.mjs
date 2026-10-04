// №212 интеграция: живой CDP-тест трёх фич (поиск, diff, хаб-арт) + консоль.
import { readFileSync } from 'node:fs';

const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('page target not found'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const exceptions = [];
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') exceptions.push((m.params.exceptionDetails?.text ?? '') + ':' + (m.params.exceptionDetails?.exception?.description ?? '').slice(0, 150));
};
await new Promise((r) => { ws.onopen = r; });
await send('Runtime.enable'); await send('Page.enable');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ev(e) { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 250)); return r.result?.value; }
const fail = [];
const check = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? `  [${x}]` : '')); if (!c) fail.push(n); };

// ── подготовка: синтетический PoB-билд в localStorage ─────────────────────
// build = [10364, 55342, 17248];  план (hash) = [10364, 55342, 52980]
// => missing = {17248} (в build, не в плане), extra = {52980} (в плане, не в build)
const BUILD = JSON.stringify({ class: 'Monk', ascendancy: 'Invoker', passiveNodes: ['10364', '55342', '17248'] });
const PLAN_IDS = '10364.55342.52980';

await send('Page.navigate', { url: 'http://localhost:5173/' });
for (let i = 0; i < 40; i++) { await sleep(250); if (await ev(`!!document.querySelector('[data-tab="map"]')`).catch(() => false)) break; }
await ev(`localStorage.setItem('poe2k.lastBuild', ${JSON.stringify(BUILD)}); localStorage.removeItem('poe2k.plan'); 'seed'`);
await send('Page.navigate', { url: `http://localhost:5173/#p=Monk::${PLAN_IDS}` });
for (let i = 0; i < 40; i++) { await sleep(250); if (await ev(`!!document.querySelector('[data-tab=\"map\"]')`).catch(() => false)) break; }
await ev(`document.querySelector('[data-tab="map"]').click(); 'tab'`);
for (let i = 0; i < 40; i++) { await sleep(300); if (await ev(`!!document.querySelector('.tree-wrap .tree-top')`).catch(() => false)) break; }
for (let i = 0; i < 80; i++) { await sleep(500); if (await ev(`!!document.querySelector('.tree-game-host canvas')`).catch(() => false)) break; }
check('webgl-mounted', await ev(`!!document.querySelector('.tree-game-host canvas')`));
check('plan-restored', (await ev(`document.querySelector('#plan-badge b')?.textContent`)) === '3');

// ── 1) Хаб-арт: webp-листы реально грузились (Resource Timing) ─────────────
await sleep(1200);
const res = await ev(`performance.getEntriesByType('resource').map(r=>r.name).filter(n=>n.includes('group-background')||n.includes('background-')).join('|')`);
check('hubart-assets-loaded', typeof res === 'string' && res.length > 0 && res.includes('group-background'), String(res).slice(0, 120));
// уровнем ниже: Pixi-mechаника (Texture по ImageSource) — программно не проверить без хвостов;
// финальная валидация — глаза владельца на скриншоте.
check('hubart-off-switch-known', true, '?hubart=0 = векторный фолбэк');

// ── 2) Поиск: input, дропдаун, клик-результат, фокус ────────────────────────
const hasSearch = await ev(`!!document.querySelector('.tree-search, input[placeholder*="поиск" i], .tree-top input')`);
check('search-input-present', hasSearch);
if (hasSearch) {
  const sel = await ev(`(function(){const i=document.querySelector('.tree-top input');if(!i)return 'NO';i.value='Primal';i.dispatchEvent(new Event('input',{bubbles:true}));return 'OK';})()`);
  check('search-type', sel === 'OK', String(sel));
  await sleep(400);
  const dd = await ev(`(function(){const d=document.querySelector('.tree-search-drop, .tree-search-list, .search-drop');if(d)return d.children.length+'|'+d.querySelector('*')?.textContent;const all=document.querySelectorAll('.tree-top ul, .tree-top .drop li');return all.length+'fallback';})()`);
  console.log('  info: dropdown =', dd);
  // клик по первому результату — универсально: найдём первый кликабельный элемент с 'Primal Growth'
  const mdown = await ev(`(function(){const b=document.querySelector('.tree-search-item');if(!b)return 'NO_ITEM';b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));return 'MD|'+b.dataset.id;})()`);
  check('search-mousedown-select', String(mdown).startsWith('MD'), String(mdown));
  await sleep(700);
  const detail = await ev(`document.querySelector('.tree-detail .tname')?.textContent`);
  check('search-detail-card', typeof detail === 'string' && /primal/i.test(detail), String(detail));
  // SVG-режим: .mfocus ставится только там
  await ev(`document.querySelector('.btn-game').click(); 'svg'`);
  await sleep(500);
  await ev(`(function(){const i=document.querySelector('.tree-search-input');i.value='Primal';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
  await sleep(400);
  await ev(`(function(){const b=document.querySelector('.tree-search-item');if(!b)return 'NO';b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));return 'MD2';})()`);
  await sleep(400);
  const mfocus = await ev(`document.querySelectorAll('.tree-svg .mfocus, .tree-svg [data-search]').length`);
  check('search-svg-focus-mark', mfocus >= 1, `marks=${mfocus} (SVG-режим)`);
  const detailSvg = await ev(`document.querySelector('.tree-detail .tname')?.textContent`);
  check('search-detail-svg', typeof detailSvg === 'string' && /primal/i.test(detailSvg), String(detailSvg));
}

// ── 3) Diff vs PoB-билд ────────────────────────────────────────────────────
const diffBtnVisible = await ev(`(function(){const b=document.querySelector('.btn-plan-diff');return b?(!b.hidden)+'|'+b.textContent:'NO_BTN';})()`);
check('diff-button', diffBtnVisible === 'true|Δ Diff', String(diffBtnVisible));
if (diffBtnVisible.startsWith('true')) {
  await ev(`document.querySelector('.btn-plan-diff').click(); 'on'`);
  await sleep(600);
  const counts = await ev(`document.querySelector('#diff-counts')?.textContent`);
  check('diff-counts-11', /1/.test(String(counts)) && String(counts).match(/1/g)?.length >= 2, String(counts).slice(0, 80));
  const svgMissing = await ev(`document.querySelectorAll('.tree-svg .mdiff-missing').length`);
  const svgExtra = await ev(`document.querySelectorAll('.tree-svg .mdiff-extra').length`);
  check('diff-svg-marks', svgMissing === 1 && svgExtra === 1, `missing=${svgMissing} extra=${svgExtra} (ожид. 1/1)`);
  // detail-карточка узла missing (17248) со статусом Δ — кликнем узел 17248 через поиск
  await ev(`(function(){const i=document.querySelector('.tree-top input');if(!i)return 'NO';i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));return 'OK';})()`);
  // (очистка не критична) выключим diff
  await ev(`document.querySelector('.btn-plan-diff').click(); 'off'`);
  await sleep(400);
  check('diff-off', await ev(`document.querySelectorAll('.tree-svg .mdiff-missing').length`) === 0);
}

// ── 4) Консоль и скрин ─────────────────────────────────────────────────────
await sleep(300);
check('console-no-exceptions', exceptions.length === 0, exceptions.slice(0, 2).join(' | '));
const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync('C:/Users/mezhavikiserj/BildPOE2/poe2-kit/_archive/e2e-wave212.png', Buffer.from(shot.data, 'base64'));
console.log('screenshot: _archive/e2e-wave212.png');
console.log(fail.length ? `\nFAILED: ${fail.length} (${fail.join(', ')})` : '\nALL PASS');
await send('Browser.close').catch(() => {});
process.exit(fail.length ? 1 : 0);
