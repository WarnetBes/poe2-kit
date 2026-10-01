/**
 * make-portable.mjs — собрать portable-архив релиза для не-программистов.
 *
 * Что делает:
 *  1. Пересобирает dist всех пакетов (в репо, где есть dev-зависимости).
 *  2. Копирует рабочее дерево (без .git/logs/deploy/musора) в _portable/<stage>.
 *  3. npm ci --omit=dev в копии — остаётся только рантайм.
 *  4. Ставит маркер .portable — bat-файлы пропускают npm ci и компиляцию.
 *  5. (lite) Вырезает node_modules/electron/dist — бинарники Electron (~270 MB)
 *     в лимит релизных вложений SourceCraft (100 MB) не влезают: их при первом
 *     запуске скачивает сам start-overlay.bat (~110 MB, один раз).
 *  6. Паковка в zip (bsdtar) → _portable/poe2-kit-portable-<ver>-win64.zip.
 *
 * Режимы: lite (по умолчанию — для релиза), `node make-portable.mjs --full`
 * (включает electron dist — архив ~190 MB, свыше лимита релиза: для своих ПК).
 *
 * Пользователю после этого: распаковать zip → start-overlay.bat.
 * Запуск: node make-portable.mjs [--full]   (из корня репо, Node 20+)
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FULL = process.argv.includes('--full');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const OUT_DIR = path.join(ROOT, '_portable');
const STAGE_NAME = `poe2-kit-portable-${ver}-win64${FULL ? '-full' : ''}`;
const STAGE = path.join(OUT_DIR, STAGE_NAME);
const ZIP = path.join(OUT_DIR, `${STAGE_NAME}.zip`);

// Каталоги, которые в публичный архив не идут (deploy/ — 60 MB офлайн-инсталляторов
// для своих игровых ПК; electron dist — см. lite-режим выше; scripts/ и _archive/ —
// дев-утилиты и история, не для пользователя).
const EXCLUDE_DIRS = ['.git', '_portable', 'logs', '_research', '.vite', '.cache', 'node_modules', '_archive', 'scripts'];
if (!FULL) EXCLUDE_DIRS.push('deploy');
// robocopy /XD матчит имена каталогов на любом уровне — node_modules/.cache и т.п.
const skip = (d) => EXCLUDE_DIRS.includes(d);

function sh(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

console.log(`[portable] PoE2 Kit v${ver}: сборка portable-архива`);

// 1. Свежие dist (нужны dev-зависимости → собираем в основном репо).
console.log('[portable] 1/5 build dist (core, overlay, web, mcp)...');
sh('npm run build -w @poe2-kit/core');
sh('npm run build -w @poe2-kit/overlay');
sh('npm run build -w @poe2-kit/web');
sh('npm run build -w @poe2-kit/mcp');

// 2. Стейджинг.
console.log('[portable] 2/5 staging...');
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip(ent.name)) continue;
    if (ent.isFile()) {
      if (/\.(log|zip)$/i.test(ent.name)) continue;
      if (ent.name === 'WORK_LOG.md' || ent.name === 'README-netfix.md') continue; // внутренние
      // чек-листы публикации владельца + разовый мусор истории — не для публичного архива
      if (/^(POST_REDDIT|attach_resp|e2e_code|portable_out|HANDOFF|_extract_|_smoke)/i.test(ent.name)) continue;
      fs.copyFileSync(path.join(src, ent.name), path.join(dst, ent.name));
    } else if (ent.isDirectory()) {
      copyDir(path.join(src, ent.name), path.join(dst, ent.name));
    }
  }
}
copyDir(ROOT, STAGE);

// 3. Рантайм-зависимости (npm ci в монорепо честно линкует воркспейсы;
//    prune по копии падает 404 на локальном @poe2-kit/core — не используем).
//    --omit=dev: typescript/vite/esbuild в архив не идут, electron/koffi остаются.
console.log('[portable] 3/5 npm ci --omit=dev (stage)...');
execSync('npm ci --omit=dev --no-audit --no-fund', {
  stdio: 'inherit',
  cwd: STAGE,
});

// 4. Маркер portable: bat-ы пропускают npm ci и компиляцию.
fs.writeFileSync(path.join(STAGE, '.portable'), `poe2-kit portable ${ver}\n`, 'utf8');

// 4.5 Electron: full — чиним распаковку (extract-zip на новом Node распаковывает
//     1 файл и молча выходит 0 — тот же фикс, что в start-overlay.bat);
//     lite — наоборот, вырезаем dist: его скачает start-overlay.bat при первом
//     запуске (лимит вложений релиза 100 MB чисто физически меньше Electron).
const elDist = path.join(STAGE, 'node_modules', 'electron', 'dist');
const elExe = path.join(elDist, 'electron.exe');
if (!FULL && fs.existsSync(elDist)) {
  fs.rmSync(elDist, { recursive: true, force: true });
  console.log('[portable] 4.5 lite: electron dist убран из архива (скачает start-overlay.bat).');
} else if (!fs.existsSync(elExe)) {
  console.log('[portable] 4.5 electron.exe missing after npm ci — repairing from cache...');
  fs.mkdirSync(elDist, { recursive: true });
  const cacheDir = path.join(process.env.LOCALAPPDATA ?? '', 'electron', 'Cache');
  let zip = null;
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/^electron-v.*\.zip$/i.test(ent.name)) { if (!zip) zip = p; }
    }
  };
  if (fs.existsSync(cacheDir)) walk(cacheDir);
  if (!zip) {
    console.error('[portable] FATAL: no cached electron zip in %LOCALAPPDATA%\\electron\\Cache.');
    console.error('[portable]        Run `npm rebuild electron` in the repo once, then retry.');
    process.exit(1);
  }
  execSync(`tar -xf "${zip}" -C "${elDist}"`, { stdio: 'inherit' });
  fs.writeFileSync(path.join(path.dirname(elDist), 'path.txt'), 'electron.exe', 'utf8');
  if (!fs.existsSync(elExe)) {
    console.error('[portable] FATAL: electron.exe still missing after repair.');
    process.exit(1);
  }
  console.log('[portable] electron.exe восстановлен из кэша.');
}
if (FULL) fs.writeFileSync(path.join(path.dirname(elDist), 'path.txt'), 'electron.exe', 'utf8');

// 4.7 README-FIRST.txt — инструкция для не-программиста с первого взгляда.
fs.writeFileSync(
  path.join(STAGE, 'README-FIRST.txt'),
  `PoE2 Kit v${ver} — помощник для Path of Exile 2 (оверлей поверх игры)
====================================================================

КАК ЗАПУСТИТЬ (Windows):
  1. Дважды щёлкните start-overlay.bat
  2. ПРИ ПЕРВОМ ЗАПУСКЕ скрипт один раз скачает движок Electron
     (~110 МБ; дальше работает офлайн, этого требует только первый старт).
  3. Запустите Path of Exile 2.

КАК ПОЛЬЗОВАТЬСЯ В ИГРЕ:
  - Наведите курсор на предмет и нажмите Ctrl+C (игра скопирует предмет),
    затем Ctrl+F1 — цена предмета.
  - Ctrl+F2 — список покупок билда; Ctrl+F3 — импорт билда (PoB-код);
  - Ctrl+F4 — подсказки по прокачке;  Ctrl+F5 — передвинуть оверлей;
  - Ctrl+F6 — настройки (прозрачность, размер, горячие клавиши,
    opt-in «журнал обучения» и кнопка «поделиться предметами»).

ОТЗЫВЫ/БАГИ/ИДЕИ:
  https://sourcecraft.dev/volkovpartilaholin/poe2-kit/issues
  Лицензия MIT. Дополнительно: README.md (по-русски) / README.en.md (English).

HOW TO LAUNCH (English): double-click start-overlay.bat.
On first run it downloads the Electron runtime (~110 MB, one time only).
In game: hover an item, Ctrl+C, then Ctrl+F1 = price check. Ctrl+F6 = settings.
`,
  'utf8',
);

// 5. Zip через встроенный bsdtar (Windows 10+: tar -a=c по расширению .zip).
console.log('[portable] 5/5 zip...');
fs.rmSync(ZIP, { force: true });
execSync(`tar -a -c -f "${ZIP}" "${STAGE_NAME}"`, { stdio: 'inherit', cwd: OUT_DIR });

const sizeMb = (fs.statSync(ZIP).size / 1024 / 1024).toFixed(1);
console.log(`[portable] ГОТОВО: ${ZIP} (${sizeMb} MB)`);
console.log(`[portable] Раскатка: распаковать → start-overlay.bat (${FULL ? 'офлайн, Electron внутри' : 'первый старт скачает Electron ~110 MB'}).`);
