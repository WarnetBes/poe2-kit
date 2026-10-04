// в„–210 СѓСЂРѕРІРµРЅСЊ 2: e2e РїР»Р°РЅРёСЂРѕРІС‰РёРєР° РІ Р±СЂР°СѓР·РµСЂРµ (headless Edge CDP 9223, dist РЅР° 5174).
//е®ћж™Ї-РєР»РёРє РїРѕ СѓР·Р»Сѓ WebGL-РєР°СЂС‚С‹: РєРѕРѕСЂРґРёРЅР°С‚С‹ РІС‹С‡РёСЃР»СЏРµРј РґРµС‚РµСЂРјРёРЅРёСЂРѕРІР°РЅРЅРѕ вЂ”
// tree-react СЃС‚Р°СЂС‚СѓРµС‚ СЃ centreViewport(scene, w, h) (viewport.js:28), РјС‹ РїРѕРІС‚РѕСЂСЏРµРј
// РµРіРѕ РІ Node РЅР° С‚РѕРј Р¶Рµ data.json Рё РїРѕР»СѓС‡Р°РµРј СЌРєСЂР°РЅРЅС‹Рµ РєРѕРѕСЂРґРёРЅР°С‚С‹ СѓР·Р»Р°.
// РџСЂРѕРІРµСЂРєРё: restore РёР· #p=hash, Р±РµР№РґР¶ В«РџР»Р°РЅ: NВ», Р¶РёРІРѕР№ РєР»РёРє = path-Р°Р»Р»РѕРєР°С†РёСЏ
// (СЂР°Р·РјРµСЂ СЃРІРµСЂСЏРµРј СЃ tree-core toggleAllocation РЅР° С‚РѕРј Р¶Рµ СЃРѕСЃС‚РѕСЏРЅРёРё), РїРѕРІС‚РѕСЂРЅС‹Р№
// РєР»РёРє = СЃРЅСЏС‚РёРµ, В«рџ§№ РЎР±СЂРѕСЃВ», persist/hash-СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ, РєРѕРЅСЃРѕР»СЊ Р±РµР· РёСЃРєР»СЋС‡РµРЅРёР№.
import { readFileSync } from 'node:fs';

const NM = 'file:///C:/Users/mezhavikiserj/BildPOE2/poe2-kit/node_modules/@poe2-toolkit/tree-core/dist/';
const { normalizeGggTree } = await import(NM + 'ggg/normalize.js');
const { buildScene } = await import(NM + 'scene/buildScene.js');
const { buildTreeGraph, toggleAllocation } = await import(NM + 'scene/allocate.js');

const DATA = 'C:/Users/mezhavikiserj/BildPOE2/poe2-kit/packages/core/data/game/passive_tree/export/data.json';
const tree = normalizeGggTree(JSON.parse(readFileSync(DATA, 'utf8')), '0_5');
const scene = buildScene(tree);
const monk = tree.classes.find((c) => c.name === 'Monk');
const graph = buildTreeGraph(tree, monk.startNode);

// РџР»Р°РЅ РґР»СЏ restore-С‚РµСЃС‚Р°: РєРѕСЂРѕС‚РєР°СЏ С†РµРїСЊ Monk-РІРµС‚РєРё (РёР· L1: 10364 > 55342 > 17248)
const RESTORE_IDS = [10364, 55342, 17248];
// Р¦РµР»СЊ РєР»РёРєР°: СЃРѕСЃРµРґ СЃС‚Р°СЂС‚-СѓР·Р»Р° Monk (РґРёСЃС‚Р°РЅС†РёСЏ 1 вЂ” РіР°СЂР°РЅС‚РёСЂРѕРІР°РЅРЅРѕ РІ СЃС‚Р°СЂС‚РѕРІРѕРј
// hub-РІРёРґРµ: windowRadius = ring.artRadius*1.6 РїРѕРєСЂС‹РІР°РµС‚ РєРѕР»СЊС†Рѕ РєР»Р°СЃСЃРѕРІ), РЅРµ РёР· restore-С†РµРїРё.
const startNeighbors = [...(graph.get(monk.startNode) ?? [])].filter((id) => !RESTORE_IDS.includes(id) && graph.has(id));
if (!startNeighbors.length) { console.error('no clickable neighbor of class start'); process.exit(1); }
const TARGET = startNeighbors[0];
const nodeTarget = scene.nodes.find((n) => n.skill === TARGET);
if (!nodeTarget) {
  console.error(`node ${TARGET} not in scene`); process.exit(1);
}
console.log(`  info: click target = ${TARGET} (neighbor of Monk start ${monk.startNode})`);

const fail = [];
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? `  [${extra}]` : ''));
  if (!cond) fail.push(name);
};

// в”Ђв”Ђ CDP-РїРѕРґРєР»СЋС‡РµРЅРёРµ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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

