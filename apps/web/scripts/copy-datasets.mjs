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
const dataDir = join(here, '..', '..', '..', 'packages', 'core', 'data', 'game', 'skill_gems');

/** skill_gems_v2 — обязателен для «Раскладки» (теги гемов), gem_colors — раскраска SVG-схем (№223). */
const files = [
  { rel: 'skill_gems_v2.json', minBytes: 1_000_000 }, // 9.9 МБ — меньше мегабайта значит скопировалось не то
  { rel: 'gem_colors.json', minBytes: 10_000 }, // ~29 КБ
];

for (const { rel, minBytes } of files) {
  const dst = join(here, '..', 'public', 'datasets', rel);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(join(dataDir, rel), dst);
  const bytes = statSync(dst).size;
  if (bytes < minBytes) throw new Error(`${rel} подозрительно мал: ${bytes} Б`);
  console.log(`datasets: ${rel} → public/datasets (${bytes} Б)`);
}
