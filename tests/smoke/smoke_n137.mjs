// smoke №137: полное дополнение крафт-каталога из poe2db (эссенции/спец/сплавы/омены)
import fs from 'node:fs';

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'OK  ' : 'FAIL') + ' ' + msg); if (!cond) fails++; };

const src = fs.readFileSync('packages/core/src/craftGuide.ts', 'utf8');
const coreDist = fs.readFileSync('packages/core/dist/craftGuide.js', 'utf8');
const main = fs.readFileSync('apps/overlay/src/main.ts', 'utf8');
const render = fs.readFileSync('apps/overlay/dist/rendererHtml.js', 'utf8');

// Эссенции: 19 семейств + обязательные новые
const essCount = (src.match(/en: 'Essence of /g) || []).length;
ok(essCount >= 19, `core: CRAFT_ESSENCES — ${essCount} семейств (>=19)`);
ok(/Essence of Flames/.test(src) && /Essence of Alacrity/.test(src) && /Essence of Opulence/.test(src) && /Essence of Command/.test(src), 'core: новые семейства Flames/Alacrity/Opulence/Command');
ok(/perfect\?: string/.test(src), 'core: поле perfect у EssenceInfo');
ok((src.match(/perfect: '/g) || []).length >= 15, 'core: perfect-моды заполнены');
// Спец-эссенции и сплавы
ok(/CRAFT_SPEC_ESSENCES/.test(src), 'core: CRAFT_SPEC_ESSENCES');
ok(/Essence of Hysteria/.test(src) && /Essence of Delirium/.test(src) && /Essence of the Breach/.test(src), 'core: спец-эссенции Hysteria/Delirium/Breach');
ok(/CRAFT_ALLOYS/.test(src), 'core: CRAFT_ALLOYS');
ok(/Runic Alloy|Celestial Alloy/.test(src) && (/Alloy/.test(src)), 'core: сплавы Aldur');
const alloyCount = (src.match(/en: '(Runic|Adaptive|Protective|Expansive|Swift|Cyclonic|Prismatic|Mystic|Sovereign|Celestial|Transcendent) Alloy|The Runebinder's Alloy|The Runefather's Alloy/g) || []).length;
ok(alloyCount >= 13, `core: ${alloyCount} сплавов (>=13)`);
// Омены: полный список с drop-пометками
const omensBlock = src.slice(src.indexOf('export const CRAFT_OMENS'), src.indexOf('export const CRAFT_RECIPES'));
const omenCount = (omensBlock.match(/\{ en: /g) || []).length;
ok(omenCount >= 46, `core: CRAFT_OMENS — ${omenCount} записей (>=46)`);
ok(/не дропается с 0\.3\.0/.test(src), 'core: пометки снятых с дропа (0.3.0)');
ok(/отключён с 0\.4\.0/.test(src), 'core: пометки Homogenising (0.4.0)');
ok(/drop\?: string/.test(src), 'core: поле drop у OmenInfo');
ok(/Omen of Putrefaction/.test(src) && /Omen of Corruption/.test(src) && /Omen of the Blessed/.test(src), 'core: новые омены Putrefaction/Corruption/Blessed');
// dist core
ok(/CRAFT_SPEC_ESSENCES/.test(coreDist) && /CRAFT_ALLOYS/.test(coreDist), 'core dist: новые массивы собраны');
// main + renderer
ok(/specEssences/.test(main) && /alloys/.test(main), 'main: craft:catalog отдаёт specEssences + alloys');
ok(/Спец-эссенции/.test(render) && /Alloys/.test(render), 'renderer: секции спец-эссенций и сплавов');
ok(/o\.drop/.test(render), 'renderer: рендер drop-пометок оменов');
// mojibake-контроль (CJK в исходнике недопустим)
ok(!/[\u4e00-\u9fff]/.test(src), 'core: нет CJK-мусора в craftGuide.ts');

console.log(fails === 0 ? 'SMOKE N137: OK' : 'SMOKE FAIL: ' + fails);
process.exit(fails === 0 ? 0 : 1);
