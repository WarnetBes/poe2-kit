// Настройка headless-рантайма оракула: LuaJIT 2.1 (luapower mingw64, MIT Mike Pall).
// Воспроизводимость: SHA256-гейт. Запуск: node oracle/setup-headless.mjs [--force]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const binDir = join(here, 'bin');
// pinned: luapower/luajit — ветка master, поле bin/mingw64/{luajit.exe,lua51.dll}
const BASE = 'https://github.com/luapower/luajit/raw/master/bin/mingw64';
const FILES = {
  // пинн (замер 11.10.2026, luapower/luajit master): смена хэша = осознанный апдейт
  'luajit.exe': { sha256: '5343326fb0b4f79c32276f08ffcc36bd88cde23aa19962bd1e8d8b80f5d33953' },
  'lua51.dll': { sha256: 'c7a657af5455812fb215a8888b7e3fd8fa1ba27672a3ed9021eb6004eff271ac' },
};
const force = process.argv.includes('--force');

mkdirSync(binDir, { recursive: true });
let ok = true;
for (const [name, meta] of Object.entries(FILES)) {
  const dest = join(binDir, name);
  const need = force || !existsSync(dest);
  if (need) {
    const r = spawnSync('curl.exe', ['--ssl-no-revoke', '-sS', '-L', '-o', dest, `${BASE}/${name}`], { encoding: 'utf8', timeout: 120_000 });
    if (r.status !== 0) { console.error(`[setup-headless] скачать не удалось: ${name} (curl exit ${r.status})`); ok = false; continue; }
  }
  const sha = createHash('sha256').update(readFileSync(dest)).digest('hex');
  if (meta.sha256 && sha !== meta.sha256) {
    console.error(`[setup-headless] SHA256 MISMATCH ${name}: got ${sha}, expected ${meta.sha256}`);
    ok = false;
    continue;
  }
  console.log(`[setup-headless] ${name}: ${(fs_size(dest) / 1024).toFixed(1)} КБ sha256=${sha}${need ? ' (скачан)' : ' (на месте)'}`);
}
writeFileSync(join(binDir, 'README.txt'), 'LuaJIT 2.1 (luapower mingw64 сборка, Copyright Mike Pall, MIT).\nИсточник: https://github.com/luapower/luajit (bin/mingw64).\nСкачивается oracle/setup-headless.mjs; в git не коммитится.\n');
function fs_size(p) { return readFileSync(p).length; }
process.exit(ok ? 0 : 1);
