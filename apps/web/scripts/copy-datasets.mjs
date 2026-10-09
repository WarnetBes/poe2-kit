/**
 * Прекомпиляция датасетов для web (№222): полный офлайн-датасет кладётся в
 * public/, чтобы браузер мог fetch'нуть его для вкладок, которым нужны теги
 * гемов («Раскладка»: HasReservation/Cooldown/Spirit-cost).
 * Файл НЕ хранится в git — копия из core при каждом build/dev.
 */
import { mkdirSync, copyFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const gameDir = join(here, '..', '..', '..', 'packages', 'core', 'data', 'game');

/** skill_gems_v2 — обязателен для «Раскладки» (теги гемов), gem_colors — раскраска SVG-схем (№223). */
const files = [
  { dir: 'skill_gems', rel: 'skill_gems_v2.json', minBytes: 1_000_000 }, // 9.9 МБ — меньше мегабайта значит скопировалось не то
  { dir: 'skill_gems', rel: 'gem_colors.json', minBytes: 10_000 }, // ~29 КБ
  // №234-Э4: «🗺 Карты» — датасеты Map Prep (135 карт + 74 группы модов, ~75 КБ);
  // кладутся в public/datasets/maps/ (fetch = datasets/maps/*.json).
  { dir: 'maps', rel: 'maps.json', minBytes: 30_000 }, // ~43 КБ
  { dir: 'maps', rel: 'waystone_mods.json', minBytes: 25_000 }, // ~32 КБ
];

for (const { dir, rel, minBytes } of files) {
  const dst = dir === 'maps'
    ? join(here, '..', 'public', 'datasets', 'maps', rel)
    : join(here, '..', 'public', 'datasets', rel); // прежние пути (fetch=datasets/<rel>) — не ломать keybinds/treeGame
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(join(gameDir, dir, rel), dst);
  const bytes = statSync(dst).size;
  if (bytes < minBytes) throw new Error(`${rel} подозрительно мал: ${bytes} Б`);
  console.log(`datasets: ${rel} → public/datasets (${bytes} Б)`);
}
