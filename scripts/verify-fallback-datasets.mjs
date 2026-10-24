#!/usr/bin/env node
/**
 * verify-fallback-datasets.mjs — гейт полноты packaged-fallback данных.
 *
 * Паттерн Sidekick (TradeApiClient.cs:32-75): «живой fetch → локальный файл
 * из релиза». Portable-дистрибутив обязан нести полный набор офлайн-слоёв
 * фолбэка ядра, иначе при патче GGG / лежащей сети функциональность релиза
 * МОЛЧА деградирует (RU-словарь пустой, матчитинг статов offline-слоем пуст,
 * RePoE-резолв баз мёртв). Этот скрипт не даёт такой сборке выйти.
 *
 * Список файлов — ТОЛЬКО факты из кода (источник загрузки у каждого пути):
 *   packages/core/src: dataset.ts:617 (getBaseItems → trade.ts:850
 *   resolveTradeBaseType — RePoE-фолбэк баз), dataset.ts:70 (version),
 *   dataset.ts:1061 (vendor_regex), tradeSnapshot.ts:47 + statMatching.ts:417
 *   (trade_stats), learnedStats.ts:54 (stat_text_map → statMatching.ts:432),
 *   ruLocale.ts:67/198/215 (items_ru / mods_ru / item_classes_ru),
 *   i18nAliases.ts:62 (aliases → statMatching.ts:39), freshness.ts:114/122
 *   (repoe-срезы). Web: apps/web/scripts/copy-datasets.mjs — датасеты панели
 *   генерятся в public/datasets и попадают в portable ЧЕРЕЗ apps/web/dist
 *   (vite копирует public → dist при build; сам public make-portable.mjs:132
 *   вырезает — поэтому проверяем dist).
 *
 * NOTE: packages/core/data/game/ritual вырезается из base-zip отдельным
 * ассетом (make-portable.mjs:131, докачивает start-overlay.bat) — в этот
 * гейт НЕ входит по дизайну (ritual.ts:ritualDatasetStatus честно деградирует).
 *
 * Запуск:
 *   node scripts/verify-fallback-datasets.mjs [путь]
 *     путь — корень репо (по умолчанию cwd), staging portable-сборки или
 *     .zip (распаковывается во временный каталог и проверяется как staging).
 * Exit 0 — все обязательные датасеты на месте, ненулевые и парсятся как JSON.
 * Exit 1 — явный список отсутствующих/битых.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** rel — путь от корня (репо или staging); minBytes — отсечка «скопировалось не то». */
const CORE_DATASETS = [
  // { rel, minBytes, src }  — src: file:line факт загрузки из кода ядра
  { rel: 'packages/core/data/game/base_items.json', minBytes: 500_000, src: 'dataset.ts:617 → trade.ts:850 (RePoE-фолбэк resolveTradeBaseType)' },
  { rel: 'packages/core/data/game/version.json', minBytes: 1_000, src: 'dataset.ts:70 (getDatasetVersion)' },
  { rel: 'packages/core/data/game/trade/trade_stats.json', minBytes: 400_000, src: 'tradeSnapshot.ts:47, statMatching.ts:417 (live→snapshot→learned)' },
  { rel: 'packages/core/data/game/trade/vendor_regex.json', minBytes: 5_000, src: 'dataset.ts:1061 (getVendorRegexPatterns)' },
  { rel: 'packages/core/data/game/learned/stat_text_map.json', minBytes: 50_000, src: 'learnedStats.ts:54 (последний офлайн-слой statMatching.ts:432)' },
  { rel: 'packages/core/data/game/i18n/items_ru.json', minBytes: 100_000, src: 'ruLocale.ts:67 (RU→EN имена, офлайн-фундамент)' },
  { rel: 'packages/core/data/game/i18n/mods_ru.json', minBytes: 100_000, src: 'ruLocale.ts:198 (RU-моды)' },
  { rel: 'packages/core/data/game/i18n/item_classes_ru.json', minBytes: 1_000, src: 'ruLocale.ts:215 (RU itemClass-канон)' },
  { rel: 'packages/core/data/game/i18n/aliases.json', minBytes: 1_000, src: 'i18nAliases.ts:62 (локализационные алиасы statMatching.ts:39)' },
  { rel: 'packages/core/data/game/repoe/base_items.json', minBytes: 100_000, src: 'freshness.ts:122 (срез RePoE-fork, stale-отчёт)' },
  { rel: 'packages/core/data/game/repoe/mods.json', minBytes: 200_000, src: 'freshness.ts:114 (срез аффиксов RePoE-fork)' },
];

/** Web-панель: генерятся apps/web/scripts/copy-datasets.mjs, в portable идут через
 *  apps/web/dist (vite build копирует public → dist; сам public вырезан). */
