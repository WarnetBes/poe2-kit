// tests/smoke/smoke_bats.mjs — смок-обёртка guard'а №588 (batlint).
// Гейт локальный (CI-checkout сам конвертит CRLF — там EOL-чек ложен),
// но ASCII/BOM/cd /d-проверки валидны везде.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const r = spawnSync(process.execPath, [join(import.meta.dirname, '..', '..', 'scripts', 'check-bats.mjs')], { stdio: 'inherit' });
console.log(r.status === 0 ? 'PASS  smoke_bats (batlint)' : 'FAIL  smoke_bats (batlint)');
process.exit(r.status);
