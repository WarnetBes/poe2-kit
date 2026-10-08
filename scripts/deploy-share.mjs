/**
 * Универсальный деплой poe2-kit на шару игрового ПК (\\192.168.0.195).
 *
 * Лечит класс сбоев «деплой завис на выключенной шаре» (№196):
 *   1. Preflight — шару трогаем с таймаутом: недоступна → exit 2, ничего не трогаем;
 *   2. Каждая копия файла — под таймаутом: зависание → ошибка, не вечное ожидание;
 *   3. SHA256-сверка после каждой записи: байт-экзакт или честный DEPLOY FAILED;
 *   4. Проверка локальной сборки перед стартом (нет dist → exit 1 с подсказкой).
 *
 * Использование:
 *   node scripts/deploy-share.mjs            # всё: core ×3, overlay, mcp
 *   node scripts/deploy-share.mjs --core     # только core dist+data ×3
 *   node scripts/deploy-share.mjs --overlay  # только overlay dist
 *   node scripts/deploy-share.mjs --mcp      # только mcp dist
  * exit-коды: 0 OK · 1 ошибка деплоя/сборки · 2 шара недоступна.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

// IP друга плавает по DHCP (было 192.168.0.195, стало 192.168.0.200) — можно задать env POE2K_SHARE.
const SHARE = process.env.POE2K_SHARE ?? '//192.168.0.200/OpenCodeProjectsF/poe2-kit';
const ROOT = path.resolve(import.meta.dirname, '..');

const mode = process.argv[2] ?? '--all';
const doAll = mode === '--all';
const wantCore = doAll || mode === '--core';
const wantOverlay = doAll || mode === '--overlay';
const wantMcp = doAll || mode === '--mcp';
if (!['--all', '--core', '--overlay', '--mcp'].includes(mode)) {
  console.error(`Неизвестный режим: ${mode}. Допустимо: --all | --core | --overlay | --mcp`);
  process.exit(1);
}

const PREFLIGHT_TIMEOUT_MS = 5_000;
const COPY_TIMEOUT_MS = 60_000;

/** Доступность каталога с таймаутом (robocopyasthanovka-style guard). */
async function probeDir(dir, label, timeoutMs) {
  try {
    await Promise.race([
      fs.promises.readdir(dir),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`timeout ${timeoutMs}ms`)), timeoutMs).unref?.(),
      ),
    ]);
    return true;
  } catch (e) {
    console.error(`✖ ${label} недоступен: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

const sha = (p) =>
  crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase();

async function copyVerified(src, dst) {
  try {
    await Promise.race([
      fs.promises.copyFile(src, dst),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`copy timeout ${COPY_TIMEOUT_MS}ms`)), COPY_TIMEOUT_MS).unref?.(),
      ),
    ]);
  } catch (e) {
    throw new Error(`copy ${path.basename(dst)}: ${e instanceof Error ? e.message : e}`);
  }
  if (sha(src) !== sha(dst)) throw new Error(`SHA mismatch: ${path.basename(dst)}`);
}

/** Рекурсивный список файлов каталога. */
function listFiles(dir, base = dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p));
  }
  return out;
}

/** Копирует все файлы srcDir → dstDir (включая подкаталоги), слово сбоя — в лог. */
async function deployTree(srcDir, dstDir) {
  let n = 0;
  fs.mkdirSync(dstDir, { recursive: true });
  for (const rel of listFiles(srcDir)) {
    const src = path.join(srcDir, rel);
    const dst = path.join(dstDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    await copyVerified(src, dst);
    n++;
  }
  return n;
}

// ── 0. Preflight: шара включена? ─────────────────────────────────────────────
console.log(`[deploy-share] preflight: ${SHARE} (таймаут ${PREFLIGHT_TIMEOUT_MS / 1000}с)`);
if (!(await probeDir(SHARE, 'Шара', PREFLIGHT_TIMEOUT_MS))) {
  console.error('DEPLOY SKIPPED: шару не трогали. Включите игровой ПК и повторите.');
  process.exit(2);
}

// ── 1. Локальные сборки на месте? ───────────────────────────────────────────
const distExists = (p) => fs.existsSync(p);
const coreDist = path.join(ROOT, 'packages/core/dist');
const coreData = path.join(ROOT, 'packages/core/data');
const overlayDist = path.join(ROOT, 'apps/overlay/dist');
const mcpDist = path.join(ROOT, 'apps/mcp/dist');
if (wantCore && !distExists(coreDist)) {
  console.error('✖ packages/core/dist не собран: запустите `npm run build -w @poe2-kit/core`');
  process.exit(1);
}
if (wantOverlay && !distExists(overlayDist)) {
  console.error('✖ apps/overlay/dist не собран: запустите `npm run build -w @poe2-kit/overlay`');
  process.exit(1);
}
if (wantMcp && !distExists(mcpDist)) {
  console.error('✖ apps/mcp/dist не собран: соберите mcp-пакет');
  process.exit(1);
}

// ── 2. Деплой ───────────────────────────────────────────────────────────────
let fail = 0;
const report = (label, n, err) => {
  if (err) {
    console.error(`✖ ${label}: ${err.message}`);
    fail++;
  } else {
    console.log(`OK  ${label}: ${n} файлов, SHA256 байт-в-байт`);
  }
};

if (wantCore) {
  // Грабли №97/№106: core живёт в ТРЁХ копиях на шаре (nested node_modules).
  const coreDests = [
    `${SHARE}/packages/core`,
    `${SHARE}/node_modules/@poe2-kit/core`,
    `${SHARE}/apps/overlay/node_modules/@poe2-kit/core`,
  ];
  for (const dstRoot of coreDests) {
    try {
      const n = await deployTree(coreDist, path.join(dstRoot, 'dist'));
      report(`core dist → ${path.basename(path.dirname(dstRoot))}@${dstRoot.split('/').slice(-3, -1).join('/')}`, n);
    } catch (e) { report('core dist → ' + dstRoot, 0, e); }
    try {
      const n = await deployTree(coreData, path.join(dstRoot, 'data'));
      report(`core data → ${dstRoot.split('/').slice(-3, -1).join('/')}`, n);
    } catch (e) { report('core data → ' + dstRoot, 0, e); }
  }
}

if (wantOverlay) {
  try {
    const n = await deployTree(overlayDist, `${SHARE}/apps/overlay/dist`);
    report('overlay dist', n);
  } catch (e) { report('overlay dist', 0, e); }
}

if (wantMcp) {
  try {
    const n = await deployTree(mcpDist, `${SHARE}/apps/mcp/dist`);
    report('mcp dist', n);
  } catch (e) { report('mcp dist', 0, e); }
}

/**
 * Манифесты версий (№216k): Electron читает версию из package.json на старте.
 * Раньше деплой возил только dist/data → Ctrl+F6 у друга врал «1.0.19» при свежем коде.
 * Синхронизируем все 5 package.json при каждом запуске (дёшево, 5 маленьких файлов).
 */
const manifests = [
  'package.json',
  'apps/overlay/package.json',
  'packages/core/package.json',
  'apps/mcp/package.json',
  'apps/web/package.json',
];
let manifestFail = 0;
for (const rel of manifests) {
  try {
    await copyVerified(path.join(ROOT, rel), path.join(SHARE, rel));
    console.log(`OK  package.json: ${rel} (${JSON.parse(fs.readFileSync(path.join(ROOT, rel))).version})`);
  } catch (e) {
    console.error(`✖ package.json ${rel}: ${e instanceof Error ? e.message : e}`);
    manifestFail++;
  }
}
fail += manifestFail;

console.log(fail ? `DEPLOY FAILED (${fail} ошибок)` : 'DEPLOY OK');
process.exit(fail ? 1 : 0);