const WEB_DATASETS = [
  { rel: 'apps/web/dist/datasets/skill_gems_v2.json', minBytes: 1_000_000, src: 'copy-datasets.mjs:16 («Раскладка», installBrowserDataset)' },
  { rel: 'apps/web/dist/datasets/gem_colors.json', minBytes: 10_000, src: 'copy-datasets.mjs:17' },
  { rel: 'apps/web/dist/datasets/meta_supports.json', minBytes: 10_000, src: 'copy-datasets.mjs:20 («Саппорт-советы»)' },
  { rel: 'apps/web/dist/datasets/recommended_supports.json', minBytes: 200_000, src: 'copy-datasets.mjs:21' },
  { rel: 'apps/web/dist/datasets/maps/maps.json', minBytes: 30_000, src: 'copy-datasets.mjs:24 («🗺 Карты», mapPrep)' },
  { rel: 'apps/web/dist/datasets/maps/waystone_mods.json', minBytes: 25_000, src: 'copy-datasets.mjs:25' },
  { rel: 'apps/web/dist/datasets/guides/poeshop_guides.json', minBytes: 30_000, src: 'copy-datasets.mjs:27 (poeguides.ts, ленивый fetch)' },
  { rel: 'apps/web/dist/datasets/guides/guide_trees.json', minBytes: 1_000, src: 'copy-datasets.mjs:29 (№582 деревья пассивок)' },
  { rel: 'apps/web/dist/datasets/uniques_catalog.json', minBytes: 50_000, src: 'copy-datasets.mjs:31 (datalist планнера)' },
  { rel: 'apps/web/dist/datasets/icon_index.json', minBytes: 100, src: 'copy-datasets.mjs:33 (манифест иконок гемов)' },
  { rel: 'apps/web/dist/datasets/item_index.json', minBytes: 10, src: 'copy-datasets.mjs:35 (манифест иконок уников)' },
  { rel: 'apps/web/dist/datasets/currency_index.json', minBytes: 10, src: 'copy-datasets.mjs:37 (манифест иконок валют)' },
  { rel: 'apps/web/dist/datasets/bases_catalog.json', minBytes: 50_000, src: 'copy-datasets.mjs:39 (пикер гира, gen-base-catalog)' },
  { rel: 'apps/web/dist/datasets/ru_en_uniques.json', minBytes: 10_000, src: 'copy-datasets.mjs:141 (браузерный RU→EN-словарь №581)' },
];

// ─── CLI ────────────────────────────────────────────────────────────────────
let target = process.argv[2] ?? '.';
let tmpExtract = null;
if (target.toLowerCase().endsWith('.zip')) {
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) {
    console.error(`[verify-fallback] FATAL: zip не найден: ${abs}`);
    process.exit(1);
  }
  tmpExtract = fs.mkdtempSync(path.join(os.tmpdir(), 'poe2kit-verify-'));
  console.log(`[verify-fallback] распаковываю ${path.basename(abs)} → ${tmpExtract}`);
  execSync(`tar -xf "${abs}" -C "${tmpExtract}"`, { stdio: 'inherit' });
  // Внутри zip корневой каталог poe2-kit-portable-<ver>-win64 — спускаемся на уровень.
  const entries = fs.readdirSync(tmpExtract);
  const onlyDir = entries.length === 1 && fs.statSync(path.join(tmpExtract, entries[0])).isDirectory();
  target = onlyDir ? path.join(tmpExtract, entries[0]) : tmpExtract;
}
const ROOT = path.resolve(target);
if (!fs.existsSync(path.join(ROOT, 'packages', 'core'))) {
  console.error(`[verify-fallback] FATAL: ${ROOT} — не корень репо/staging (нет packages/core).`);
  process.exit(1);
}

console.log(`[verify-fallback] проверяю packaged-fallback датасеты: ${ROOT}`);

// ─── Проверка ───────────────────────────────────────────────────────────────
const ok = [];
const bad = [];
for (const { rel, minBytes, src } of [...CORE_DATASETS, ...WEB_DATASETS]) {
  const p = path.join(ROOT, ...rel.split('/'));
  const fail = (why) => {
    bad.push({ rel, why });
    console.error(`  ✖ ${rel} — ${why}\n     (загружается: ${src})`);
  };
  if (!fs.existsSync(p)) {
    fail('ФАЙЛ ОТСУТСТВУЕТ');
    continue;
  }
  const bytes = fs.statSync(p).size;
  if (bytes < minBytes) {
    fail(`подозрительно мал: ${bytes} Б (порог ${minBytes})`);
    continue;
  }
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (e) {
    fail(`не читается: ${e.message}`);
    continue;
  }
  try {
    JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch (e) {
    fail(`битый JSON: ${e.message}`);
    continue;
  }
  const sha = createHash('sha256').update(raw).digest('hex');
  ok.push(rel);
  console.log(`  ✔ ${rel} — ${bytes} Б, sha256 ${sha.slice(0, 12)}…`);
}

console.log(
  `[verify-fallback]${bad.length ? ' ПРОВАЛ' : ' OK'}: ${ok.length} на месте, ${bad.length} проблем`,
);
if (bad.length) {
  console.error('\n[verify-fallback] Отсутствующие/битые packaged-fallback датасеты:');
  for (const b of bad) console.error(`  - ${b.rel}: ${b.why}`);
  console.error('\nФункциональность portable НЕ завязана на живой API — но только если');
  console.error('эти файлы лежат в дистрибутиве. Чинить: npm run refresh-data / скрипты');
  console.error('scripts/fetch-*.mjs + пересборка apps/web (copy-datasets).');
  process.exit(1);
}
