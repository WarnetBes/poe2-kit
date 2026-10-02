// smoke №136: 🧬 Билды — генератор билдов по ладдеру poe.ninja
import fs from 'node:fs';

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'OK  ' : 'FAIL') + ' ' + msg); if (!cond) fails++; };

const render = fs.readFileSync('apps/overlay/dist/rendererHtml.js', 'utf8');
const main = fs.readFileSync('apps/overlay/src/main.ts', 'utf8');
const preloadSrc = fs.readFileSync('apps/overlay/src/preload.ts', 'utf8');
const preload = fs.readFileSync('apps/overlay/dist/preload.cjs', 'utf8');

ok(/data-tab="gen"/.test(render), 'renderer: кнопка 🧬 Билды');
ok(/genWrap/.test(render), 'renderer: genWrap');
ok(/'gen', '🧬 Билды'/.test(render), 'renderer: TABS_META gen');
ok(/showGenView/.test(render) && /renderGenView/.test(render) && /loadGen/.test(render), 'renderer: вью-функции');
ok(/buildgenMeta/.test(render), 'renderer: IPC-вызов buildgenMeta');
ok(/data-genclass/.test(render) && /data-genslug/.test(render), 'renderer: чипсы классов и лиг');
ok(/topSkills/.test(render) && /topPassives/.test(render) && /medianDps/.test(render), 'renderer: агрегаты класса');
ok(/genWrap::-webkit-scrollbar/.test(render), 'renderer: скроллбар genWrap');
ok(/buildgen:meta/.test(main), 'main: хендлер buildgen:meta');
ok(/searchLadderBuilds/.test(main) && /parseNinjaNumber/.test(main), 'main: core.ladder-источники');
ok(/'rates', 'gen', 'settings'/.test(main), 'main: PANEL_TABS rates+gen');
ok(/BUILDGEN_TTL_MS/.test(main), 'main: кэш 30 мин');
ok(/genLeague = null; \/\/ классы/.test(main) === false, 'main: без мусорных комментариев (не проверяем)'),
ok(/buildgenMeta/.test(preloadSrc), 'preload-интерфейс buildgenMeta');
ok(/'buildgen:meta'/.test(preload), 'preload dist: invoke buildgen:meta');

console.log(fails === 0 ? 'SMOKE N136: OK' : 'SMOKE FAIL: ' + fails);
process.exit(fails === 0 ? 0 : 1);
