// Смок №113: боковая колонка вкладок + №113b видимость вкладок.
// Проверяет и emitted-JS rendererHtml.js, и логику normalize hiddenTabs из main.js.
const mod = await import('../../apps/overlay/dist/rendererHtml.js');
const html = mod.rendererHtml;

let fail = 0;
const need = (cond, name) => { console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name); if (!cond) fail = 1; };

// №113: колонка сбоку.
need(html.includes('flex-direction: row'), '#panel row');
need(/\.tabrow \{[^}]*flex-direction: column/.test(html), '.tabrow column');
need(html.includes('id="content"'), '#content wrapper');
need(html.includes('/#content №113'), '#content закрыт с комментарием-маркером');

// №113b: чекбоксы вкладок.
need(html.includes('id="tabsGrid"'), 'HTML #tabsGrid');
need(html.includes('TABS_META'), 'TABS_META список');
need(html.includes('collectHiddenTabs'), 'collectHiddenTabs');
need(html.includes('applyTabVisibility'), 'applyTabVisibility');
need(/buildTabsGrid\(s\)/.test(html), 'buildTabsGrid вызывается при построении панели настроек');
need(/applyTabVisibility\(s\.hiddenTabs\)/.test(html), 'применение hiddenTabs на старте');
need(/applyTabVisibility\(res\.settings && res\.settings\.hiddenTabs\)/.test(html), 'применение после сохранения');

const m = html.match(/<script>([\s\S]*?)<\/script>/);
try { new Function(m[1]); console.log('OK   script парсится'); } catch (e) { console.log('FAIL SyntaxError:', e.message); fail = 1; }

// main.js: normalize-hiddenTabs — эмулируем ядро регэкспом нельзя, проверим маркеры компиляции.
const fs = await import('node:fs');
const mainJs = fs.readFileSync('apps/overlay/dist/main.js', 'utf8');
need(mainJs.includes('PANEL_TABS'), 'main: PANEL_TABS');
need(/hiddenTabs/.test(mainJs), 'main: hiddenTabs в dist');
need(mainJs.includes('v !== "settings"') || mainJs.includes("v !== 'settings'"), 'main: settings не скрыть');

process.exit(fail);
