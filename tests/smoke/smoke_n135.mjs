// smoke №135: курсы валют по лигам (вкладка 💱 Курс)
import fs from 'node:fs';

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'OK  ' : 'FAIL') + ' ' + msg); if (!cond) fails++; };

// S1-этап-2 (№179): кнопки — в rendererShell.js, скроллбары — в rendererCss.js.
const render = ['rendererHtml', 'rendererShell', 'rendererCss']
  .map(f => fs.readFileSync(`apps/overlay/dist/${f}.js`, 'utf8')).join('\n');
const main = fs.readFileSync('apps/overlay/src/main.ts', 'utf8');
const preloadSrc = fs.readFileSync('apps/overlay/src/preload.ts', 'utf8');
const preload = fs.readFileSync('apps/overlay/dist/preload.cjs', 'utf8');

ok(/data-tab="rates"/.test(render), 'renderer: кнопка 💱 Курс');
ok(/ratesWrap/.test(render), 'renderer: ratesWrap');
ok(/'rates', ' Currency Rates'|'rates', '💱 Курс'/.test(render), 'renderer: TABS_META rates');
ok(/showRatesView/.test(render) && /renderRatesView/.test(render) && /loadRates/.test(render), 'renderer: вью-функции');
ok(/currencyRates/.test(render), 'renderer: IPC-вызов currencyRates');
ok(/data-league/.test(render), 'renderer: чипсы лиг');
ok(render.includes('ratesWrap::-webkit-scrollbar'), 'renderer: скроллбар ratesWrap');
ok(/currency:rates/.test(main) && /fetchBestCurrencyRates/.test(main) && /fetchCurrencyHistory/.test(main), 'main: хендлер + источники core.trade');
ok(/'rates', 'gen', 'settings'/.test(main) || /'rates'/.test(main.match(/const PANEL_TABS[^\n]+/)?.[0] || ''), 'main: PANEL_TABS rates');
ok(/CURRENCY_TTL_MS/.test(main) && /currencyRatesCache/.test(main), 'main: кэш 10 мин');
ok(/currencyRates/.test(preloadSrc), 'preload-интерфейс currencyRates');
ok(/'currency:rates'/.test(preload), 'preload dist: invoke currency:rates');

// функциональный прогон core (живые API — уже проверены MCP-тулами, здесь сигнатуры)
const core = await import('file:///' + process.cwd().replace(/\\/g, '/') + '/packages/core/dist/index.js');
ok(typeof core.core.trade.fetchBestCurrencyRates === 'function' && typeof core.core.trade.fetchLeagues === 'function', 'core: fetchBestCurrencyRates/fetchLeagues существуют');

console.log(fails === 0 ? 'SMOKE N135: OK' : 'SMOKE FAIL: ' + fails);
process.exit(fails === 0 ? 0 : 1);
