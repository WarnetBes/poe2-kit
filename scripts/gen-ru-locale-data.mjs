/**
 * Разовая генерация офлайн RU-данных (мастер-план §5, RU mod-patterns):
 * 1) items-classes: xiletrade ItemClassTwo.json (PoE2 RU-канон, MIT)
 * 2) mods: Exiled Exchange 2 dataParser/output/ru/stats.ndjson (MIT)
 * Источники — локальные клоны _research. Не входит в CI: воспроизводимость =
 * повторный запуск node scripts/gen-ru-locale-data.mjs (пути те же).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'packages', 'core', 'data', 'game', 'i18n');

const REPO = 'C:/Users/mezhavikiserj/BildPOE2/_research';
const XILE = path.join(REPO, 'xiletrade/src/Xiletrade.Library/Data/Lang/ru-RU/ItemClassTwo.json');
const EXE = path.join(REPO, 'exiled-exchange-2/dataParser/output/ru/stats.ndjson');

// ── 1. Классы предметов RU→EN (PoE2) ────────────────────────────────────────
const xile = JSON.parse(fs.readFileSync(XILE, 'utf8').replace(/^\uFEFF/, '')).item_class;
const classes = [];
for (const c of xile) {
  if (!c.name || !c.name_en) continue;
  classes.push([c.name, c.name_en]);
}
fs.writeFileSync(
  path.join(OUT, 'item_classes_ru.json'),
  JSON.stringify(
    {
      _meta: {
        note: 'RU→EN значения «Класс предмета:» из клир-текста PoE2 (RU-клиент)',
        source: 'https://github.com/maxensas/xiletrade (MIT) — src/Xiletrade.Library/Data/Lang/ru-RU/ItemClassTwo.json',
        built: '2026-10-11',
      },
      classes,
    },
    null,
    1,
  ) + '\n',
);

// ── 2. Моды RU→EN (ExE2 stats.ndjson) ───────────────────────────────────────
const ndjson = fs.readFileSync(EXE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const seen = new Set();
const mods = [];
let negates = 0;
for (const st of ndjson) {
  if (!st.ref || typeof st.ref !== 'string' || !st.ref.includes('#')) continue;
  if (!Array.isArray(st.matchers)) continue;
  for (const m of st.matchers) {
    if (!m || typeof m.string !== 'string') continue;
    const ru = m.string.trim();
    if (!ru || !ru.includes('#')) continue;
    const key = ru + '|' + (m.negate ? 1 : 0);
    if (seen.has(key)) continue;
    seen.add(key);
    if (m.negate) negates++;
    mods.push({ ru, en: st.ref, ...(m.negate ? { negate: true } : {}) });
  }
}
fs.writeFileSync(
  path.join(OUT, 'mods_ru.json'),
  JSON.stringify(
    {
      _meta: {
        note: 'RU-строки модов → EN ref: перевод mod-текста RU-клиента для estimate/verdict',
        source: 'https://github.com/Kvan7/Exiled-Exchange-2 (MIT), dataParser/output/ru/stats.ndjson',
        built: '2026-10-11',
      },
      mods,
    },
    null,
    1,
  ) + '\n',
);
console.log(`classes: ${classes.length}, mods: ${mods.length} (negate: ${negates})`);
