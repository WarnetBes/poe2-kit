/**
 * Срез RePoE-fork (poe2) в репо: mods.json + base_items.json (L3, master-plan §2а).
 *
 *Источник: https://repoe-fork.github.io/poe2/ (бесплатный датамайн PoE2,
 * github-хостинг). Live-файлы огромны (mods.json 12.4 МБ / base_items 7.8 МБ) —
 * в репо фиксируется СРЕЗ только item-domain affix-модов (префиксы/суффиксы,
 * не essence-only — тот же фильтр, что в runtime-индексе core/repoe.ts) и
 * тонкий base_items-каталог (name/item_class/drop_level).
 *
 * Результат:
 *   packages/core/data/game/repoe/mods.json        (~1 МБ, фильтр: ~2.5К аффиксов)
 *   packages/core/data/game/repoe/base_items.json  (~0.6 МБ, 5.5К баз)
 *
 * Свежесть: оба файла получают общий _meta.fetchedAt → core.freshness
 * (stale-порог «старее известного патча», №248). Обновление — через
 * npm run refresh-data (REFRESH_STEPS) или вручную.
 *
 * Сеть: сперва curl.exe --ssl-no-revoke (DPI-сети: сырой node-fetch
 * душится, паттерн serve-dist №202), фолбэк — globalThis fetch.
 *
 * ⚠️ Контент © Grinding Gear Games Ltd (данные RePoE — производный датамайн).
 * Заметка об источнике и дате хранится в _meta — НЕ удалять.
 *
 * Запуск: node scripts/fetch-repoe-mods.mjs
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://repoe-fork.github.io/poe2';
const UA =
  'poe2-kit/1.0 (open-source toolkit; contact: https://git.sourcecraft.dev/volkovpartilaholin/poe2-kit)';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'packages', 'core', 'data', 'game', 'repoe');

/** GET JSON: curl.exe с фолбэком на fetch (паттерн №202). */
async function getJson(url) {
  const curl = spawnSync(
    'curl.exe',
    ['--ssl-no-revoke', '-sS', '-L', '--max-time', '180', '-A', UA, url],
    { encoding: 'utf8', timeout: 200_000, maxBuffer: 64 * 1024 * 1024 },
  );
  if (curl.status === 0 && curl.stdout.trim().startsWith('{')) {
    console.log(`[fetch-repoe] ${url} — 200 (curl)`);
    return JSON.parse(curl.stdout);
  }
  console.log(`[fetch-repoe] curl не справился (${curl.status ?? 'n/a'}), фолбэк fetch...`);
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return await res.json();
}

console.log('[fetch-repoe] снапшот RePoE-fork: mods + base_items...');
const [mods, baseItems] = await Promise.all([
  getJson(`${BASE}/mods.json`),
  getJson(`${BASE}/base_items.json`),
]);

const fetchedAt = new Date().toISOString().slice(0, 10);
const meta = {
  source: BASE,
  fetchedAt,
  note: 'Данные RePoE-fork — датамайн Path of Exile 2. Контент © Grinding Gear Games Ltd.',
  filter: 'domain=item, generation_type=prefix|suffix, не essence_only (тот же фильтр, что в core/repoe.ts)',
};

// ── Срез mods: item-аффиксы ────────────────────────────────────────────────
const keepFields = [
  'name', 'domain', 'generation_type', 'required_level', 'groups',
  'spawn_weights', 'generation_weights', 'stats', 'implicit_tags',
];
const modsSlice = { _meta: meta };
let kept = 0;
for (const [id, m] of Object.entries(mods)) {
  if (m.domain !== 'item') continue;
  if (m.generation_type !== 'prefix' && m.generation_type !== 'suffix') continue;
  if (m.is_essence_only) continue;
  const sink = {};
  for (const f of keepFields) if (m[f] !== undefined) sink[f] = m[f];
  modsSlice[id] = sink;
  kept++;
}

// ── Срез base_items: тонкий каталог ────────────────────────────────────────
const baseSlice = { _meta: { ...meta, filter: 'name/item_class/drop_level (тонкий каталог баз)' } };
let bases = 0;
for (const [id, b] of Object.entries(baseItems)) {
  baseSlice[id] = { name: b.name, item_class: b.item_class, drop_level: b.drop_level };
  bases++;
}

mkdirSync(outDir, { recursive: true });
const modsPath = join(outDir, 'mods.json');
const basePath = join(outDir, 'base_items.json');
writeFileSync(modsPath, JSON.stringify(modsSlice));
writeFileSync(basePath, JSON.stringify(baseSlice));

const mb = (p) => (fs.statSync(p).size / 1048576).toFixed(1);
console.log(`[fetch-repoe] OK: аффиксов ${kept} → mods.json (${mb(modsPath)} МБ), баз ${bases} → base_items.json (${mb(basePath)} МБ), fetchedAt=${fetchedAt}`);
