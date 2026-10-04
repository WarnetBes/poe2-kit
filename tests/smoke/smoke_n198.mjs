// №198-смок: офлайн-разбор .hideout (core.hideout) + web-вкладка «Хайдоуты».
// Проверяем dist core (после npm run build) и web-src: экспорты, маркеры, датасет.
import { readFileSync } from 'node:fs';
let fail = 0;

function need(ok, n, msg) {
  if (!ok) { console.log('FAIL ' + n + ': ' + msg); fail++; }
  else console.log('OK ' + n + ': ' + msg);
}

// 1. Core dist: hideout-модуль и экспорты
const coreHideout = readFileSync('packages/core/dist/hideout.js', 'utf8');
need(/parseHideout/.test(coreHideout) && /summarizeHideout/.test(coreHideout)
  && /encodeHideoutCode/.test(coreHideout) && /decodeHideoutCode/.test(coreHideout),
  1, 'core/hideout.js: parse/summarize/encode/decode');

// 2. Лимит 750 + честный unknown
need(/750/.test(coreHideout) && /'unknown'/.test(coreHideout),
  2, 'core/hideout.js: лимит 750 + классификация с unknown');

// 3. Фасад core: namespace hideout
const coreIndex = readFileSync('packages/core/dist/index.js', 'utf8');
need(/hideout: hideoutMod/.test(coreIndex) || /hideout: hideout/i.test(coreIndex),
  3, 'core/index.js: core.hideout в фасаде');

// 4. Фикс браузерного краша web (№112 questRewards → zoneNotes без HAS_DISK-гарда):
// fsMod! допускается только ПОСЛЕ первого гарда HAS_DISK в файле.
const zoneNotes = readFileSync('packages/core/src/zoneNotes.ts', 'utf8');
const guardAt = zoneNotes.indexOf('HAS_DISK');
const firstFs = zoneNotes.indexOf('fsMod!');
need(guardAt >= 0 && (firstFs < 0 || firstFs > guardAt),
  4, 'zoneNotes.ts: fsMod! только под HAS_DISK-гардом (браузер не падает)');

// 5. Датасет декора: >=5 баз (9 после слияния 12 нативных файлов, №200) + 100+ имен
const decor = JSON.parse(readFileSync('packages/core/data/game/hideout/decor.json', 'utf8'));
const decorNames = Object.keys(decor.decor).length;
need(Object.keys(decor.hideout_bases).length >= 5 && decorNames >= 100,
  5, 'data/game/hideout/decor.json: ' + Object.keys(decor.hideout_bases).length + ' баз, ' + decorNames + ' имен');

// 6. Web-вкладка: таб, пейн, рендерер
const main = readFileSync('apps/web/src/main.ts', 'utf8');
need(/data-tab="hideout"/.test(main) && /pane-hideout/.test(main) && /btn-hideout"/.test(main),
  6, 'web/main.ts: таб + пейн + кнопки хайдоута');
const webHideout = readFileSync('apps/web/src/hideout.ts', 'utf8');
need(/decodeHideoutCode/.test(webHideout) && /drawMiniMap/.test(webHideout) && /hd-own/.test(webHideout),
  7, 'web/hideout.ts: share-декод + мини-карта + чекбоксы «мой MTX»');

if (fail) { console.error('SMOKE N198 FAILED'); process.exit(1); }
console.log('SMOKE N198: ALL OK');
