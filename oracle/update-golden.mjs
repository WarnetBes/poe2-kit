// update-golden.mjs — перестроить golden-oracle.json из вывода оракула.
// Использование: node update-golden.mjs <oracle-output.jsonl> <golden-oracle.json>
// Запускать ТОЛЬКО осознанно (док-станция PoB2 обновлена / сценарии изменены):
// golden — это контракт, которым CI ловит расхождения тулов kit с реальным PoB2.

import { readFileSync, writeFileSync } from 'node:fs';

const parseJsonl = (path) =>
  readFileSync(path, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => JSON.parse(l));

const entries = parseJsonl(process.argv[2]);
if (!entries.length) throw new Error(`оракул не выдал JSON (${process.argv[2]})`);
// UTF-8 без BOM — иначе JSON.parse/node на некоторых платформах спотыкается о \uFEFF.
writeFileSync(process.argv[3], JSON.stringify(entries));
console.log(`golden: ${entries.length} сценариев -> ${process.argv[3]}`);
