// compare-golden.mjs — сверка свежего снимка оракула с golden-файлом.
// Использование: node compare-golden.mjs <oracle-output.jsonl> <golden-oracle.json>
// Сравнение: точное по числам (округление до 4 знаков делается в oracle.lua).
// Любое расхождение => вывод diff и exit(1); CI ломается.

import { readFileSync } from 'node:fs';

const parseJsonl = (path) =>
  readFileSync(path, 'utf8')
    .replace(/^\uFEFF/, '') // BOM от PowerShell-раннера
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => JSON.parse(l));

const actual = parseJsonl(process.argv[2]);
const golden = JSON.parse(readFileSync(process.argv[3], 'utf8').replace(/^\uFEFF/, ''));
const goldenArr = Array.isArray(golden) ? golden : [golden];

let fails = 0;
if (actual.length !== goldenArr.length) {
  console.log(`FAIL: число сценариев ${actual.length} != ${goldenArr.length}`);
  fails++;
}
for (let i = 0; i < Math.min(actual.length, goldenArr.length); i++) {
  const a = actual[i], g = goldenArr[i];
  if (a.name !== g.name) {
    console.log(`FAIL: сценарий #${i}: имя "${a.name}" != "${g.name}"`);
    fails++;
    continue;
  }
  const keys = new Set([...Object.keys(a.stats), ...Object.keys(g.stats)]);
  for (const k of keys) {
    const av = a.stats[k], gv = g.stats[k];
    const same = typeof av === 'number' && typeof gv === 'number'
      ? Math.abs(av - gv) < 1e-4
      : av === gv;
    if (!same) {
      console.log(`FAIL: ${a.name}.${k}: golden=${gv} actual=${av}`);
      fails++;
    }
  }
}
console.log(fails === 0 ? `PASS: ${actual.length} сценариев совпали с golden` : `\n${fails} расхождений`);
process.exit(fails === 0 ? 0 : 1);
