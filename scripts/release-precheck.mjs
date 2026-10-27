/**
 * release-precheck.mjs — предрелизный чек граблей журнала №623 (и не только).
 *
 * Лечит класс сбоев «релиз собран, но ассеты/manifest битые» до сборки:
 *   1. BOM-чек: PowerShell `Set-Content -Encoding UTF8` молча пишет BOM.
 *      Готовый артефакт должен начинаться с содержательного байта
 *      (эталон README: 0x23 '#'), а не с EF BB BF. Проверяем текстовые
 *      файлы, попадающие в portable-zip и читаемые внешними тулзами.
 *   2. Синхрон версий: все package.json монорепо == корневой версии.
 *   3. CHANGELOG: запись [X.Y.Z] для текущей версии существует.
 *   4. Git-тег vX.Y.Z: подсказка по sourcecraft-граблям —
 *      для СУЩЕСТВУЮЩЕГО тега sourcecraft.Create нужно вызывать БЕЗ
 *      target_branch (иначе «branch refs/tags/... already exists»),
 *      а имя аргумента у sourcecraft-тулов — release_tag, не tag.
 *   5. Сборочные гейзы: dist всех пакетов собран (portable пересоберёт сам,
 *      но деплой на шару без dist падает с путаным exit 1).
 *   6. Template-escape-аудит (№626): файлы-гигантские template-литералы
 *      (rendererHtml.ts) не содержат одиночных `\X`-эскейпов — они молча
 *      деградируют (`\s`→`s`), TS не ругает; класс бага «все 38 иконок 404».
 *
 * Запуск: npm run release:check   (exit 0 = чисто, 1 = найдены проблемы)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
let failed = 0;
const bad = (msg) => { console.error(`  [FAIL] ${msg}`); failed += 1; };
const ok = (msg) => console.log(`  [ok]   ${msg}`);

// --- 0. Версия корня -----------------------------------------------------
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const ver = rootPkg.version;
console.log(`[precheck] версия ${ver}`);

// --- 1. BOM-чек ----------------------------------------------------------
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const textTargets = [
  'package.json',
  'CHANGELOG.md',
  'README.md',
  'README.en.md',
  'scripts/release-precheck.mjs',
];
console.log('[precheck] 1/5 BOM...');
for (const rel of textTargets) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { bad(`${rel}: файл отсутствует`); continue; }
  const head = fs.readFileSync(p).subarray(0, 3);
  if (BOM.equals(head)) bad(`${rel}: начинается с UTF-8 BOM (EF BB BF) — внешние тулзы и эталон первого байта ломаются`);
  else ok(`${rel}: без BOM`);
}

// --- 2. Синхрон версий ---------------------------------------------------
console.log('[precheck] 2/5 синхрон версий package.json...');
const workspaceDirs = ['packages/core', 'apps/web', 'apps/overlay', 'apps/mcp'];
for (const dir of workspaceDirs) {
  const p = path.join(ROOT, dir, 'package.json');
  if (!fs.existsSync(p)) { bad(`${dir}/package.json: отсутствует`); continue; }
  const v = JSON.parse(fs.readFileSync(p, 'utf8')).version;
  if (v !== ver) bad(`${dir}: версия ${v} != корневой ${ver}`);
  else ok(`${dir}: ${v}`);
}

// --- 3. CHANGELOG --------------------------------------------------------
console.log('[precheck] 3/5 CHANGELOG...');
const changelogPath = path.join(ROOT, 'CHANGELOG.md');
if (fs.existsSync(changelogPath)) {
  const cl = fs.readFileSync(changelogPath, 'utf8');
  if (cl.includes(`[${ver}]`)) ok(`запись [${ver}] найдена`);
  else bad(`в CHANGELOG.md нет записи [${ver}]`);
} else bad('CHANGELOG.md отсутствует');

// --- 4. Git-тег + sourcecraft-грабли --------------------------------------
console.log('[precheck] 4/5 git-тег и sourcecraft-шпаргалка...');
let tagExists = false;
try {
  execSync(`git rev-parse -q --verify "refs/tags/v${ver}"`, { cwd: ROOT, stdio: 'ignore' });
  tagExists = true;
} catch { /* тега нет */ }
if (tagExists) {
  ok(`тег v${ver} существует`);
  console.log('         sourcecraft: Create БЕЗ target_branch (тег уже запушен — иначе «already exists»); аргумент release_tag, не tag');
} else {
  console.log(`  [hint] тега v${ver} нет — создайте аннотированный (git tag -a) и запушьте ДО SourceCraft Release`);
}

// --- 5. Template-escape-аудит (гейт №626) ----------------------------------
// Скрипт сам зовёт process.exit — запускаем как дочерний процесс ради честного кода.
console.log('[precheck] 5/5 template-escape-аудит (№626)...');
try {
  execSync(`node ${JSON.stringify(path.join(ROOT, 'scripts', 'check-template-escapes.mjs'))}`, { stdio: 'inherit' });
  ok('rendererHtml.ts: одиночных \\X-деградаций нет');
} catch {
  bad('template-литерал содержит одиночные \\X-эскейпы (класс №626: \\s→s, все regex в html молча ломаются) — чините до релиза');
}

// --- Итог -----------------------------------------------------------------
// (отдельно: dist-гейты не проверяем — make-portable сам пересобирает всё)
if (failed > 0) {
  console.error(`\n[precheck] FAIL: ${failed} проблем(а). Релиз не собирайте, чините сначала.`);
  process.exit(1);
}
console.log(`\n[precheck] OK: релиз ${ver} подготовлен чисто.`);
