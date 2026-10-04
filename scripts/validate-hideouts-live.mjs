// Валидация core.hideout на 12 живых .hideout-файлах (нативные экспорты POE2 + POH-скачивания).
// Проверяем: parse без исключений, round-trip share-кода, лимит 750, coverage классификации.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseHideout,
  summarizeHideout,
  encodeHideoutCode,
  decodeHideoutCode,
  loadDecorIndex,
} from '../packages/core/dist/index.js';

const dir = 'C:/Users/mezhavikiserj/Downloads';
const files = readdirSync(dir).filter((f) => f.endsWith('.hideout')).sort();
const idx = loadDecorIndex();
let fail = 0;

for (const f of files) {
  try {
    const text = readFileSync(join(dir, f), 'utf8');
    const parsed = parseHideout(text);
    const sum = summarizeHideout(parsed, { decorIndex: idx });
    const code = encodeHideoutCode(parsed);
    const back = decodeHideoutCode(code);
    const rtOk = back.hideoutName === parsed.hideoutName && JSON.stringify(back.doodads) === JSON.stringify(parsed.doodads);
    const cats = `${sum.byCategory.free}F/${sum.byCategory['store-mtx'] + sum.byCategory['exclusive-mtx']}M/${sum.byCategory.unknown}U`;
    console.log(
      `${rtOk && sum.totalPlacements === parsed.doodads.length ? 'OK  ' : 'FAIL'} ${f}`);
    console.log(`     base="${parsed.hideoutName}" hash=${parsed.hideoutHash} music="${parsed.musicName ?? '-'}" doodads=${sum.totalPlacements}/${sum.limit}${sum.overLimit ? ' OVER!' : ''} unique=${sum.uniqueDecor} [${cats}] warn=${parsed.warnings.length}`);
    if (!rtOk) fail++;
  } catch (e) {
    console.log(`FAIL ${f}: ${e.message}`);
    fail++;
  }
}
console.log(fail === 0 ? 'LIVE VALIDATION: ALL OK' : `LIVE VALIDATION FAILED: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
