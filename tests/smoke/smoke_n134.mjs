// smoke №133 (Слэнг) + №134 (Крафт): маркеры в dist + функциональный прогон core
import fs from 'node:fs';

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'OK  ' : 'FAIL') + ' ' + msg); if (!cond) fails++; };

const render = fs.readFileSync('apps/overlay/dist/rendererHtml.js', 'utf8');
const main = fs.readFileSync('apps/overlay/src/main.ts', 'utf8');
const preloadSrc = fs.readFileSync('apps/overlay/src/preload.ts', 'utf8');
const preload = fs.readFileSync('apps/overlay/dist/preload.cjs', 'utf8');
const coreIdx = fs.readFileSync('packages/core/dist/index.js', 'utf8');

// №133 слэнг
ok(/data-tab="slang"/.test(render), 'renderer: кнопка вкладки Слэнг');
ok(/slangWrap/.test(render), 'renderer: slangWrap');
ok(/SLANG_GLOSSARY/.test(render), 'renderer: словарь SLANG_GLOSSARY');
{ // После S1-выноса (№179) данные слэнга живут в rendererData.js; в rendererHtml.js — плейсхолдер интерполяции.
  const data = fs.readFileSync('apps/overlay/src/rendererData.ts', 'utf8') ||
    fs.readFileSync('apps/overlay/dist/rendererData.js', 'utf8');
  const seg = data.slice(data.indexOf('SLANG_GLOSSARY'), data.indexOf('CRAFT_SYSTEMS'));
  const n = (seg.match(/\['[^']+', '/g) || []).length;
  ok(n >= 45, 'renderer: слэнг-записей >= 45 (факт: ' + n + ')');
  ok(render.includes('${JSON.stringify(SLANG_GLOSSARY'), 'renderer: SLANG_GLOSSAY интерполируется из rendererData'); }
{ const dataSrc = fs.readFileSync('apps/overlay/src/rendererData.ts', 'utf8');
  const dataSeg = dataSrc.slice(dataSrc.indexOf('SLANG_GLOSSARY'), dataSrc.indexOf('CRAFT_SYSTEMS'));
  ok(/'slang', '📖 Слэнг'/.test(render) && !/[\u4e00-\u9fff]/.test(dataSeg), 'renderer: TABS_META + mojibake в глоссарии нет'); }

// №134 крафт
ok(/data-tab="craft"/.test(render), 'renderer: кнопка вкладки Крафт');
ok(/craftWrap/.test(render), 'renderer: craftWrap');
ok(/craftPlanBuffer/.test(render) && /craftCatalog/.test(render), 'renderer: IPC-вызовы крафта');
ok(/renderCraftView/.test(render) && /CRAFT_SYSTEMS/.test(render), 'renderer: рендер крафта + фильтр систем');
ok((render.match(/renderCraftView\(/g) || []).length >= 5, 'renderer: renderCraftView вызывается из всех веток');
ok(/lastCraftPlan/.test(render), 'renderer: персист последнего плана');
{ const sel = render.match(/#slangWrap::-webkit-scrollbar[\s\S]{0,120}#craftWrap::-webkit-scrollbar/) ||
  (render.includes('slangWrap::-webkit-scrollbar') && render.includes('craftWrap::-webkit-scrollbar'));
  ok(!!sel, 'renderer: скроллбары обоих врапов'); }
ok(/craft:catalog/.test(main) && /craft:plan/.test(main), 'main: оба IPC-хендлера');
ok(/'craft', 'rates', 'settings'/.test(main) || /'craft'/.test(main.match(/const PANEL_TABS[^\n]+/)?.[0] || ''), 'main: PANEL_TABS содержит craft');
ok(/CRAFT_RECIPES/.test(main) && /essenceSuggestions/.test(main), 'main: данные из core.craft');
ok(/craftCatalog/.test(preloadSrc) && /craftPlanBuffer/.test(preloadSrc), 'preload-интерфейс');
ok(/craft:catalog/.test(preload) && /craft:plan/.test(preload), 'preload dist: оба invoke');
ok(/craft: craftMod|craft: craft/.test(coreIdx) || /craftGuide/.test(coreIdx), 'core dist: namespace craft');

// функциональный прогон core: план по Waystone-тексту и по оружию
const core = await import('file:///' + process.cwd().replace(/\\/g, '/') + '/packages/core/dist/index.js');
const plan = core.core.craft.craftPlan({ itemClass: 'Waystones', baseType: 'Waystone', itemLevel: 82 });
ok(Array.isArray(plan) && plan.length >= 3, 'core: waystone-план >= 3 шагов (' + plan.length + ')');
const ess = core.core.craft.essenceSuggestions('Rings', 'Ruby Ring');
ok(Array.isArray(ess), 'core: essenceSuggestions работает (' + ess.length + ' подсказок)');
const cat = core.core.craft.CRAFT_RECIPES;
ok(cat.length === 37, 'core: CRAFT_RECIPES = 37 записей (' + cat.length + ')');
const systems = new Set(cat.map((r) => r.system));
ok(systems.size === 9, 'core: 9 систем в каталоге (' + [...systems].join(',') + ')');

console.log(fails === 0 ? 'SMOKE N133+N134: OK' : 'SMOKE FAIL: ' + fails);
process.exit(fails === 0 ? 0 : 1);
