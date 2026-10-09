/**
 * Единый конвейер обновления офлайн-данных poe2-kit (№196-bis → №208 → №248).
 *
 * Один запуск — все поддающиеся обновлению датасеты, с честным итогом.
 *
 * №248 (Этап 4 «safe auto-refresh»): реестр датасетов БОЛЬШЕ НЕ дублируется
 * здесь — единственный источник истины core.freshness.FRESHNESS_DATASETS
 * (packages/core/src/freshness.ts). Этот скрипт только оркестрирует запуск
 * обновляторов (какие датасеты имеют скрипт обновления — рефреш-карта ниже).
 *
 * Философия: НИКАКОГО молчаливого автообновления контента.
 *  - каждый refresh шаг сдвигает _meta-дату и сопровождается diff-отчётом
 *    до/после (число записей + факт изменения контента, не полный дифф);
 *  - изменение ФАКТОВ всегда проходит через явное принятие человеком;
 *  - никаких автокоммитов.
 *
 * Режимы:
 *   node scripts/refresh-data.mjs                полный refresh (как раньше);
 *   node scripts/refresh-data.mjs --stale-only   только датасеты со stale=true
 *                                                по вердикту core.freshness
 *                                                (пороги 30/90 дн + «старше
 *                                                известного патча» из
 *                                                data/game/patches.json);
 *   node scripts/refresh-data.mjs --dry-run      без запуска обновляторов:
 *                                                сводка свежести + какие шаги
 *                                                ВЫПОЛНИЛИСЬ БЫ (stale-only
 *                                                тоже считается по вердикту).
 *   Флаги можно комбинировать: --dry-run --stale-only.
 *
 * Запуск: npm run refresh-data  (или node scripts/refresh-data.mjs)
 * ⚠ Требует собранный core (npm run build) — реестр и diff-хелперы читаются
 * из @poe2-kit/core/dist.
 *
 * Границы: датасеты, обновляемые вручными экстракторами из клиентских файлов
 * игры (passive_tree/layout.json, base_items, build_planner-карты), СЮДА НЕ
 * входят — их обновление требует установленного PoB2/клиента и отдельного
 * регламента (scripts/extract-*.mjs, _extract_*.mjs).
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const staleOnly = process.argv.includes('--stale-only');
const dryRun = process.argv.includes('--dry-run');

// Единственный реестр датасетов — core (№248). Скрипт без собранного dist
// не может честно оценить свежесть — прямое сообщение вместо загадочного ERR.
let core;
try {
  // namespace-импорт: сам объект core — именованный экспорт пакета
  ({ core } = await import('@poe2-kit/core'));
} catch (e) {
  console.error('✖ @poe2-kit/core не импортируется (собран ли dist?):', e.message);
  console.error('  Запустите: npm run build');
  process.exit(1);
}

const dataDir = (...seg) => path.join(root, 'packages', 'core', 'data', 'game', ...seg);

/**
 * Рефреш-карта: какие датасеты реестра FRESHNESS_DATASETS умеем обновлять
 * скриптом. Ключ = spec.rel из core.freshness. Датасеты вне карты (PoB2-
 * экстракты, decor и т.п.) освежаются вручную регламентом — в diff-отчёт и
 * сводку свежести попадают, в шаги — нет.
 */
const REFRESH_STEPS = [
  {
    rel: 'trade/trade_stats.json',
    name: 'trade_stats.json (каталог статов trade2)',
    script: ['scripts/fetch-trade-stats.mjs'],
    // fail-политика №208 сохранена: протухший trade-каталог критичен для
    // stat-id матчинга → его протухание/отсутствие несёт exit-код 1.
    required: true,
  },
];
const REFRESHABLE_RELS = new Set(REFRESH_STEPS.map((s) => s.rel));

// ── Сводка свежести ПЕРЕД шагами (единый реестр core, №248) ──────────────
// knownPatchAt внутри core.freshness по умолчанию — дата последнего
// подтверждённого патча из data/game/patches.json.
const before = core.freshness.datasetFreshnessList();

console.log('\n=== freshness (реестр core.freshness) ===');
{
  const last = core.patches.latestKnownPatch();
  console.log(
    last
      ? `Известный патч: ${last.version} (${last.date}) — auto-датасеты старше него = stale`
      : '⚠ нет подтверждённого патча в реестре — правило «старше патча» не применяется',
  );
}
for (const d of before) {
  const state = d.stale
    ? `🔴 STALE (${d.staleReason})`
    : d.note
      ? `⚠ ${d.note}`
      : `✅ ${d.ageDays} дн (${d.thresholdDays}-порог)`;
  const refreshable = REFRESHABLE_RELS.has(d.rel) ? ' ⟳ refreshable' : '';
  console.log(`${d.stale ? '🔴' : d.note ? '⚠ ' : '✓ '} ${d.rel} — ${state}${refreshable}`);
}

