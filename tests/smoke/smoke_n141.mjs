// СМОУК №141: пресет ⚡ удалён; buildgen:gemdata чанками; buildgen:combocode.
import fs from 'node:fs';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };

const main = fs.readFileSync('apps/overlay/src/main.ts', 'utf8');
const mainDist = fs.readFileSync('apps/overlay/dist/main.js', 'utf8');
const ren = fs.readFileSync('apps/overlay/src/rendererHtml.ts', 'utf8');
const renDist = fs.readFileSync('apps/overlay/dist/rendererHtml.js', 'utf8');
const pre = fs.readFileSync('apps/overlay/src/preload.ts', 'utf8');
const preDist = fs.readFileSync('apps/overlay/dist/preload.cjs', 'utf8');
const coreIdx = fs.readFileSync('packages/core/src/index.ts', 'utf8');
const coreIdxDist = fs.readFileSync('packages/core/dist/index.js', 'utf8');

// ── main: чанковый gemdata ──
ok(/p\?: \{ offset\?: number; limit\?: number \}\)/.test(main), 'src main: gemdata принимает {offset,limit}');
ok(/Math\.min\(p\.limit, 500\)/.test(main), 'src main: жёсткий потолок чанка 500 гемов');
ok(/done: off \+ limit >= items\.length/.test(main), 'src main: флаг done последнего чанка');
ok(/items\.slice\(off, off \+ limit\)/.test(main), 'src main: срез items по offset');
ok(/off == null/.test(main), 'src main: легаси-вызов без offset = полный пейлоад');
ok(/buildgen:gemdata/.test(mainDist) && /offset/.test(mainDist), 'dist main: чанковый хендлер');
// ── main: combocode ──
ok(/ipcMain\.handle\('buildgen:combocode'/.test(main), 'src main: IPC buildgen:combocode');
ok(/encodeShareCode\(xml\)/.test(main), 'src main: XML → PoB-код через core.pobcode.encodeShareCode');
ok(/clipboard\.writeText\(code\)/.test(main), 'src main: код сразу в буфер обмена');
ok(/nameSpec="/.test(main), 'src main: гемы в XML по nameSpec (без выдуманных gemId/skillId)');
ok(/Связка пуста/.test(main), 'src main: отказ на пустую связку');
ok(/buildgen:combocode/.test(mainDist), 'dist main: combocode собран');
// ── core: pobcode в namespace core ──
ok(/import \* as pobcodeMod from '\.\/pobcode\.js'/.test(coreIdx), 'src core: import pobcode');
ok(/pobcode: pobcodeMod/.test(coreIdx), 'src core: core.pobcode namespace (№141)');
ok(/encodeShareCode/.test(coreIdxDist), 'dist core: encodeShareCode доступен');
// ── preload ──
ok(/buildgenComboCode/.test(pre) && /'buildgen:combocode'/.test(pre), 'src preload: buildgenComboCode');
ok(/buildgenComboCode/.test(preDist), 'dist preload: buildgenComboCode');
ok(/buildgenGemData: \(chunk\) =>/.test(pre), 'src preload: gemdata прокидывает chunk');
// ── renderer ──
ok(!/data-cmbpreset/.test(ren), 'src renderer: кнопка-пример ⚡ удалена');
ok(!/'Ball Lightning', 'Azmerian Wolf', 'Comet'/.test(ren), 'src renderer: пресет-массив удалён');
ok(/Код импорта/.test(ren) && /data-cmbcode/.test(ren), 'src renderer: кнопка «Код импорта»');
// №141-bis: кнопка ВСЕГДА видима (вне условного comboSel-блока).
ok(/comboCodeUi/.test(ren) && /supBlocks \+ comboCodeUi/.test(ren), 'src renderer: кнопка кода вне условного блока (всегда видна)');
ok(/buildgenComboCode\(payload\)/.test(ren), 'src renderer: вызов IPC с выбором');
ok(/buildgenGemData\(\{ offset: offset, limit: 400 \}\)/.test(ren), 'src renderer: чанковый pull по 400');
ok(/res\.done \|\| \(total && got >= total\)/.test(ren), 'src renderer: цикл до done');
ok (!/data-cmbpreset/.test(renDist), 'dist renderer: пресет отсутствует');
ok(/data-cmbcode/.test(renDist), 'dist renderer: кнопка кода собрана');
ok(/comboCodeUi/.test(renDist), 'dist renderer: кнопка кода безусловно видна (№141-bis)');
ok(/offset: offset, limit: 400/.test(renDist), 'dist renderer: чанковый pull собран');
// №142: пошаговые слоты связки (порядок 1..5 виден сразу).
ok(/Связка по порядку/.test(ren) && /data-cmbclear/.test(ren), 'src renderer: слоты 1..5 + чипс 🗑 Сброс (№142)');
ok(/№\' \+ \(ix \+ 1\)/.test(ren), 'src renderer: номер выбора в списке активов');
ok(/тапни навык в списке ниже/.test(ren), 'src renderer: подсветка следующего пустого слота');
ok(/slotsUi \+ actList \+ supBlocks \+ comboCodeUi/.test(ren), 'src renderer: слоты над списком активов');
ok(/data-cmbclear/.test(renDist), 'dist renderer: слоты/сброс собраны');

// ── поведенческий конвейер (живой dist-core): XML → код → importBuild → сетапы ──
const { encodeShareCode, decodeShareCode } = await import('../../packages/core/dist/pobcode.js');
const { buildGemSetups } = await import('../../packages/core/dist/build.js');
const xml = `<PathOfBuilding>\n<Build level="1" mainSkillGroup="1" viewMode="CODE"/>\n<Skills activeSkillSet="1">\n<SkillSet id="1">\n<Skill enabled="true" label="Ice Strike" mainActiveSkill="1">\n<Gem nameSpec="Ice Strike" level="20" quality="0" count="1" enabled="true"/>\n<Gem nameSpec="Elemental Focus Support" level="20" quality="0" count="1" enabled="true"/>\n</Skill>\n</SkillSet>\n</Skills>\n</PathOfBuilding>`;
const code = encodeShareCode(xml);
ok(decodeShareCode(code) === xml, `round-trip кода (${code.length} симв.) байт-в-байт`);
const setups = await buildGemSetups(code);
ok(setups.length === 1 && setups[0].active === 'Ice Strike', `buildGemSetups по коду: ${setups.length} связка, актив «${setups[0] ? setups[0].active : '—'}»`);
ok(setups[0] && (setups[0].supports || []).length === 1 && setups[0].supports[0] === 'Elemental Focus Support', 'саппорт из кода распознан');
const ci = await import('../../packages/core/dist/index.js');
ok(typeof ci.core.pobcode.encodeShareCode === 'function', 'dist core: core.pobcode.encodeShareCode живой');

console.log(fails === 0 ? '\n№141 SMOKE: ALL OK' : `\n№141 SMOKE: FAILURES=${fails}`);
process.exit(fails === 0 ? 0 : 1);
