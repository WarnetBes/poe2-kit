// E2E вкладки «Хайдоуты» (№198): headless-браузер по CDP поверх serve-dist.
// 1) открываем вкладку, 2) вставляем реальный PoE2-файл (Shoreline, POH id 69)
// в textarea, 3) жмём «Разобрать», 4) проверяем DOM и share-код round-trip,
// 5) скриншот в _archive/e2e-hideout.png.
// Требует: npm run serve-dist (apps/web) на 5173 и Edge/Chrome headless на 9223.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = readFileSync(join(ROOT, 'packages/core/test/fixtures/hideout/shoreline_poe2.hideout'), 'utf8');

const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('page target not found'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
};
await new Promise((res) => { ws.onopen = res; });

async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result?.value;
}

await send('Page.navigate', { url: 'http://127.0.0.1:5173/' });
// SPA рендерится JS: ждём появления табов (до 15с).
let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  await new Promise((r) => setTimeout(r, 250));
  ready = await send('Runtime.evaluate', { expression: `!!document.querySelector('[data-tab="hideout"]')`, returnByValue: true })
    .then((r) => r.result?.value === true)
    .catch(() => false);
}
if (!ready) { console.error('страница не отрендерила табы за 15с'); process.exit(1); }
console.log('page ready');

const fail = [];
function check(name, cond) { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fail.push(name); }

check('tab-button', await ev(`!!document.querySelector('[data-tab="hideout"]')`));
await ev(`document.querySelector('[data-tab="hideout"]').click(); 'clicked'`);
await new Promise((r) => setTimeout(r, 300));
check('pane-visible', await ev(`!!document.querySelector('#pane-hideout.active')`));
check('drop-zone', await ev(`!!document.querySelector('#hideout-drop')`));
check('file-input', await ev(`!!document.querySelector('#hideout-file')`));

// Вставляем реальный файл (JSON-безопасное внедрение: window-переменная, два шага).
const blob = `window.__sample = ${JSON.stringify(JSON.stringify(SAMPLE))};`;
await ev(blob);
await ev(`document.querySelector('#hideout-input').value = JSON.parse(window.__sample); 'set'`);
await ev(`document.querySelector('#btn-hideout').click(); 'go'`);
await new Promise((r) => setTimeout(r, 1200));

check('base-text', await ev(`document.querySelector('#out-hideout h3')?.textContent.includes('Shoreline') === true`));
check('progress-37', await ev(`document.querySelector('.hd-progress-num')?.textContent.trim().startsWith('37 / 750')`));
check('table-rows', await ev(`document.querySelectorAll('.hd-table tbody tr').length > 30`));
check('free-badge', await ev(`[...document.querySelectorAll('.hd-cat')].some(e => e.textContent.includes('бесплатно'))`));
check('canvas', await ev(`document.querySelector('#hd-canvas') !== null`));

// share-код записан после разбора
const shareOk = await ev(`!!localStorage.getItem('poe2k.hideout.last')`);
check('share-persisted', shareOk);

// share-код реально декодируется на той же странице: вставляем ЕГО как вход
check('share-decodes', await ev(`(function(){
  const code = localStorage.getItem('poe2k.hideout.last');
  if (!code || code.length < 100) return false;
  document.querySelector('#hideout-input').value = code;
  document.querySelector('#btn-hideout').click();
  return new Promise((res) => setTimeout(() => {
    const h3 = document.querySelector('#out-hideout h3');
    res(h3 !== null && h3.textContent.includes('Shoreline') &&
        document.querySelector('.hd-progress-num')?.textContent.trim().startsWith('37 / 750'));
  }, 1200));
})()`));

// Второй проход: Vastiri (есть store-mtx → чекбоксы «есть у меня»)
const VASTIRI = readFileSync(join(ROOT, 'packages/core/test/fixtures/hideout/vastiri_poe2.hideout'), 'utf8');
await ev(`window.__sample2 = ${JSON.stringify(JSON.stringify(VASTIRI))};`);
await ev(`document.querySelector('#hideout-input').value = JSON.parse(window.__sample2); 'set2'`);
await ev(`document.querySelector('#btn-hideout').click(); 'go2'`);
await new Promise((r) => setTimeout(r, 1200));
check('vastiri-parse', await ev(`document.querySelector('#out-hideout h3')?.textContent.includes('Vastiri Racecourse') === true`));
check('own-checkbox', await ev(`document.querySelectorAll('.hd-own').length >= 1`));
check('mtx-badge', await ev(`[...document.querySelectorAll('.hd-cat')].some(e => e.textContent.includes('MTX'))`));
// клик по первому чекбоксу → персист в localStorage + пересчёт «можно собрать»
await ev(`document.querySelector('.hd-own').click(); 'owned'`);
await new Promise((r) => setTimeout(r, 400));
check('owned-persisted', await ev(`(localStorage.getItem('poe2k.hideout.owned') || '').length > 2`));

let shotOk = false;
try {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync('_archive/e2e-hideout.png', Buffer.from(data, 'base64'));
  shotOk = true;
} catch { /* скриншот опционален */ }
console.log(shotOk ? 'screenshot: _archive/e2e-hideout.png' : 'screenshot skipped');

if (fail.length) { console.error('FAILED: ' + fail.join(', ')); process.exit(1); }
console.log('E2E HIDEOUT: ALL OK');
process.exit(0);