async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// в”Ђв”Ђ 1) РћС‚РєСЂС‹С‚РёРµ СЃ С€Р°СЂРёРЅРі-С…РµС€РµРј РїР»Р°РЅР° в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const hashPlan = `Monk::${RESTORE_IDS.join('.')}`;
await send('Page.navigate', { url: `http://127.0.0.1:5174/#p=${encodeURIComponent(hashPlan)}` });
let ready = false;
for (let i = 0; i < 40 && !ready; i++) {
  await sleep(250);
  ready = await ev(`!!document.querySelector('[data-tab="map"]')`).catch(() => false);
}
check('page-ready', ready);
await ev(`document.querySelector('[data-tab="map"]').click(); 'tab'`);
let wrap = false;
for (let i = 0; i < 40 && !wrap; i++) {
  await sleep(250);
  wrap = await ev(`!!document.querySelector('.tree-wrap .tree-top')`).catch(() => false);
}
check('map-rendered', wrap);

// WebGL-РјР°СѓРЅС‚ (Р»РµРЅРёРІС‹Р№ С‡Р°РЅРє + РґР°РЅРЅС‹Рµ ~5 РњР‘)
let canvasInfo = null;
for (let i = 0; i < 80 && !canvasInfo; i++) {
  await sleep(500);
  canvasInfo = await ev(`(function(){
    const c = document.querySelector('.tree-game-host canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { w: c.clientWidth, h: c.clientHeight, x: r.x, y: r.y, cw: c.width, ch: c.height };
  })()`).catch(() => null);
}
check('webgl-canvas', !!canvasInfo, canvasInfo ? `${canvasInfo.w}x${canvasInfo.h} dpr=${canvasInfo.cw / canvasInfo.w}` : 'no canvas');
check('webgl-no-fallback', await ev(`!document.querySelector('.btn-game')?.textContent.includes('РЅРµРґРѕСЃС‚СѓРїРЅРѕ')`));

// в”Ђв”Ђ 2) Restore-РїСЂРѕРІРµСЂРєРё в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const badgeText = await ev(`document.querySelector('#plan-badge b')?.textContent`);
check('restore-badge', badgeText === String(RESTORE_IDS.length), `badge=${badgeText} expected=${RESTORE_IDS.length}`);
const stored = await ev(`localStorage.getItem('poe2k.plan')`);
check('restore-persist', !!stored && stored.includes('Monk'), String(stored).slice(0, 80));
const svgMarks = await ev(`document.querySelectorAll('.tree-svg .mplan').length`);
check('restore-svg-marks', svgMarks === RESTORE_IDS.length, `marks=${svgMarks}`);
check('hash-kept', (await ev('location.hash')).includes('p=Monk'), await ev('location.hash'));

// ── 2a) Калькулятор плана: сводка модификаторов (№215b) ──────────────────────
const calcVisible = !(await ev(`document.querySelector('#pane-map .atlas-calc')?.hidden ?? true`));
check('calc-shown', calcVisible === true, `hidden=${await ev(`document.querySelector('#pane-map .atlas-calc')?.hidden`)}`);
const calcRows = (await ev(`document.querySelectorAll('#pane-map .atlas-calc-list li').length`)) ?? 0;
check('calc-rows-2', calcRows === 2, `rows=${calcRows} (expect: +10 to any Attribute x2, 4% Skill Speed)`);
const calcHtml = await ev(`document.querySelector('#pane-map .atlas-calc-list')?.innerHTML ?? ''`);
check('calc-attr-stack', calcHtml.includes('+10 to any Attribute'), '');
check('calc-skill-speed', calcHtml.includes('4% increased Skill Speed'), '');
check('calc-size', (await ev(`document.querySelector('#pane-map .atlas-calc-n')?.textContent`)) === '(3)', '');

// в”Ђв”Ђ 3) Р–РёРІРѕР№ РєР»РёРє = path-Р°Р»Р»РѕРєР°С†РёСЏ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// РџРѕРІС‚РѕСЂСЏРµРј centreViewport (viewport.js:28): scale = min(w,h)/(windowRadius*2),
// windowRadius = max(ring.artRadius*1.6, 2000), С†РµРЅС‚СЂ = scene.centre.centre.
if (!canvasInfo) { console.error('cannot proceed without canvas'); process.exit(1); }
const { w, h, x, y } = canvasInfo;
const ring = scene.centre.ring;
const windowRadius = Math.max(ring.artRadius * 1.6, 2000);
const scale = Math.min(w, h) / (windowRadius * 2);
const tx = w / 2 - scene.centre.centre.x * scale;
const ty = h / 2 - scene.centre.centre.y * scale;
const sx = Math.round(x + nodeTarget.x * scale + tx);
const sy = Math.round(y + nodeTarget.y * scale + ty);
console.log(`  info: viewport scale=${scale.toFixed(3)} target screen=(${sx},${sy}) node world=(${nodeTarget.x},${nodeTarget.y})`);
check('click-in-canvas', sx > x + 8 && sx < x + w - 8 && sy > y + 8 && sy < y + h - 8, `(${sx},${sy}) vs canvas ${x.toFixed(0)},${y.toFixed(0)} ${w}x${h}`);

