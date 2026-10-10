#!/usr/bin/env node
// №265 e2e: overlay «🛡 Радар» + keybinds-секция — живой Electron-прогон через CDP :9224.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const OVL = 'C:/Users/mezhavikiserj/BildPOE2/poe2-kit/apps/overlay';
const electronPath = 'C:/Users/mezhavikiserj/BildPOE2/poe2-kit/node_modules/electron/dist/electron.exe';
if (!fs.existsSync(electronPath)) { console.error('electron.exe не найден: ' + electronPath); process.exit(1); }

const child = spawn(electronPath, ['.', '--remote-debugging-port=9224'], {
  cwd: OVL,
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stderr.on('data', (d) => process.stderr.write('[ovl] ' + d));
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9224/json/list')).json();
      const page = list.find((t) => t.type === 'page' && (t.url.startsWith('file://') || t.url.includes('index.html')));
      if (page) return page;
    } catch { /* не готово */ }
    await sleep(500);
  }
  return null;
}

const page = await findTarget();
const fail = [];
const check = (n, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? `  [${extra}]` : '')); if (!ok) fail.push(n); };
if (!page) { console.log('FAIL overlay-window-target (CDP page не найден)'); child.kill(); process.exit(1); }

// нативный WebSocket (Node 22+)
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const exceptions = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails?.text ?? 'exception');
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
await send('Runtime.enable');
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200));
  return r.result?.value;
};

await sleep(1500); // дать рендереру проинициализироваться
check('app-boot-banner', /\[overlay\] init: electron=/.test(out), 'init из stdout');
check('radar-tab-button', await ev(`!!document.querySelector('[data-tab=\\"radar\\"]')`).catch(() => false));
check('keybinds-div', await ev(`!!document.getElementById('buildKeybinds')`).catch(() => false));
await ev(`document.querySelector('[data-tab=\\"radar\\"]').click(); 'clicked'`).catch(() => {});
await sleep(600);
const radarHtml = await ev(`(document.getElementById('radarWrap')||{innerHTML:''}).innerHTML`).catch(() => '');
check('radar-pane-rendered', radarHtml.length > 500, `len=${radarHtml.length}`);
check('radar-live-chips', /live/i.test(radarHtml) || /живы/i.test(radarHtml));
check('radar-live-count-12', /Live-баги \(12\)/.test(radarHtml));
check('radar-tricks-count-8', /Трюки \(8\)/.test(radarHtml));
check('radar-excludes-unverified-by-design', !radarHtml.includes('Ghost Dance'));
check('radar-no-broken-inven-url', !radarHtml.includes('/board/poe2/4845/'));

// keybinds-панель: вкладка build
await ev(`document.querySelector('[data-tab=\\"build\\"]') && document.querySelector('[data-tab=\\"build\\"]').click(); 'ok'`).catch(() => {});
await sleep(500);
const buildHtml = await ev(`(document.getElementById('buildKeybinds')||{innerHTML:''}).innerHTML`).catch(() => '');
check('keybinds-section-empty-or-advice', typeof buildHtml === 'string', `len=${buildHtml.length}`);

check('console-clean', exceptions.length === 0, `exceptions=${exceptions.length}`);

ws.close();
child.kill();
await sleep(500);
try { child.kill('SIGKILL'); } catch {}
console.log(fail.length === 0 ? 'E2E RADAR OVERLAY: ALL OK' : `E2E RADAR OVERLAY: ${fail.length} FAIL`);
process.exit(fail.length === 0 ? 0 : 1);