// ── Выбор шагов ───────────────────────────────────────────────────────────
let steps = REFRESH_STEPS;
if (staleOnly) {
  const staleRels = new Set(before.filter((d) => d.stale).map((d) => d.rel));
  steps = REFRESH_STEPS.filter((s) => staleRels.has(s.rel));
  const skipped = REFRESH_STEPS.length - steps.length;
  console.log(
    `\n--stale-only: обновляем ${steps.length} из ${REFRESH_STEPS.length} refreshable` +
      (skipped ? ` (пропущено свежих: ${skipped})` : '') +
      (steps.length
        ? ''
        : ' — протухших refreshable датасетов НЕТ, обновление не требуется'),
  );
} else {
  console.log(`\nРежим: полный refresh (${steps.length} refreshable шагов)`);
}

// ── Diff-снапшоты ДО ───────────────────────────────────────────────────────
const snapPath = (rel) => dataDir(...rel.split('/'));
const snapOf = (rel) => {
  try {
    return core.datasetDiff.snapshotDataset(null, fs.readFileSync(snapPath(rel), 'utf8'));
  } catch {
    return null; // файла нет — честный «новый файл» в отчёте
  }
};
const targets = steps.map((s) => ({ rel: s.rel, before: dryRun ? null : snapOf(s.rel) }));

let reportLines = [];
if (dryRun) {
  console.log('\n=== dry-run: шаги НЕ выполняются ===');
  for (const s of steps) {
    const d = before.find((x) => x.rel === s.rel);
    console.log(`⟳ БЫ ОБНОВЛЁН: ${s.name} (текущее состояние: ${d?.stale ? 'STALE' : 'свежий по вердикту'})`);
  }
  if (!steps.length) console.log('(нет датасетов под обновление)');
} else {
  // ── Запуск обновляторов ─────────────────────────────────────────────────
  let failed = 0;
  for (const step of steps) {
    console.log(`\n=== refresh-data: ${step.name} ===`);
    const r = spawnSync(process.execPath, step.script, { cwd: root, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`✖ ${step.name}: код ${r.status}`);
      failed++;
    }
  }

  // ── Diff-отчёт до/после (№248: refresh не молчит) ────────────────────────
  console.log('\n=== diff-отчёт refresh (до → после; факт изменения контента, не полный дифф) ===');
  reportLines = [];
  for (const t of targets) {
    const after = snapOf(t.rel);
    const diff = core.datasetDiff.diffDatasetSnapshots(t.before, after);
    const line = core.datasetDiff.formatDatasetDiff(t.rel, diff);
    console.log(`  ${line}`);
    reportLines.push(line);
  }
  const reportPath = path.join(
    os.tmpdir(),
    `poe2-kit-refresh-report-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
  );
  try {
    fs.writeFileSync(
      reportPath,
      [`# poe2-kit refresh-data diff-отчёт`, `# ${new Date().toISOString()}`, `# stale-only=${staleOnly}`, '', ...reportLines, ''].join('\n'),
      'utf8',
    );
    console.log(`  отчёт записан: ${reportPath}`);
  } catch (e) {
    console.error(`⚠ отчёт не записан (${e.message}) — stdout выше остаётся источником`);
  }

  // fail-политика (№208, semantics сохранена): required-шаг обязан остаться
  // свежим ПОСЛЕ refresh; протухший trade-каталог = exit 1.
  const afterFresh = core.freshness.datasetFreshnessList();
  for (const step of REFRESH_STEPS.filter((s) => s.required)) {
    const d = afterFresh.find((x) => x.rel === step.rel);
    // протух ИЛИ не читается (паритет №208 с «файл отсутствует/не читается» = fail)
    if (d && (d.stale || (d.note ?? '').includes('не читается'))) failed++;
    console.log(
      `\npost-check ${step.rel}: ${d?.stale ? `🔴 STALE (${d.staleReason})` : d?.note ? `⚠ ${d.note}` : '✅ свежий'}`,
    );
  }

  // export GGG-дерева: официальная свежесть регенерации (mtime файла).
  // Специально НЕ в FRESHNESS_DATASETS: у файла нет JSON-меты с датой —
  // единственный честный носитель свежести здесь mtime (скрипт-локальный чек).
  {
    const p = dataDir('passive_tree', 'export', 'data.json');
    try {
      const ageDays = Math.floor((Date.now() - fs.statSync(p).mtime.getTime()) / 86_400_000);
      console.log(`${ageDays > 30 ? '⚠ ' : '✓ '}${ageDays}д  passive_tree/export/data.json (mtime)`);
    } catch {
      console.error('✖ passive_tree/export/data.json: отсутствует');
    }
  }

  console.log(failed ? `\nrefresh-data FAILED (${failed})` : '\nrefresh-data OK');
  process.exit(failed ? 1 : 0);
}

console.log('\nrefresh-data dry-run OK');
process.exit(0);
