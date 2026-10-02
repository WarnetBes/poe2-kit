/**
 * Оффлайн-дамп каталога статов официального trade2 API (S7, №183).
 *
 * GET https://www.pathofexile.com/api/trade2/data/stats  (без авторизации)
 *   → packages/core/data/game/trade/trade_stats.json
 *
 * Зачем: stat-id матчинг ломается каждым патчем GGG. Свежий дамп, зафиксированный
 * в репо, — первый контур лечения (packages/core/src/statMatching.ts):
 *   оффлайн-дамп → живой fallback → learn-библиотека.
 *
 * Запуск:  node scripts/fetch-trade-stats.mjs
 * Обновлять после каждого крупного патча GGG (или при смещениях stat-id).
 *
 * Формат: один JSON (а не ndjson), внутри — нетронутый ответ API + заголовок _meta
 * (источник, дата, копирайт). Обоснование: наш потребитель (statMatching) грузит
 * каталог ЦЕЛИКОМ один раз и строит Map по нормализованному тексту — stripeaming/
 * частичное чтение не нужно, а один JSON.parse ~1 МБ быстрее и проще построчного
 * ndjson; сохранение исходной структуры 'result' позволяет использовать файл и
 * другим загрузчикам (tradeSnapshot-стиль) без перекодирования.
 *
 * ⚠️ Контент © Grinding Gear Games Ltd. Служит оффлайн-фолбэком публичного
 * торгового API; заметка об источнике и дате хранится в _meta — НЕ удалять.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = 'https://www.pathofexile.com/api/trade2/data/stats';
// GGG-политика API: описательный User-Agent с контактом.
const UA =
  'poe2-kit/1.0 (open-source toolkit; contact: https://git.sourcecraft.dev/volkovpartilaholin/poe2-kit)';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'packages', 'core', 'data', 'game', 'trade');
const outPath = join(outDir, 'trade_stats.json');

console.log(`[fetch-trade-stats] GET ${SRC}`);
const res = await fetch(SRC, {
  headers: { 'User-Agent': UA, Accept: 'application/json' },
});
if (!res.ok) {
  // Cloudflare/GGG отдают HTML при 403 — печатаем первые байты для диагностики.
  const head = (await res.text()).slice(0, 300);
  console.error(`HTTP ${res.status} ${res.statusText}\n${head}`);
  process.exit(1);
}
const data = await res.json();

// Валидация схемы: { result: [ { id, label?, entries: [ { id, text, type? } ] } ] }
const groups = Array.isArray(data?.result) ? data.result : null;
if (!groups || !groups.length) {
  console.error(`Unexpected schema: top-level keys = ${Object.keys(data ?? {}).join(', ')}`);
  process.exit(1);
}
let total = 0;
for (const g of groups) {
  if (!g || typeof g.id !== 'string' || !Array.isArray(g.entries)) {
    console.error(`Bad group: ${JSON.stringify(g).slice(0, 200)}`);
    process.exit(1);
  }
  for (const e of g.entries) {
    if (!e || typeof e.id !== 'string' || typeof e.text !== 'string') {
      console.error(`Bad entry in group ${g.id}: ${JSON.stringify(e).slice(0, 200)}`);
      process.exit(1);
    }
    total++;
  }
}

const payload = {
  _meta: {
    source: SRC,
    fetchedAt: new Date().toISOString(),
    entries: total,
    groups: groups.map((g) => `${g.id}:${g.entries.length}`).join(' | '),
    note:
      'Offline fallback of the official trade2 stat catalog. Content © Grinding Gear Games Ltd. ' +
      'Refresh after each major GGG patch: node scripts/fetch-trade-stats.mjs',
  },
  result: groups,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(payload) + '\n', 'utf8');

console.log(`[fetch-trade-stats] OK: ${total} entries in ${groups.length} groups`);
console.log(`[fetch-trade-stats] ${payload._meta.groups}`);
console.log(`[fetch-trade-stats] written: ${outPath}`);
