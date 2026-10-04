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

// Отчёт по свежести ВСЕХ датасетов с собственной датой (аудит №208:
// раньше сводка была слепа ко всему, кроме trade_stats — «support_gems
// Fresh@2025-12-12» вскрылся только ручным осмотром).
const checkPath = (...seg) => path.join(root, ...seg);
/** [путь, путь-до-даты-в-JSON (массив ключей), судьба-при-протухании] */
const freshnessTargets = [
  // fail:-trade-каталог критичен для stat-id матчинга (STALE_AFTER_MS, statMatching.ts:271)
  ['packages/core/data/game/trade/trade_stats.json', ['_meta', 'fetchedAt'], 'fail'],
  ['packages/core/data/game/skill_gems/recommended_supports.json', ['scraped_at'], 'warn'],
  ['packages/core/data/game/skill_gems/gem_colors.json', ['generated_at'], 'warn'],
  ['packages/core/data/game/build_planner/map.json', ['metadata', 'extraction_date'], 'warn'],
  // дубли-ветка дерева: layout регенерится из export (№207), numeric/positions
  ['packages/core/data/game/passive_tree/layout.json', ['metadata', 'generated_at'], 'warn'],
  ['packages/core/data/game/hideout/decor.json', ['_meta', 'generated'], 'warn'],
  ['packages/core/data/game/support_gems/support_gems.json', ['metadata', 'extraction_date'], 'warn'],
];
const extr = (obj, keys) => {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return typeof cur === 'string' ? cur : undefined;
};
const fmtDate = (v) => (v ? v.slice(0, 10) : null);
console.log('\n=== freshness ===');
for (const [rel, keys, policy] of freshnessTargets) {
  const p = checkPath(rel);
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const dateRaw = extr(raw, keys);
    const date = fmtDate(dateRaw);
    const ageDays = date ? Math.floor((Date.now() - Date.parse(date)) / 86_400_000) : null;
    const mark =
      ageDays == null
        ? '?'
        : policy === 'fail'
          ? ageDays > STALE_AFTER_DAYS ? `⚠ STALE (${ageDays}д)` : `✓ ${ageDays}д`
          : ageDays > STALE_AFTER_DAYS ? `⚠ ${ageDays}д (нет авто-обновления)` : `✓ ${ageDays}д`;
    console.log(`${policy === 'info' ? '   ' : mark}  ${rel} (${keys.join('.')}=${date ?? '—'})`);
    if (policy === 'fail' && ageDays != null && ageDays > STALE_AFTER_DAYS) failed++;
  } catch {
    console.error(`✖ ${rel}: файл отсутствует/не читается`);
    failed++;
  }
}
// export GGG-дерева: официальная свежесть регенерации (mtime файла)
{
  const p = checkPath('packages/core/data/game/passive_tree/export/data.json');
  try {
    const mtime = fs.statSync(p).mtime;
    const ageDays = Math.floor((Date.now() - mtime.getTime()) / 86_400_000);
    console.log(`${ageDays > STALE_AFTER_DAYS ? '⚠ ' : '✓ '}${ageDays}д  passive_tree/export/data.json (mtime)`);
  } catch {
    console.error('✖ passive_tree/export/data.json: отсутствует');
  }
}

console.log(failed ? `\nrefresh-data FAILED (${failed})` : '\nrefresh-data OK');
process.exit(failed ? 1 : 0);
