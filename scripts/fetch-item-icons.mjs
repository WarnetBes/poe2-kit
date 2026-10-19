#!/usr/bin/env node
/**
 * fetch-item-icons.mjs — харвест иконок УНИКОВ PoE2 из poe2db (CC BY-NC-SA,
 * тот же игровой арт GGG; не poeshop-ассеты).
 *
 * Список имён — uniques_catalog.json (433, все категории). Слаг страницы:
 *   "Alpha's Howl" → https://poe2db.tw/us/Alpha's_Howl (пробел → _, остальное как есть)
 * Иконка — ПЕРВЫЙ /image/Art/2DItems/.../(png|webp) на странице (арт предмета).
 *
 * Выход: packages/core/data/game/uniques/icons/<norm>.webp  (norm = lowercase,
 * пробелы схлопнуты, не-abc выброшены — ключ как в datalist-именах Suche) +
 * item_index.json {map: norm -> true}. Фолбэк UI — пустой слот/жетон.
 * Resume: существующие в индексе не перекачивает. Пауза между запросами.
 * Запуск: node scripts/fetch-item-icons.mjs [--limit=N]
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UQ = path.join(ROOT, 'packages/core/data/game/uniques');
const ICONS_DIR = path.join(UQ, 'icons');
const INDEX = path.join(UQ, 'item_index.json');
const UA = 'poe2-kit-icon-harvest/1.0 (offline kit; contact: kit owner)';
const PAUSE_MS = 350;
const ART_RE = /https:\/\/cdn\.poe2db\.tw\/image\/Art\/2DItems\/[^"']+?\.(?:webp|png)/;

const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const fileKey = (s) => norm(s).replace(/[^a-z0-9 ]/gu, '');
const slugOf = (en) => en.trim().split(/\s+/).join('_');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = async (p) => access(p, FS.F_OK).then(() => true).catch(() => false);

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

const cat = JSON.parse(await readFile(path.join(UQ, 'uniques_catalog.json'), 'utf8'));
const names = [...new Set(Object.values(cat.byCategory ?? {}).flat())].filter(Boolean);

let prevIndex = { map: {} };
if (await exists(INDEX)) prevIndex = JSON.parse(await readFile(INDEX, 'utf8'));
const done = new Set(Object.keys(prevIndex.map ?? {}));

await mkdir(ICONS_DIR, { recursive: true });
const queue = names.filter((n) => !done.has(fileKey(n)));
const todo = limitArg ? queue.slice(0, LIMIT) : queue;
console.log(`уники: ${done.size} есть, качаем ${todo.length} из ${names.length} (лимит ${LIMIT})`);

let ok = 0, fail = 0;
const failures = [];

for (let i = 0; i < todo.length; i++) {
  const name = todo[i];
  try {
    const page = await fetch(`https://poe2db.tw/us/${encodeURIComponent(slugOf(name)).replace(/%2F/g, '/')}`, { headers: { 'User-Agent': UA } });
    if (!page.ok) throw new Error(`страница HTTP ${page.status}`);
    const html = await page.text();
    const m = html.match(ART_RE);
    if (!m) throw new Error('арт предмета не найден');
    const ext = m[0].endsWith('.png') ? '.png' : '.webp';
    const file = path.join(ICONS_DIR, fileKey(name) + ext);
    const buf = Buffer.from(await (await fetch(m[0], { headers: { 'User-Agent': UA } })).arrayBuffer());
    if (buf.length < 400) throw new Error(`подозрительно мал (${buf.length} Б)`);
    await writeFile(file, buf);
    prevIndex.map[fileKey(name)] = true;
    ok++;
  } catch (e) {
    fail++;
    failures.push(`${name}: ${e.message}`);
  }
  if (i % 25 === 0 || i === todo.length - 1) {
    console.log(`  ${i + 1}/${todo.length} ok=${ok} fail=${fail}`);
    await writeFile(INDEX, JSON.stringify({ version: 1, source: 'poe2db.tw (CC BY-NC-SA), игровой арт GGG', map: prevIndex.map }), 'utf8');
  }
  await sleep(PAUSE_MS);
}

await writeFile(INDEX, JSON.stringify({ version: 1, source: 'poe2db.tw (CC BY-NC-SA), игровой арт GGG', map: prevIndex.map }), 'utf8');
console.log(`ГОТОВО: скачано ${ok}, промахов ${fail}. Индекс: ${Object.keys(prevIndex.map).length} записей.`);
if (failures.length) {
  console.log('Промахи (первые 15):');
  for (const f of failures.slice(0, 15)) console.log('  - ' + f);
}
