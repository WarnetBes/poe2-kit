/**
 * Экстрактор карт для конвертера Build Planner (.build, PoE2 0.5.x).
 *
 * Источники (локальные клоны PathOfBuilding-PoE2, патч-дерево 0_5):
 *  - src/TreeData/0_5/tree.lua — узлы: `[63236]={ skill=63236, stringId="AscendancyMonk2Notable9", … }`
 *    → карта «числовой PoB-id → GGG-slug пассивки».
 *  - src/Data/Gems.lua — ключ `["Metadata/Items/Gems/SkillGemIceStrike"]={ name="Ice Strike", … }`
 *    → карта «отображаемое имя камня → metadata-путь» (активные и саппорты).
 *
 * Выход: packages/core/data/game/build_planner/map.json
 * Формат .build — официальный, см. pathofexile.com/developer/docs/game (Build Planner),
 * schema v1 (experimental).
 *
 * Запуск: node scripts/extract-build-planner-map.mjs [путь к path-of-building-poe2]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const pobRepo =
  process.argv[2] ??
  path.join(repoRoot, '..', '_research', 'path-of-building-poe2');
const treeLuaPath = path.join(pobRepo, 'src', 'TreeData', '0_5', 'tree.lua');
const gemsLuaPath = path.join(pobRepo, 'src', 'Data', 'Gems.lua');

if (!fs.existsSync(treeLuaPath)) {
  console.error(`[extract-build-planner-map] tree.lua не найден: ${treeLuaPath}`);
  console.error('Передайте путь к path-of-building-poe2 аргументом.');
  process.exit(1);
}

// ── 1. tree.lua: числовой id → stringId (GGG slug) ─────────────────────────
const treeLua = fs.readFileSync(treeLuaPath, 'utf8');

/** `[63236]={ … skill=63236, … stringId="AscendancyMonk2Notable9" … }` */
const numericToSlug = {};
const nodeRe = /\[(\d+)\]=\{([\s\S]*?)\n\t\t\}/g;
let m;
let nodeCount = 0;
let slugCount = 0;
while ((m = nodeRe.exec(treeLua))) {
  nodeCount++;
  const body = m[2];
  const skillMatch = body.match(/\bskill\s*=\s*(\d+)/);
  const slugMatch = body.match(/\bstringId\s*=\s*"([^"]+)"/);
  if (skillMatch && slugMatch) {
    // ключ узла и skill обычно совпадают; берём оба вхождения карту.
    numericToSlug[skillMatch[1]] = slugMatch[1];
    if (m[1] !== skillMatch[1]) numericToSlug[m[1]] = slugMatch[1];
    slugCount++;
  }
}

// ── 2. Gems.lua: имя → metadata-путь ───────────────────────────────────────
const gemsLua = fs.readFileSync(gemsLuaPath, 'utf8');

// ВАЖНО: настоящий metadata-путь камня — поле gameId (у саппортов ключ записи
// `Metadata/Items/Gems/SkillGem<X>Support`, а gameId — реальный игровой путь
// `Metadata/Items/Gems/SupportGem<X>`, который и требует формат *.build).
const gemNameToMetadata = {};
let gemCount = 0;
let dupes = 0;
const gemRe = /\["(Metadata\/Items\/Gems?\/(?:Skill|Support)Gem[^"]+)"\]\s*=\s*\{([\s\S]*?)\n\t\}/g;
let g;
while ((g = gemRe.exec(gemsLua))) {
  gemCount++;
  const body = g[2];
  const nameMatch = body.match(/\bname\s*=\s*"((?:[^"\\]|\\.)*)"/);
  const idMatch = body.match(/\bgameId\s*=\s*"([^"]+)"/);
  if (!nameMatch || !idMatch) continue;
  const name = nameMatch[1].replace(/\\"/g, '"');
  const metadataPath = idMatch[1];
  if (!name || !metadataPath) continue;
  if (gemNameToMetadata[name] && gemNameToMetadata[name] !== metadataPath) {
    dupes++;
    continue; // неоднозначное имя — НЕ угадываем, первый кандидат остаётся
  }
  gemNameToMetadata[name] = metadataPath;
}

// ── 3. Запись датасета ──────────────────────────────────────────────────────
const out = {
  metadata: {
    dataset: 'build_planner/converter_map',
    purpose:
      'Карты для экспорта *.build (официальный Build Planner PoE2, schema v1 experimental): ' +
      'numeric_to_slug — числовой PoB-id узла → GGG-slug (PassiveSkills.id); ' +
      'gem_name_to_metadata — отображаемое имя камня → Metadata/Items/Gems/... (требование формата skills[].id).',
    sources: [
      'PathOfBuilding-PoE2 src/TreeData/0_5/tree.lua (stringId узлов)',
      'PathOfBuilding-PoE2 src/Data/Gems.lua (name + metadata-ключ)',
    ],
    format_spec: 'pathofexile.com/developer/docs/game — Build Planner (PoE2 only), schema v1 (experimental)',
    tree_version: '0_5',
    extracted_nodes: nodeCount,
    numeric_to_slug_count: Object.keys(numericToSlug).length,
    gem_count: gemCount,
    gem_name_map_count: Object.keys(gemNameToMetadata).length,
    ambiguous_gem_names_skipped: dupes,
    extraction_date: new Date().toISOString(),
  },
  numeric_to_slug: numericToSlug,
  gem_name_to_metadata: gemNameToMetadata,
};

const outDir = path.join(repoRoot, 'packages', 'core', 'data', 'game', 'build_planner');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'map.json');
fs.writeFileSync(outPath, JSON.stringify(out), 'utf8');

console.log(`[extract-build-planner-map] узлов в tree.lua: ${nodeCount}`);
console.log(`[extract-build-planner-map] numeric→slug: ${Object.keys(numericToSlug).length} (посчитано ${slugCount})`);
console.log(`[extract-build-planner-map] камней в Gems.lua: ${gemCount}, имя→metadata: ${Object.keys(gemNameToMetadata).length}, пропущено неоднозначных имён: ${dupes}`);
console.log(`[extract-build-planner-map] → ${outPath}`);
