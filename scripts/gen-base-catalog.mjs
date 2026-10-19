#!/usr/bin/env node
/**
 * gen-base-catalog.mjs — генератор каталога РЕДКИХ БАЗ (base types) PoE2
 * для пикера гира в планнере (трек B, гэп №9).
 *
 * Источник: packages/core/data/game/base_items.json (RePoE-fork, патч 0.5.5,
 * game build 4.5.5.2) — поля id/name/item_class/item_class_name только
 * (requiresLevel и базовые статы в снапшоте ОТСУТСТВУЮТ — см. metadata).
 * RU-имена: packages/core/data/game/i18n/items_ru.json (names.item = [ru, en, itemClass]),
 * матчинг по EN-имени.
 *
 * Выход: apps/web/public/datasets/bases_catalog.json — по образцу
 * uniques_catalog.json (metadata-шапка: dataset/purpose/source/built + byCategory).
 *
 * Фильтры входа:
 *  - только item_class'ы снаряжения (оружие, броня, бижутерия, фляги, квивер, талисман, джула);
 *  - выброшены записи с "[DNT]" в имени и id, содержащие "Unique" (базы под конкретные уники),
 *    а также Microtransaction/HiddenItem/QuestItem и иные не-слоты.
 *
 * Иконки: НЕ добавлены. item_index.json (apps/web/public/datasets) хранит только
 * { map: normKey -> true } по уже скачанным уникам — URL-паттерна poe2db CDN
 * на базу там нет. Хочешь иконки баз — заведи отдельный индекс с URL (fetch запрещён задачей).
 *
 * TODO(планнер): точка врезки — apps/web planner.ts грузит
 * /datasets/bases_catalog.json, пикер редких баз: список по категории
 * (bases.byCategory[slot]), поиск RU↔EN через поле ruName (fallback: name).
 * Интеграцией в planner.ts занимается другой агент.
 *
 * Запуск: node scripts/gen-base-catalog.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'packages/core/data/game/base_items.json');
const RU = path.join(ROOT, 'packages/core/data/game/i18n/items_ru.json');
const OUT = path.join(ROOT, 'packages/core/data/game/base_catalog/bases_catalog.json');
// Канон датасета — в core/data (как uniques_catalog); в public/datasets зеркалит
// apps/web/scripts/copy-datasets.mjs (запускать gen → copy → build).

// item_class (RePoE) -> слот планнера
const SLOT_MAP = {
  // оружие
  'One Hand Sword': 'weapon', 'Two Hand Sword': 'weapon', 'One Hand Axe': 'weapon',
  'Two Hand Axe': 'weapon', 'One Hand Mace': 'weapon', 'Two Hand Mace': 'weapon',
  'Spear': 'weapon', 'Claw': 'weapon', 'Dagger': 'weapon', 'Wand': 'weapon',
  'Staff': 'weapon', 'Warstaff': 'weapon', 'Sceptre': 'weapon', 'Flail': 'weapon',
  'Bow': 'weapon', 'Crossbow': 'weapon',
  // броня/офенс
  'Body Armour': 'body', 'Helmet': 'helmet', 'Gloves': 'gloves', 'Boots': 'boots',
  'Shield': 'shield', 'Buckler': 'shield', 'Focus': 'shield', 'Quiver': 'quiver',
  // бижутерия
  'Belt': 'belt', 'Ring': 'ring', 'Amulet': 'amulet', 'Talisman': 'amulet', 'Jewel': 'jewel',
  // фляги-аналоги PoE2
  'LifeFlask': 'flask', 'ManaFlask': 'flask', 'UtilityFlask': 'flask',
  'SoulCore': 'soul_core',
};

const raw = JSON.parse(await readFile(SRC, 'utf8'));
const ruData = JSON.parse(await readFile(RU, 'utf8'));

// EN -> RU (names.item = [[ru, en, itemClass], ...])
const en2ru = new Map();
let ruConflicts = 0;
for (const [ru, en, cls] of ruData.names.item) {
  if (en2ru.has(en) && en2ru.get(en) !== ru) ruConflicts++;
  en2ru.set(en, ru);
}

const bases = [];
const skipped = { dnt: 0, uniqueId: 0, ruMiss: [] };
const slotCount = {};

for (const rec of Object.values(raw.base_items)) {
  const slot = SLOT_MAP[rec.item_class];
  if (!slot) continue; // не-слоты (валюта, кввесты, гемы, карты и пр.)
  if (rec.name.includes('[DNT]')) { skipped.dnt++; continue; }
  if (/Unique\d*$/i.test(rec.id) || /Unique\d/i.test(rec.id)) { skipped.uniqueId++; continue; } // базы под конкретные уники
  const ruName = en2ru.get(rec.name) ?? null;
  if (!ruName) skipped.ruMiss.push(`${rec.name} (${rec.item_class})`);
  bases.push({
    name: rec.name,
    ruName,
    itemClass: rec.item_class,
    itemClassName: rec.item_class_name,
    slot,
    releaseId: rec.id,
  });
  slotCount[slot] = (slotCount[slot] || 0) + 1;
}

bases.sort((a, b) => a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name));

const byCategory = {};
for (const b of bases) (byCategory[b.slot] ??= []).push(b.name);

const out = {
  metadata: {
    dataset: 'bases/bases_catalog',
    purpose:
      'Каталог редких баз (base types) PoE2 для пикера слотов гира в планнере: EN-имя + RU-имя + item_class + слот. Аналог uniques_catalog.json для не-уников.',
    source: raw.metadata.source,
    source_file: 'packages/core/data/game/base_items.json',
    game_build: raw.metadata.game_build,
    patch: raw.metadata.patch,
    ru_source: ruData.source,
    ru_matching: 'EN-имя → RU из i18n/items_ru.json (names.item), точный матч по имени',
    ru_match_rate: null, // заполняется ниже
    limitations: [
      'requiresLevel и базовые статы ОТСУТСТВУЮТ в base_items.json (снапшот RePoE содержит только name/item_class) — поле не включено.',
      'Записи с "[DNT]" и id*Unique* (базы под конкретные уники) выброшены.',
      'Иконки не подключены: item_index.json не содержит URL-паттерна для баз.',
    ],
    schema: {
      bases: 'Array<{ name, ruName: string|null, itemClass, itemClassName, slot, releaseId }>',
      byCategory: '{ <slot>: string[] (EN-имена) }',
    },
    built: new Date().toISOString(),
    generator: 'scripts/gen-base-catalog.mjs',
  },
  bases,
  byCategory,
};

const ruHit = bases.filter((b) => b.ruName).length;
out.metadata.ru_match_rate = `${ruHit}/${bases.length} (${((ruHit / bases.length) * 100).toFixed(1)}%)`;

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out), 'utf8');
console.log('base_items:', Object.values(raw.base_items).length, '→ bases:', bases.length);
console.log('rag slots:', JSON.stringify(slotCount));
console.log('skipped: [DNT]', skipped.dnt, '| unique-id', skipped.uniqueId);
console.log('RU misses:', bases.length - ruHit, '/', bases.length);
console.log('RU conflicts в i18n (одно EN → несколько RU):', ruConflicts);
if (skipped.ruMiss.length) {
  console.log('Без RU (первые 15):');
  for (const m of skipped.ruMiss.slice(0, 15)) console.log('  -', m);
}
console.log('Записано:', OUT);
