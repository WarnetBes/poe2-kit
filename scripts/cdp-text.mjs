// Полный видимый текст панели — без фильтра листьев.
const tab = process.argv[2];
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
await new Promise((r) => { ws.onopen = r; });
if (tab) {
  await send('Runtime.evaluate', { expression: `(document.querySelector('#tabRow button[data-tab="${tab}"]')||{click(){}}).click()` });
  await new Promise((r) => setTimeout(r, 800));
}
const { result } = await send('Runtime.evaluate', {
  expression: `document.body.innerText.replace(/\\n{2,}/g,'\\n').slice(0,1500)`,
  returnByValue: true,
});
console.log(result.value);
ws.close();
