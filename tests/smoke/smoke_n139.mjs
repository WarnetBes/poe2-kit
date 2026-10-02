// smoke №139: «🔗 Конструктор связок» в 🧬 Билды (gemdata IPC + вью)
import fs from 'node:fs';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };

const main = fs.readFileSync('apps/overlay/src/main.ts', 'utf8');
const mainDist = fs.readFileSync('apps/overlay/dist/main.js', 'utf8');
const ren = fs.readFileSync('apps/overlay/src/rendererHtml.ts', 'utf8');
const renDist = fs.readFileSync('apps/overlay/dist/rendererHtml.js', 'utf8');
const pre = fs.readFileSync('apps/overlay/src/preload.ts', 'utf8');
const preDist = fs.readFileSync('apps/overlay/dist/preload.cjs', 'utf8');

// main: IPC buildgen:gemdata из офлайн-датасетов
ok(/ipcMain\.handle\('buildgen:gemdata'/.test(main), "src main: хендлер buildgen:gemdata");
ok(/getSkillGems\(\)/.test(main) && /getSupportGems\(\)/.test(main), 'src main: датасеты skill/support');
ok(/kind === 'UncutSkillGem'/.test(main), 'src main: фильтр UncutSkillGem');
ok(/gemEnRu\.get\(normName\(g\.name\)\)/.test(main), 'src main: RU-имена из gemEnRu');
ok(/buildgen:gemdata/.test(mainDist), 'dist main: хендлер собран');
ok(/buildgen:gemdata/.test(preDist), 'dist preload: канал проброшен');

// preload: тип + invoke
ok(/buildgenGemData\((?:chunk\?: \{ offset: number; limit\?: number \})?\): Promise<unknown>/.test(pre), 'src preload: тип buildgenGemData (чанковый, №141)');
ok(/'buildgen:gemdata'/.test(pre), 'src preload: invoke buildgen:gemdata');

// renderer: режимы + фильтр + совместимость (№141: пресет-пример ⚡ УДАЛЁН по просьбе друга)
ok(/genMode === 'combo'/.test(ren) && /renderComboView\(\)/.test(ren), 'src renderer: режим combo + renderComboView');
ok(/\['\u041c\u043e\u043b\u043d\u0438\u044f', 'Lightning'/.test(ren), 'src renderer: чипс Молния/Lightning');
ok(!/'Ball Lightning', 'Azmerian Wolf', 'Comet'/.test(ren), 'src renderer: пресет ⚡ удалён (№141)');
ok(!/data-cmbpreset/.test(ren), 'src renderer: атрибут data-cmbpreset удалён (№141)');
ok(/data-cmbtag/.test(ren) && /data-cmbsup/.test(ren) && /data-cmben/.test(ren), 'src renderer: клик-атрибуты фильтра/выбора/саппортов');
ok(/comboSups\[kv\[0\]\]/.test(ren), 'src renderer: саппорты на актив (kv split ||)');
ok(/genModeChips\(\)/.test(ren), 'src renderer: тумблер режимов в мета-вью');
ok(/renderComboView/.test(renDist), 'dist renderer: combo-вью собран');
ok(!/data-cmbpreset/.test(renDist), 'dist renderer: кнопка пресета отсутствует (№141)');

console.log(fails === 0 ? 'SMOKE N139: OK' : 'SMOKE N139 FAIL: ' + fails);
process.exit(fails ? 1 : 0);
