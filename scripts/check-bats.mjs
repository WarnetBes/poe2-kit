// scripts/check-bats.mjs — guard No588: все .bat/.cmd в рабочем дереве обязаны быть
// CRLF (cmd.exe молча ломает if-блоки на LF — грабля №587-ter), без BOM, и не должны
// использовать `cd /d` (молчаливый провал на UNC — грабля №587).
// Выход: 0 = зелёно, 1 = найдены нарушения. Вызывается через npm run batlint
// и обёрнут в tests/smoke/smoke_bats.mjs (смок-зонт / CI).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '_portable', '.git', 'dist']);

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), out);
    } else if (/\.(bat|cmd)$/i.test(e.name)) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

const problems = [];
for (const f of walk(ROOT, [])) {
  const rel = relative(ROOT, f);
  const buf = readFileSync(f);
  // 1. BOM (cmd ломается на UTF-8 BOM в некоторых конфигурациях)
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)
    problems.push(`${rel}: UTF-8 BOM найден — убери (chcp 65001 + BOM ломает cmd)`);
  // 2. Голые LF: каждый 0x0A обязан идти после 0x0D
  let bare = 0, line = 1;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) { if (i === 0 || buf[i - 1] !== 0x0d) bare++; line++; }
  }
  if (bare > 0)
    problems.push(`${rel}: ${bare} LF-строк без CR (cmd требует CRLF — молчаливые поломки if-блоков, №587-ter)`);
  // 3. Кодировка: ASCII или валидный UTF-8 без BOM (cp1251/ANSI-кириллица — мусор при chcp 65001)
  const text = buf.toString('utf8', buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0);
  const badChar = text.match(/\uFFFD/);
  if (badChar)
    problems.push(`${rel}: невалидный UTF-8 (cp1251/ANSI?) — неверно отображается при chcp 65001`);
  // 4. `cd /d` — молчаливый провал на UNC-путях (REM-комментарии не считаются)
  const cdIdx = text.split(/\r?\n/).findIndex((l) => !/^\s*rem(?!\S)/i.test(l) && /(^|[\s&|(])cd\s+\/d(\s|$)/i.test(l));
  if (cdIdx >= 0)
    problems.push(`${rel}:${cdIdx + 1}: "cd /d" — на UNC путях молча проваливается, используй pushd (№587)`);
}

if (problems.length) {
  console.error('BATLINT FAILED:');
  for (const p of problems) console.error('  ' + p);
  console.error('Fix: convert to CRLF (PS: -replace "`r?`n","`r`n"), remove BOM, replace cd /d with pushd.');
  process.exit(1);
}
console.log('BATLINT OK: все .bat/.cmd — CRLF, без BOM, без cd /d.');
