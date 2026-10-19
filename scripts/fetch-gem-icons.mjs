#!/usr/bin/env node
/**
 * fetch-gem-icons.mjs — харвест иконок гемов PoE2 из poe2db (CC BY-NC-SA, тот же
 * игровой арт GGG, что использует poeshop; НЕ их ассеты).
 *
 * Источник списка имён:
 *   активные  = ключи recommended_supports.json (381);
 *   саппорты  = union RU-имён recommended_supports + supports из meta_supports.json (~509);
 * Страница-слаг: 'ice strike' → https://poe2db.tw/us/Ice_Strike ('Brutality I' → /Brutality_I).
 * Из страницы берётся ПЕРВАЯ иконка камня: /image/Art/2DItems/Gems/New/(NewSupport/)?<Name>(SkillGem|SupportGem).webp
 * (активные = SkillGem, саппорты = SupportGem — как в игре, это и крутят планнеры).
 *
 * Выход: packages/core/data/game/skill_gems/icons/<norm>.webp  (norm = gem_colors-ключ:
 *        lowercase, пробелы схлопнуты) + icon_index.json {map: norm -> true} (манифест).
 * Фолбэк для ненайденных — цветной жетон в UI (planner.ts/poeguides.ts) их НЕ качает.
 *
 * Уважение к донору: пауза между запросами, UA, resume (существующие файлы не перекачивает).
 * Запуск: node scripts/fetch-gem-icons.mjs [--limit=N]
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SG = path.join(ROOT, 'packages/core/data/game/skill_gems');
const ICONS_DIR = path.join(SG, 'icons');
const INDEX = path.join(SG, 'icon_index.json');
const UA = 'poe2-kit-icon-harvest/1.0 (offline kit; contact: kit owner)';
const PAUSE_MS = 350;
const GEM_RE = /https:\/\/cdn\.poe2db\.tw\/image\/Art\/2DItems\/Gems\/New\/(?:[^"')]+?)\.webp/;

const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
// Слаг poe2db повторяет КЕЙС имени: слова Title Case, КРОМЕ служебных (of/the)
// не в начале; римские цифры (I/II/III/…) — целиком верхним регистром;
// percent-кодирование в имени — ВЕРХНИМ хексом (путь регистрозависим: %2C ≠ %2c).
const STOP_WORDS = new Set(['of', 'the']);
const ROMAN = /^(?:i{1,3}|iv|v|vi{0,3}|ix|x)$/i;
const capHyphens = (w) =>
  w.replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase())
    .split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('-');
const slugOf = (en) => en.trim().split(/\s+/)
  .map((w, i) =>
    ROMAN.test(w) ? w.toUpperCase() :
    (i > 0 && STOP_WORDS.has(w)) ? w : capHyphens(w))
  .join('_');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = async (p) => access(p, FS.F_OK).then(() => true).catch(() => false);

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

// Имена: активные + саппорты — та же логика, что в planner.ts
const reco = JSON.parse(await readFile(path.join(SG, 'recommended_supports.json'), 'utf8'));
const meta = JSON.parse(await readFile(path.join(SG, 'meta_supports.json'), 'utf8'));
const actives = Object.keys(reco.map ?? {});
const supports = new Set(actives); // норм-ключи сразу
for (const list of Object.values(reco.map ?? {})) {
  for (const r of list ?? []) supports.add(norm(r.en));
}
for (const builds of Object.values(meta.entries ?? {})) {
  for (const rec of builds ?? []) for (const s of rec.supports ?? []) supports.add(norm(s));
}

// прошлый индекс → resume: уже скачанные не трогаем
let prevIndex = { map: {} };
if (await exists(INDEX)) prevIndex = JSON.parse(await readFile(INDEX, 'utf8'));
const done = new Set(Object.keys(prevIndex.map ?? {}));

await mkdir(ICONS_DIR, { recursive: true });
const targets = [...new Set([...actives.map(norm), ...supports])].filter((n) => !done.has(n));
const queue = limitArg ? targets.slice(0, LIMIT) : targets;
console.log(`иконки: ${done.size} есть, качаем ${queue.length} из ${targets.length + done.size} (лимит ${LIMIT})`);

let ok = 0, fail = 0, noclose = 0;
const failures = [];

for (let i = 0; i < queue.length; i++) {
  const en = queue[i];
  const url = `https://poe2db.tw/us/${slugOf(en)}`;
  try {
    const page = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!page.ok) throw new Error(`страница HTTP ${page.status}`);
    const html = await page.text();
    const m = html.match(GEM_RE);
    if (!m) throw new Error('иконка камня не найдена');
    const file = path.join(ICONS_DIR, en.replace(/[^a-z0-9 ]/gu, '') + '.webp');
    const buf = Buffer.from(await (await fetch(m[0], { headers: { 'User-Agent': UA } })).arrayBuffer());
    if (buf.length < 500) throw new Error(`подозрительно мал (${buf.length} Б)`);
    await writeFile(file, buf);
    prevIndex.map[en] = true;
    ok++;
  } catch (e) {
    fail++;
    failures.push(`${en}: ${e.message}`);
    noclose = /не найдена|404/.test(String(e.message)) ? noclose + 1 : noclose;
  }
  if (i % 25 === 0 || i === queue.length - 1) {
    console.log(`  ${i + 1}/${queue.length} ok=${ok} fail=${fail}`);
    await writeFile(INDEX, JSON.stringify({ version: 1, source: 'poe2db.tw (CC BY-NC-SA), игровой арт GGG; слаги EN', map: prevIndex.map }), 'utf8');
  }
  await sleep(PAUSE_MS);
}

await writeFile(INDEX, JSON.stringify({ version: 1, source: 'poe2db.tw (CC BY-NC-SA), игровой арт GGG; слаги EN', map: prevIndex.map }), 'utf8');
console.log(`ГОТОВО: скачано ${ok}, промахов ${fail} (фолбэк — цветной жетон в UI). Индекс: ${Object.keys(prevIndex.map).length} записей.`);
if (failures.length) {
  console.log('Промахи (первые 15):');
  for (const f of failures.slice(0, 15)) console.log('  - ' + f);
}
