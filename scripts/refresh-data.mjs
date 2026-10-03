/**
 * Единый конвейер обновления офлайн-данных poe2-kit (№196-bis, стабильность).
 *
 * Один запуск — все поддающиеся обновлению датасеты, с честным итогом:
 *   - packages/core/data/game/trade/trade_stats.json — дамп каталога
 *     статов trade2 (scripts/fetch-trade-stats.mjs; после патча GGG —
 *     stat-id смещаются, дамп — первый контур матчинга статов);
 *
 * Запуск: npm run refresh-data  (или node scripts/refresh-data.mjs)
 *
 * Границы: датасеты, обновляемые вручными экстракторами из клиентских файлов
 * игры (passive_tree/layout.json, base_items, build_planner-карты), СЮДА НЕ
 * входят — их обновление требует установленного PoB2/клиента и отдельного
 * регламента (scripts/extract-*.mjs, _extract_*.mjs).
 *
 * Планируется к запуску рядом с живыми смоками 06:00 (run_live_smoke_daily.bat)
 * или руками перед релизом — не молчим в протухании данных.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Свежесть дампа trade-каталога: старше 45 дней — предупреждение
 *  (паритет с STALE_AFTER_MS в packages/core/src/statMatching.ts). */
const STALE_AFTER_DAYS = 45;

const steps = [
  {
    name: 'trade_stats.json (каталог статов trade2)',
    script: ['scripts/fetch-trade-stats.mjs'],
  },
];

let failed = 0;
for (const step of steps) {
  console.log(`\n=== refresh-data: ${step.name} ===`);
  const r = spawnSync(process.execPath, step.script, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`✖ ${step.name}: код ${r.status}`);
    failed++;
  }
}

// Отчёт по свежести всех датасетов с _meta.fetchedAt.
const checkPath = (...seg) => path.join(root, ...seg);
const freshnessTargets = [
  ['packages/core/data/game/trade/trade_stats.json'],
];
console.log('\n=== freshness ===');
for (const [rel] of freshnessTargets) {
  const p = checkPath(rel);
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const fetchedAt = raw?._meta?.fetchedAt;
    const entries = raw?._meta?.entries ?? '?';
    const ageDays = fetchedAt
      ? Math.floor((Date.now() - Date.parse(fetchedAt)) / 86_400_000)
      : null;
    const mark = ageDays == null ? '?' : ageDays > STALE_AFTER_DAYS ? `⚠ STALE (${ageDays}д)` : `✓ ${ageDays}д`;
    console.log(`${mark}  ${rel} (entries: ${entries}, fetchedAt: ${fetchedAt ?? '—'})`);
    if (ageDays != null && ageDays > STALE_AFTER_DAYS) failed++;
  } catch {
    console.error(`✖ ${rel}: файл отсутствует/не читается`);
    failed++;
  }
}

console.log(failed ? `\nrefresh-data FAILED (${failed})` : '\nrefresh-data OK');
process.exit(failed ? 1 : 0);
