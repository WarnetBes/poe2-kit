/**
 * Разовое слияние (additive merge) RU-баз Sidekick в items_ru.json (2026-10-24).
 *
 * Донор: Sidekick-Poe/Sidekick (MIT), data/poe2/ru/items.json —
  локальная копия scripts/data-raw/sidekick_ru_items.json (исходник UTF-16LE).
 * Схема донора: { baseItemIds: [Metadata-ID...], name: "<RU>", tradeItems:
 * [{type, cat}] (в RU-локали type = само RU-имя), typePattern }.
 *
 * Правила слияния (НЕ переопределяем существующее):
 *  1. Новые RU-имена (кириллица, не [DNT]-мусор), отсутствующие в нашем
 *     items/unique/gem по normRuEnKey: EN-канон берём из repoe base_items.json
 *     по первому Metadata/Items/* из baseItemIds. Не резолвится → пропускаем.
 *     Добавляем в names.item как [ru, en, repoeItemClass?, extras?].
 *  2. Существующим строкам (item/unique/gem), где донор даёт baseItemIds/
 *     tradeItems по ТОЧНОМУ совпадению RU-имени (normRuEnKey), дописываем
 *     extras: { metadataId, tradeCat } — только если полей ещё нет.
 *
 * Нормализация — ТОЛЬКО наша normRuEnKey (донорский typePattern не используем).
 * Повторный запуск идемпотентен (extras уже на месте, имена уже известны).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ITEMS = path.join(ROOT, 'packages', 'core', 'data', 'game', 'i18n', 'items_ru.json');
const REPOE = path.join(ROOT, 'packages', 'core', 'data', 'game', 'repoe', 'base_items.json');
const DONOR = path.join(ROOT, 'scripts', 'data-raw', 'sidekick_ru_items.json');

/** Идентична core normRuEnKey (ruLocale.ts). */
const norm = (s) => String(s ?? '')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .replace(/ё/g, 'е')
  .replace(/й/g, 'и')
  .replace(/['’`]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const CYR = /[а-яё]/i;

const locale = JSON.parse(fs.readFileSync(ITEMS, 'utf8'));
const repoe = JSON.parse(fs.readFileSync(REPOE, 'utf8'));
const donor = JSON.parse(fs.readFileSync(DONOR, 'utf8'));

// Донор-индекс по normKey: приоритет записям с tradeItems и Metadata/Items-ids.
const donorIdx = new Map();
for (const e of donor) {
  const key = norm(e.name);
  if (!key) continue;
  const ids = (e.baseItemIds ?? []).filter((i) => String(i).startsWith('Metadata/Items/'));
  const cat = e.tradeItems?.[0]?.cat;
  const score = (ids.length ? 2 : 0) + (cat ? 1 : 0);
  const prev = donorIdx.get(key);
  if (!prev || score > prev.score) donorIdx.set(key, { ids, cat, score });
}

// Существующие normKey по всем трём секциям.
const known = new Set();
for (const sec of ['item', 'unique', 'gem']) {
  for (const row of locale.names[sec] ?? []) {
    if (Array.isArray(row) && row.length >= 2 && norm(row[0])) known.add(norm(row[0]));
  }
}

let added = 0, enriched = 0, skippedDnt = 0, skippedNoResolve = 0;

// ── 1. Дополнение существующих строк extras (metadataId/tradeCat) ──────────
for (const sec of ['item', 'unique', 'gem']) {
  for (const row of locale.names[sec] ?? []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const d = donorIdx.get(norm(row[0]));
    if (!d) continue;
    let ex = row[3];
    if (!ex || typeof ex !== 'object' || Array.isArray(ex)) {
      ex = {};
      row[3] = ex;
    }
    let touched = false;
    if (d.ids[0] && !ex.metadataId) { ex.metadataId = d.ids[0]; touched = true; }
    if (d.cat && !ex.tradeCat) { ex.tradeCat = d.cat; touched = true; }
    if (touched) enriched++;
  }
}

// ── 2. Новые RU-базы из донора (additive, без переопределения) ─────────────
const newItemRows = [];
for (const e of donor) {
  const ru = String(e.name ?? '');
  const key = norm(ru);
  if (!key || !CYR.test(ru)) continue; // EN-имена донора не добавляем
  if (/^\[DNT/i.test(ru.trim())) { skippedDnt++; continue; }
  if (known.has(key)) continue;
  const d = donorIdx.get(key);
  if (!d || !d.ids.length) { skippedNoResolve++; continue; }
  const rb = d.ids.map((i) => repoe[i]).find(Boolean);
  if (!rb || !rb.name || !String(rb.name).trim()) { skippedNoResolve++; continue; }
  const en = String(rb.name).trim();
  if (en === ru.trim()) continue; // не переведено в RU-клиенте — бесполезно
  known.add(key);
  const row = [ru, en];
  if (rb.item_class) row.push(rb.item_class);
  const ex = {};
  if (d.ids[0]) ex.metadataId = d.ids[0];
  if (d.cat) ex.tradeCat = d.cat;
  if (Object.keys(ex).length) row.push(ex);
  newItemRows.push(row);
  added++;
}

newItemRows.sort((a, b) => a[0].localeCompare(b[0], 'ru'));
locale.names.item = [...(locale.names.item ?? []), ...newItemRows];

// ── Метаданные файла: исходная форма полей сохранена, добавляем только поля ─
locale.merged = '2026-10-24';
locale.sourceSidekick = {
  source: 'https://github.com/Sidekick-Poe/Sidekick (MIT) — data/poe2/ru/items.json',
  note: 'RU base-item names + baseItemIds (metadataId) / tradeItems.cat (tradeCat); additive merge',
};

fs.writeFileSync(ITEMS, JSON.stringify(locale, null, 1) + '\n');
console.log(`added: ${added}, enriched: ${enriched}, skippedDnt: ${skippedDnt}, skippedNoResolve: ${skippedNoResolve}`);
console.log(`item rows: ${locale.names.item.length}, unique: ${locale.names.unique.length}, gem: ${locale.names.gem.length}`);