// РѕР¶РёРґР°РµРјС‹Р№ СЂР°Р·РјРµСЂ РїРѕСЃР»Рµ РєР»РёРєР° вЂ” СЃС‡РёС‚Р°РµРј С‚РµРј Р¶Рµ tree-core РЅР° restore-СЃРѕСЃС‚РѕСЏРЅРёРё
const allocBefore = new Set(RESTORE_IDS);
const expectedAfter = toggleAllocation(tree, monk.startNode, allocBefore, TARGET, graph);
const expectedAfterCount = new Set(expectedAfter).size;
console.log(`  info: expected plan size after click: ${RESTORE_IDS.length} -> ${expectedAfterCount}`);

// pointerdown+pointerup РїРѕ canvas (TreeView СЃР»СѓС€Р°РµС‚ pointer-СЃРѕР±С‹С‚РёСЏ; CDP Input РёС… РіРµРЅРµСЂРёС‚)
// РґРёР°РіРЅРѕСЃС‚РёРєР°: С‡С‚Рѕ Р»РµР¶РёС‚ РїРѕРґ С‚РѕС‡РєРѕР№ Рё РґРѕС…РѕРґРёС‚ Р»Рё pointerdown
const topEl = await ev(`(function(){const e=document.elementFromPoint(${sx},${sy});return e?e.tagName+'.'+e.className:'#none';})()`);
console.log(`  info: elementFromPoint(${sx},${sy}) = ${topEl}`);
await ev(`window.__pdown=[];document.addEventListener('pointerdown',e=>window.__pdown.push(e.target.tagName),true);'hooked'`);
const missed = await ev(`(function(){const c=document.querySelector('.tree-game-host canvas');return {x:c.getBoundingClientRect().x,y:c.getBoundingClientRect().y,w:c.clientWidth,h:c.clientHeight};})()`);
console.log(`  info: canvas rect now: ${JSON.stringify(missed)}`);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 });
await sleep(60);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx, y: sy, button: 'left', clickCount: 1 });
await sleep(800);
console.log(`  info: pointerdown targets seen: ${JSON.stringify(await ev('window.__pdown'))}`);

const badgeAfter = await ev(`document.querySelector('#plan-badge b')?.textContent`);
check('click-alloc-count', badgeAfter === String(expectedAfterCount), `badge=${badgeAfter} expected=${expectedAfterCount}`);
const detailName = await ev(`document.querySelector('#out-map .tname')?.textContent`);
console.log(`  info: detail card: ${detailName}`);
check('click-detail-card', typeof detailName === 'string' && detailName.length > 0, String(detailName));
const storedAfter = JSON.parse((await ev(`localStorage.getItem('poe2k.plan')`)) ?? '{}');
check('click-persist', Array.isArray(storedAfter.n) && storedAfter.n.includes(TARGET), JSON.stringify(storedAfter).slice(0, 100));
const hashAfter = await ev('location.hash');
check('click-hash', hashAfter.includes(String(TARGET)), hashAfter.slice(0, 90));

// в”Ђв”Ђ 4) РџРѕРІС‚РѕСЂРЅС‹Р№ РєР»РёРє = СЃРЅСЏС‚РёРµ (tip-remove) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const expectRemove = toggleAllocation(tree, monk.startNode, new Set(expectedAfter), TARGET, graph);
const expectRemoveCount = new Set(expectRemove).size;
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 });
await sleep(60);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx, y: sy, button: 'left', clickCount: 1 });
await sleep(800);
const badgeRemoved = await ev(`document.querySelector('#plan-badge b')?.textContent`);
check('click-remove-count', badgeRemoved === String(expectRemoveCount), `badge=${badgeRemoved} expected=${expectRemoveCount}`);

// в”Ђв”Ђ 5) РЎР±СЂРѕСЃ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
await ev(`document.querySelector('.btn-plan-reset').click(); 'reset'`);
await sleep(300);
check('reset-badge-hidden', await ev(`document.querySelector('#plan-badge').hidden === true`));
check('reset-buttons-hidden', await ev(`document.querySelector('.btn-plan-link').hidden === true && document.querySelector('.btn-plan-reset').hidden === true`));
check('reset-storage', await ev(`localStorage.getItem('poe2k.plan') === null`));
check('reset-hash', !(await ev('location.hash')).includes('p='), await ev('location.hash'));

// в”Ђв”Ђ 6) РљРѕРЅСЃРѕР»СЊ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
await sleep(300);
check('console-no-exceptions', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));

// СЃРєСЂРёРЅ
const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync('C:/Users/mezhavikiserj/BildPOE2/poe2-kit/_archive/e2e-planner.png', Buffer.from(shot.data, 'base64'));
console.log('screenshot: _archive/e2e-planner.png');

console.log(fail.length ? `\nFAILED: ${fail.length} (${fail.join(', ')})` : '\nALL PASS');
await send('Browser.close').catch(() => {});
process.exit(fail.length ? 1 : 0);
