// tests/smoke/smoke_w43_store.mjs — W4-3: устойчивость JSON-хранилища оверлея.
// Проверяет скомпилированный apps/overlay/dist/jsonStore.js:
//   1) атомарная запись (tmp->rename, мусора .tmp не остаётся);
//   2) .bak-ротация: предыдущая версия доступна;
//   3) битый основной файл -> восстановление из .bak (не блокирует старт);
//   4) отсутствующий файл -> null (нет файла — не ошибка);
//   5) BOM-толерантность чтения (паттерн №105).
//   6) ENOENT НЕ реставрирует .bak (файл честно удалён — читаем null).
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../apps/overlay/dist/jsonStore.js');
const { readJsonSync, writeJsonSync } = await import(pathToFileURL(dist).href);

let failures = 0;
const ok = (cond, name) => {
  console.log(`${cond ? '  [ok]  ' : '  [FAIL]'} ${name}`);
  if (!cond) failures++;
};

const dir = mkdtempSync(path.join(tmpdir(), 'w43store-'));
try {
  const f = path.join(dir, 'state.json');

  // 1-2: две записи → основная версия новая, .bak — предыдущая, .tmp нет.
  writeJsonSync(f, { v: 1 });
  writeJsonSync(f, { v: 2 });
  ok(existsSync(f), 'файл создан');
  ok(readJsonSync(f)?.v === 2, 'последняя версия читается');
  ok(readJsonSync(`${f}.bak`)?.v === 1, '.bak хранит предыдущую версию');
  ok(!existsSync(`${f}.tmp`), '.tmp-мусора нет после записи');

  // 3: битый основной → восстановление из .bak.
  writeFileSync(f, '{"v":3  обрыв посреди фразы', 'utf8');
  ok(readJsonSync(f)?.v === 1, 'битый файл -> .bak восстановлен (старт не блокируется)');

  // 4: отсутствующий -> null.
  const missing = path.join(dir, 'nope.json');
  ok(readJsonSync(missing) === null, 'нет файла -> null (не ошибка)');

  // 5: BOM.
  writeFileSync(missing, '\ufeff{"v":7}', 'utf8');
  ok(readJsonSync(missing)?.v === 7, 'BOM срезается, JSON.parse не падает');

  // 6: честное rmSync (сброс) → файл deleted, .bak не должен оживлять его,
  //    пока не перезаписан. (Обновление поверх существующего — см. 2-3.)
  writeJsonSync(missing, { v: 7 }); // создаёт .bak = BOM-версию... ротация тоже файл
  rmSync(missing, { force: true });
  ok(readJsonSync(missing) === null, 'удалённый файл читается как null, ENOENT без ретраев');

  // 7: pretty-форматирование (boss-times/leveling пишут с отступами).
  writeJsonSync(f, { v: 4 }, true);
  ok(/\n {2}"v": 4/.test(readFileSync(f, 'utf8')), 'pretty=true даёт отступы (читаемо руками)');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? 'PASS  smoke_w43_store.mjs' : `FAIL  smoke_w43_store.mjs (${failures})`);
process.exit(failures === 0 ? 0 : 1);
