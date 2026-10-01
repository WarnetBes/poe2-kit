// Текстовая верификация вкладок оверлея через CDP: что реально видно на экране.
// Использование: node scripts/cdp-dump.mjs build price gems level
import process from 'node:process';
const tabs = process.argv.slice(2);
if (!tabs.length) { console.error('usage: node scripts/cdp-dump.mjs tab...'); process.exit(1); }

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page');
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
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
  }
};
await new Promise((res) => { ws.onopen = res; });

const extract = `(() => {
  var els = document.querySelectorAll('#panel *');
  var out = [];
  for (var i = 0; i < els.length; i++) {
    var e = els[i];
    var s = getComputedStyle(e);
    var r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (e.children.length > 0) continue; // только листья
    var t = (e.innerText || '').trim().replace(/\\s+/g, ' ');
    if (t && t.length < 200 && e.offsetTop < document.querySelector('#panel').scrollTop + 1000) out.push(t);
  }
  return out.slice(0, 40);
})()`;

for (const tab of tabs) {
  await send('Runtime.evaluate', {
    expression: `(document.querySelector('#tabRow button[data-tab="${tab}"]')||{click(){}}).click()`,
  });
  await new Promise((r) => setTimeout(r, 800));
  const { result } = await send('Runtime.evaluate', { expression: extract, returnByValue: true });
  console.log(`\n=== tab: ${tab} ===`);
  for (const t of result.value) console.log('  ' + t);
}
ws.close();
