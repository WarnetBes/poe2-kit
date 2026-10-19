/**
 * Прекомпиляция датасетов для web (№222): полный офлайн-датасет кладётся в
 * public/, чтобы браузер мог fetch'нуть его для вкладок, которым нужны теги
 * гемов («Раскладка»: HasReservation/Cooldown/Spirit-cost).
 * Файл НЕ хранится в git — копия из core при каждом build/dev.
 */
import { mkdirSync, copyFileSync, statSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const gameDir = join(here, '..', '..', '..', 'packages', 'core', 'data', 'game');

/** skill_gems_v2 — обязателен для «Раскладки» (теги гемов), gem_colors — раскраска SVG-схем (№223). */
const files = [
  { dir: 'skill_gems', rel: 'skill_gems_v2.json', minBytes: 1_000_000 }, // 9.9 МБ — меньше мегабайта значит скопировалось не то
  { dir: 'skill_gems', rel: 'gem_colors.json', minBytes: 10_000 }, // ~29 КБ
  // №266: «Саппорт-советы» в разборе билда — core.gemSupports в браузере
  // (слои: meta_supports — эталон меты; recommended_supports — base-ранги poe2db).
  { dir: 'skill_gems', rel: 'meta_supports.json', minBytes: 10_000 }, // ~16 КБ
  { dir: 'skill_gems', rel: 'recommended_supports.json', minBytes: 200_000 }, // ~317 КБ
  // №234-Э4: «🗺 Карты» — датасеты Map Prep (135 карт + 74 группы модов, ~75 КБ);
  // кладутся в public/datasets/maps/ (fetch = datasets/maps/*.json).
  { dir: 'maps', rel: 'maps.json', minBytes: 30_000 }, // ~43 КБ
  { dir: 'maps', rel: 'waystone_mods.json', minBytes: 25_000 }, // ~32 КБ
  // poeshop-волна: гайды/билды poeshop.ru (фактура + атрибуция, ленивый fetch poeguides.ts)
  { dir: 'guides', rel: 'poeshop_guides.json', minBytes: 30_000 },
  // planner-волна: каталог уников (имена по категориям — datalist слотов гира планнера)
  { dir: 'uniques', rel: 'uniques_catalog.json', minBytes: 50_000 },
  // иконки гемов (poe2db CC BY-NC-SA, игровой арт GGG; fetch = datasets/gem_icons/*.webp)
  { dir: 'skill_gems', rel: 'icon_index.json', minBytes: 100 }, // манифест norm→true
  // иконки уников (poe2db): манифест norm→true (слоты гира планнера)
  { dir: 'uniques', rel: 'item_index.json', minBytes: 10 },
  // иконки валют (poe2db): манифест norm→true (вкладка «Курсы валют»)
  { dir: 'currency', rel: 'currency_index.json', minBytes: 10 },
  // каталог базовых предметов (rare-основа пикера гира, трек B: gen-base-catalog.mjs)
  { dir: 'base_catalog', rel: 'bases_catalog.json', minBytes: 50_000 },
];

for (const { dir, rel, minBytes } of files) {
  const dst = ['maps', 'guides'].includes(dir)
    ? join(here, '..', 'public', 'datasets', dir, rel)
    : join(here, '..', 'public', 'datasets', rel); // прежние пути (fetch=datasets/<rel>) — не ломать keybinds/treeGame
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(join(gameDir, dir, rel), dst);
  const bytes = statSync(dst).size;
  if (bytes < minBytes) throw new Error(`${rel} подозрительно мал: ${bytes} Б`);
  console.log(`datasets: ${rel} → public/datasets (${bytes} Б)`);
}

// gem_icons/ — папка webp-иконок (не в списке файлов): зеркалим папку целиком,
// отсутствующие файлы и файлы сcore вне индекса — вычищаем (MIR-семантика).
{
  const src = join(gameDir, 'skill_gems', 'icons');
  const dst = join(here, '..', 'public', 'datasets', 'gem_icons');
  rmSync(dst, { recursive: true, force: true });
  if (existsSync(src)) {
    mkdirSync(dst, { recursive: true });
    let n = 0;
    for (const f of readdirSync(src)) {
      if (!f.endsWith('.webp')) continue;
      copyFileSync(join(src, f), join(dst, f));
      n++;
    }
    console.log(`datasets: gem_icons/ → public/datasets (${n} webp)`);
  }
}

// item_icons/ — зеркалим иконки уников (webp+png, fetch = datasets/item_icons/*)
{
  const src = join(gameDir, 'uniques', 'icons');
  const dst = join(here, '..', 'public', 'datasets', 'item_icons');
  rmSync(dst, { recursive: true, force: true });
  if (existsSync(src)) {
    mkdirSync(dst, { recursive: true });
    let n = 0;
    for (const f of readdirSync(src)) {
      if (!f.endsWith('.webp') && !f.endsWith('.png')) continue;
      copyFileSync(join(src, f), join(dst, f));
      n++;
    }
    console.log(`datasets: item_icons/ → public/datasets (${n} файлов)`);
  }
}

// currency_icons/ — зеркалим иконки валют (fetch = datasets/currency_icons/*)
{
  const src = join(gameDir, 'currency', 'icons');
  const dst = join(here, '..', 'public', 'datasets', 'currency_icons');
  rmSync(dst, { recursive: true, force: true });
  if (existsSync(src)) {
    mkdirSync(dst, { recursive: true });
    let n = 0;
    for (const f of readdirSync(src)) {
      if (!f.endsWith('.webp') && !f.endsWith('.png')) continue;
      copyFileSync(join(src, f), join(dst, f));
      n++;
    }
    console.log(`datasets: currency_icons/ → public/datasets (${n} файлов)`);
  }
}
