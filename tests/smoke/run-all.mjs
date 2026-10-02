// tests/smoke/run-all.mjs — последовательный прогон всех смок-тестов (cwd = корень репо).
// Выход: exit 1, если хоть один смок упал (non-zero). Каждый смок печатает свои проверки.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
// run-all.mjs исключаем; порядок — по имени (smoke_n103..smoke_n143, smoke_renderer последним по алфавиту не нужен — он уже в общем списке)
const files = readdirSync(dir)
  .filter((f) => /^smoke_.*\.mjs$/.test(f))
  .sort();

let failed = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  console.log(`${r.status === 0 ? 'PASS' : 'FAIL'}  ${f}`);
  if (r.status !== 0) failed.push(f);
}

console.log(failed.length === 0 ? 'SMOKE: ALL OK' : `SMOKE FAILED: ${failed.join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
