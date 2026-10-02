// №96/№101 script-смок: emitted-JS из rendererHtml.js должен компилироваться new Function
const mod = await import('../../apps/overlay/dist/rendererHtml.js');
const html = typeof mod.rendererHtml === 'string' ? mod.rendererHtml : null;
if (!html) { console.error('FAIL: rendererHtml не строка:', typeof mod.rendererHtml); process.exit(1); }
console.log('HTML length:', html.length);

const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: <script> не найден'); process.exit(1); }

try {
  new Function(m[1]);
  console.log('OK: script компилируется,', m[1].length, 'символов');
} catch (e) {
  console.error('FAIL: SyntaxError в emitted-JS:', e.message);
  process.exit(1);
}

const marks = ['importWrap', 'showImportView', 'importRun', "activeTab === 'import'", '№101',
  '№103', 'renderCamp', 'renderBosses', 'camp-boss', '⚔ Боссы', 'boss-grp-title', 'campStartPoll'];
for (const mk of marks) console.log((html.includes(mk) ? 'OK  ' : 'MISS') + ' ' + mk);
