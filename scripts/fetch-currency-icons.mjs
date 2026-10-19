#!/usr/bin/env node
/**
 * fetch-currency-icons.mjs — харвест иконок ВАЛЮТ PoE2 из poe2db (CC BY-NC-SA,
 * тот же игровой арт GGG; не poeshop-ассеты). Прецедент: fetch-item-icons.mjs.
 *
 * Список имён — БЕЗ хардкода: отображаемые имена валют из живых источников
 * (core.trade.fetchBestCurrencyRates + fetchCurrencyHistory, дефолтная лига),
 * т.е. ровно те имена, что видит юзер во вкладке «Курсы валют».
 * Иконка — ПЕРВЫЙ /image/Art/2DItems/... на poe2db-странице имени.
 *
 * Выход: packages/core/data/game/currency/icons/<norm>.webp (or .png)
 *        + currency_index.json {map: norm -> true} (ключ как в item_index).
 * Resume: по индексу. Пауза между запросами.
 * Запуск: node scripts/fetch-currency-icons.mjs [--limit=N]
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CUR_DIR = path.join(ROOT, 'packages/core/data/game/currency');
const ICONS_DIR = path.join(CUR_DIR, 'icons');
const INDEX = path.join(CUR_DIR, 'currency_index.json');
const UA = 'poe2-kit-icon-harvest/1.0 (offline kit; contact: kit owner)';
const PAUSE_MS = 350;
const ART_RE = /https:\/\/cdn\.poe2db\.tw\/image\/Art\/2DItems\/[^"']+?\.(?:webp|png)/;

const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
// ключ = как в uniques/item_index (не-abc выбрасываем)
const fileKey = (s) => norm(s).replace(/[^a-z0-9 ]/gu, '');
const slugOf = (en) => en.trim().split(/\s+/).join('_');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = async (p) => access(p, FS.F_OK).then(() => true).catch(() => false);

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

// ── список имён: живые отображаемые имена (дефолтная лига) ──────────────────
const coremod = await import('file:///' + path.join(ROOT, 'packages/core/dist/index.js').replace(/\\/g, '/'));
const core = coremod.core ?? coremod;
const rates = await core.trade.fetchBestCurrencyRates().catch(() => []);
const hist = await core.trade.fetchCurrencyHistory().catch(() => []);
const names = [...new Set([...rates.map((r) => r.name), ...hist.map((h) => h.name)])]
  .filter((n) => n && fileKey(n));
console.log(`валюты из живых источников: ${names.length}`);

let prevIndex = { map: {} };
if (await exists(INDEX)) prevIndex = JSON.parse(await readFile(INDEX, 'utf8'));
const done = new Set(Object.keys(prevIndex.map ?? {}));

await mkdir(ICONS_DIR, { recursive: true });
const queue = names.filter((n) => !done.has(fileKey(n)));
const todo = limitArg ? queue.slice(0, LIMIT) : queue;
console.log(`иконки: ${done.size} есть, качаем ${todo.length} (лимит ${LIMIT})`);

let ok = 0, fail = 0;
const failures = [];

for (let i = 0; i < todo.length; i++) {
  const name = todo[i];
  try {
    const page = await fetch(`https://poe2db.tw/us/${encodeURIComponent(slugOf(name)).replace(/%2F/g, '/')}`, { headers: { 'User-Agent': UA } });
    if (!page.ok) throw new Error(`страница HTTP ${page.status}`);
    const html = await page.text();
    const m = html.match(ART_RE);
    if (!m) throw new Error('арт не найден');
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
  if (i < todo.length - 1) await sleep(PAUSE_MS);
}

await writeFile(INDEX, JSON.stringify(prevIndex));
console.log(`OK: ${ok}, FAIL: ${fail}`);
if (failures.length) console.log(failures.join('\n'));
