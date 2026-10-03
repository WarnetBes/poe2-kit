// №196-bis-смок (S7-UI): баннер «N модов не распознано» + кнопка Reload каталога.
// ПроверяемMarkers: dist рендерера (renderer/rendererShell) + парс вымита скрипта.
import { readFileSync } from 'node:fs';
let fail = 0;

const html = readFileSync('apps/overlay/dist/rendererHtml.js', 'utf8');
const shell = readFileSync('apps/overlay/dist/rendererShell.js', 'utf8');
const main = readFileSync('apps/overlay/dist/main.js', 'utf8');
const preload = readFileSync('apps/overlay/dist/preload.cjs', 'utf8');
const coreTrade = readFileSync('packages/core/dist/trade.js', 'utf8');
const coreSnap = readFileSync('packages/core/dist/tradeSnapshot.js', 'utf8');

// 1. Каркас: элемент баннера в shell (и скрыт по умолчанию)
if (!/id="statBanner" class="meta hide"/.test(shell)) {
  console.log('FAIL 1: statBanner отсутствует в rendererShell');
  fail++;
} else console.log('OK 1: statBanner в каркасе');

// 2. Рендерер: баннер наполняется по res.unmatchedMods, скрыт иначе
if (!/res\.unmatchedMods && res\.unmatchedMods\.length/.test(html) || !/\$\('statBanner'\)/.test(html)) {
  console.log('FAIL 2: рендер баннера по unmatchedMods не найден');
  fail++;
} else console.log('OK 2: рендер баннера по unmatchedMods');

// 3. Кнопка Reload вызывает IPC-мост
if (!/reloadTradeStats\(\)/.test(html)) {
  console.log('FAIL 3: обработчик reloadTradeStats не найден в рендерере');
  fail++;
} else console.log('OK 3: кнопка Reload → reloadTradeStats()');

// 4. showMode гасит баннер вне прайс-вью
if (!/\$\('statBanner'\)\.classList\.toggle\('hide', mode !== 'price'\)/.test(html)) {
  console.log('FAIL 4: showMode не гасит statBanner вне price');
  fail++;
} else console.log('OK 4: showMode гасит баннер вне прайс-вью');

// 5. Мост: preload регистрирует trade:reloadStats
if (!/ipcRenderer\.invoke\('trade:reloadStats'\)/.test(preload)) {
  console.log('FAIL 5: preload не пробрасывает trade:reloadStats');
  fail++;
} else console.log('OK 5: preload-мост на месте');

// 6. Main: IPC-обработчик сбрасывает кэши statMatching
if (!/ipcMain\.handle\('trade:reloadStats'/.test(main) || !/resetStatMatchingCaches\(\)/.test(main)) {
  console.log('FAIL 6: IPC trade:reloadStats в main не найден / без reset кэшей');
  fail++;
} else console.log('OK 6: main: IPC + resetStatMatchingCaches');

// 7. Core: priceCheck пробрасывает unmatchedMods/statMatch
if (!/unmatchedMods \? \{ unmatchedMods \} : \{\}/.test(coreTrade) || !/statMatch \? \{ statMatch \} : \{\}/.test(coreTrade)) {
  console.log('FAIL 7: core/trade.js не пробрасывает unmatchedMods/statMatch');
  fail++;
} else console.log('OK 7: core/trade.js пробрасывает unmatchedMods + statMatch');

// 8. Консолидация: снапшот читает trade_stats.json (не stats_snapshot)
// (комментарии вырезаем — там stats_snapshot упомянут в описании консолидации)
const snapNoComments = coreSnap.replace(/^[ \t]*(\/\/|\*|\/\*).*$/gm, '');
if (/stats_snapshot\.json/.test(snapNoComments) || !/trade_stats\.json/.test(coreSnap)) {
  console.log('FAIL 8: tradeSnapshot читает старый stats_snapshot.json');
  fail++;
} else console.log('OK 8: tradeSnapshot на едином trade_stats.json');

// 9. Эмит-гигиена (грабли №96): скрипт панели парсится как JS
try {
  const mod = await import('../../apps/overlay/dist/rendererHtml.js');
  const m = mod.rendererHtml.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('no <script> block in emitted html');
  new Function(m[1]);
  console.log('OK 9: emitted <script> парсится (нет \\n-эмит SyntaxError)');
} catch (e) {
  console.log('FAIL 9: emitted script не парсится: ' + (e instanceof Error ? e.message : e));
  fail++;
}

console.log(fail === 0 ? 'ALL OK' : 'FAILURES: ' + fail);
process.exit(fail === 0 ? 0 : 1);
