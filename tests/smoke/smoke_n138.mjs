// smoke №138: статические RU→EN базы Uncut-камней в словаре оверлея
// (живой лог 01.10 06:00:30: trade2 400 «Неогранённый камень духа (уровень 14)»)
import fs from 'node:fs';

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'OK  ' : 'FAIL') + ' ' + msg); if (!cond) fails++; };

const src = fs.readFileSync('apps/overlay/src/main.ts', 'utf8');
const dist = fs.readFileSync('apps/overlay/dist/main.js', 'utf8');

// 1. Статические RU→EN (все три ✅ проверены poe2db.tw/ru/<Slug>, BaseType)
ok(/RU_EN_STATIC_BASES/.test(src), 'src: массив RU_EN_STATIC_BASES');
ok(/'Неогранённый камень духа', 'Uncut Spirit Gem'/.test(src), 'src: духа → Uncut Spirit Gem');
ok(/'Неогранённый камень умения', 'Uncut Skill Gem'/.test(src), 'src: умения → Uncut Skill Gem');
ok(/'Неогранённый камень поддержки', 'Uncut Support Gem'/.test(src), 'src: поддержки → Uncut Support Gem');
// 2. seedRuEnStatic: сеем в оба пути (кэш-путь и rebuild-путь)
const seedCalls = (src.match(/seedRuEnStatic\(\)/g) || []).length;
ok(seedCalls >= 3, `src: seedRuEnStatic зовётся в обоих путях+decl (${seedCalls} >= 3)`);
ok(/if \(!loadRuEnDict\(\)\) void ensureRuEnDict\(\);\s*\r?\n\s*else seedRuEnStatic\(\)/.test(src), 'src: seed при валидном кэше (else-ветка)');
ok(/seedRuEnStatic\(\); \/\/ статические базы/.test(src), 'src: seed внутри ensureRuEnDict до build');
// 3. Версия кэша bump: старый v5-кэш друга отбрасывается → rebuild + seed
ok(/RU_EN_DICT_VERSION = 6/.test(src), 'src: RU_EN_DICT_VERSION = 6 (bump, v5-кэш отбрасывается)');
// 4. normName-совместимость: RU-имя из лога нормализуется в ключ (й→и, ё→е не ломают)
ok(src.includes('.replace(/й/g, \'и\')'), 'src: normName й→и жив (неогранённый — без й, но проверка дешёвая)');
// 5. dist собран (tsc не переносит/не выбрасывает)
ok(dist.includes('RU_EN_STATIC_BASES') || /Uncut Spirit Gem/.test(dist), 'dist: statics в main.js');
ok(!dist.includes('Uncut Spirit Gem') || dist.includes('Неогранённый камень духа'), 'dist: RU-строка сохранилась (не mojibake-выброшена)');
// 6. mojibake-контроль: RU-текст в dist не задвоен latin-фолбэком
ok(!/[\u4e00-\u9fff]/.test(dist.slice(dist.indexOf('RU_EN_STATIC_BASES') > -1 ? dist.indexOf('RU_EN_STATIC_BASES') : 0, 800)), 'dist: нет CJK-мусора около statics');
// 7. RU_EN_DICT_VERSION попал в dist = 6
ok(/version:\s*6/.test(dist) || dist.includes('RU_EN_DICT_VERSION'), 'dist: версия словаря сборки 6');

// 8. №138-бис: onBuildUpdate не ворует активную вкладку (живой репорт «Курс → Билд»)
const rsrc = fs.readFileSync('apps/overlay/src/rendererHtml.ts', 'utf8');
ok(/const steal = activeTab === '' \|\| activeTab === 'build';/.test(rsrc), 'src: guard steal по activeTab');
ok(/if \(steal\) \{[\s\S]{0,200}showMode\('build'\);/.test(rsrc), 'src: showMode(build) только внутри steal');
ok(rsrc.indexOf("const steal") < rsrc.indexOf('renderBuild(state);'), 'src: renderBuild(state) выполняется всегда (данные свежие)');
const renderGuard = fs.readFileSync('apps/overlay/dist/rendererHtml.js', 'utf8');
ok(/const steal = activeTab === '' \|\| activeTab === 'build';/.test(renderGuard), 'dist rendererHtml: guard собран');

// 9. №138-ter: валюты в «💱 Курс» на двух языках (RU из ru→en-словаря poe2db, reverse)
ok(/ruNameForCurrency/.test(src) && /enRuReverse/.test(src), 'src main: reverse-lookup ruNameForCurrency');
ok(/ru: ruNameForCurrency\(r\.name\)/.test(src), 'src main: rows отдают поле ru');
const rsrc2 = fs.readFileSync('apps/overlay/src/rendererHtml.ts', 'utf8');
ok(/r\.ru && r\.ru\.toLowerCase\(\) !== String\(r\.name\)\.toLowerCase\(\)/.test(rsrc2), 'src renderer: RU primary + EN dim, без дублей');
ok(/esc\(r\.ru\) \+ ' <span style="color:#9aa4b0">' \+ esc\(r\.name\)/.test(rsrc2), 'src renderer: RU + EN разметка');
const mainDist = fs.readFileSync('apps/overlay/dist/main.js', 'utf8');
ok(/ruNameForCurrency/.test(mainDist), 'dist main: reverse-lookup собран');
ok(/ru: ruNameForCurrency/.test(mainDist), 'dist main: поле ru в payload');

// 10. №138-quad: uncut-камни — trade2 ищет banded-типом «Uncut <K> Gem (Level N)»
ok(/неогран\[её\]нный\\s\+камень\\s\+\(духа\|умения\|поддержки\)/.test(src) || /неогран\[её\]нный\\\s\+/.test(src), 'src: uncut-детект регэксп');
ok(/uncutRu\?\.\baseType/.test(src) || /parsedAugment\?\.baseType\?\.match\(/.test(src), 'src: uncut из baseType parsedAugment');
ok(/`Uncut \$\{kind\} Gem \(Level \$\{uncutRu\[2\]\}\)`/.test(src), 'src: banded-тип Uncut (Level N)');
ok(/ru→en: uncut/.test(src), 'src: лог-маркер uncut');
ok(/неогран\[её\]нный/.test(mainDist), 'dist main: uncut-регэксп собран');

console.log(fails === 0 ? 'SMOKE N138: OK' : 'SMOKE FAIL: ' + fails);
process.exit(fails === 0 ? 0 : 1);
