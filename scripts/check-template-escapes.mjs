/**
 * check-template-escapes.mjs — гейт класса бага №626 (журнал, 27.10.2026).
 *
 * Грабля: rendererHtml.ts — гигантский template literal. В JS-литерале
 * одиночный `\X` (NonEscapeCharacter) молча деградирует: `\s`→`s`, `\d`→`d`,
 * `\w`→`w`, `\b`→`b`, `\n`→`n`, `\.`→`.`. TypeScript это НЕ ругает:
 * regex, вписанный в литерал одиночными бэкслешами, компилируется,
 * но в рантайме становится мусором (`/\s+/g` → `/s+/g`), из-за чего все
 * 38 иконок валют в оверлее ушли в 404 ('chaos'→'chao').
 *
 * Правило: в template-литерале допустимы только УДВОЕННЫЕ бэкслеши (`\\s`).
 *
 * ВАЖНО: аудит нацелен ТОЛЬКО на перечисленные ниже файлы-литералы.
 * В обычном TS-коде `/\s+/` легален — лопатить весь src НЕЛЬЗЯ (false
 * positives). Новый файл с большим template-литералом — добавь сюда.
 *
 * Запуск: npm run check:escapes   (exit 0 = чисто, 1 = найдены деградации)
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILES = [
  'apps/overlay/src/rendererHtml.ts', // №626: template-литерал со всем html/JS рендерера
];
// Класс-эскейпы, деградирующие в литерале (набор из аудита №626 — 0 ложных
// срабатываний на чистом дереве): `\n`→`n`, `\.`→`.` — тоже деградации,
// в regex `/./` меняет смысл (любой символ) — потому в наборе.
const DEGRADE = /(?:^|[^\\])\\[sdwbn.]/g;

let failed = 0;
for (const rel of FILES) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    console.error(`  [FAIL] ${rel}: файл отсутствует в списке аудита`);
    failed += 1;
    continue;
  }
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const hits = [];
  lines.forEach((l, i) => {
    // одиночный бэкслеш + класс-символ, НЕ удвоенный
    const m = [...l.matchAll(DEGRADE)];
    if (m.length) hits.push(`${i + 1} [${m.map(x => x[0]).join(' ')}]: ${l.trim().slice(0, 160)}`);
  });
  if (hits.length) {
    console.error(`  [FAIL] ${rel}: ${hits.length} строк(и) с одиночными \\X-эскейпами — деградируют внутри template-литерала (см. №626):`);
    for (const h of hits) console.error(`         ${h}`);
    failed += hits.length;
  } else {
    console.log(`  [ok]   ${rel}: одиночных \\X-деградаций нет`);
  }
}
process.exit(failed ? 1 : 0);
