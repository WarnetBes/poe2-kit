// CDP-скриншот оверлея в полном разрешении рендерера (мимо DPI окна).
// Использование: node scripts/cdp-shot.mjs [tab] [outfile]
//   tab: price|build|gems|import|level|maps|slang|craft|rates|gen|pinnacle|settings
// Требует запущенного: electron --remote-debugging-port=9222 apps/overlay
import { writeFileSync } from 'node:fs';

const tab = process.argv[2] || 'build';
const doClick = tab !== '-';
const outfile = process.argv[3] || `docs/screenshots/overlay-${tab}.png`;

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('page target not found'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
  }
};

await new Promise((res) => { ws.onopen = res; });

// Переключаем вкладку тем же способом, что и user-клик.
if (doClick) {
  await send('Runtime.evaluate', {
    expression: `(function(){var b=document.querySelector('#tabRow button[data-tab="${tab}"]');if(!b) return 'no-button';b.click();return 'ok';})()`,
  });
}
// Даём вкладке отрисоваться, скроллим панель наверх.
await send('Runtime.evaluate', {
  expression: `document.querySelector('#panel')?.scrollTo(0,0); document.documentElement.scrollTop=0; 'scrolled'`,
});
await new Promise((r) => setTimeout(r, 700));

const { data } = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
  fromSurface: true,
});
writeFileSync(outfile, Buffer.from(data, 'base64'));
const metrics = await send('Runtime.evaluate', {
  expression: `JSON.stringify({w:document.documentElement.clientWidth,h:document.documentElement.clientHeight})`,
  returnByValue: true,
});
console.log(`saved: ${outfile} viewport=${metrics.result.value}`);
ws.close();
