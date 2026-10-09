/**
 * Экстрактор датасетов «Map Prep Assistant» (SPEC_MAP_PREP, этап 1, №234).
 *
 * Читает ЛОКАЛЬНЫЙ клон PoB2 (MIT) — ничего не скачивает:
 *   - src/Data/WorldAreas.lua → packages/core/data/game/maps/maps.json
 *     (эндгейм-карты: id Map*, act 10, level >= 65; БЕЗ MapUberBoss_* —
 *     пиннакл-арены покрыты core.bosses; БЕЗ hideout-записей);
 *   - src/Data/ModMap.lua → packages/core/data/game/maps/waystone_mods.json
 *     (группы модов карт/waystones: kind prefix/suffix, stat-тексты по
 *     ступеням; ModMap.lua собран вручную самим PoB2, контент PoE2:
 *     of Exposure, of Smothering, Spell Suppression и т.д.).
 *
 * Запуск: node scripts/build_map_prep_data.mjs
 *   override пути к PoB2-клону: POE2_MAP_PREP_POB2_ROOT (для дата-сборок).
 *
 * Дисциплина (SPEC §2): только факты из источника, ничего из памяти.
 * verified: true — все поля почерпнуты из PoB2-файлов напрямую.
 *
 * Идемпотентность (гейт этапа 1, SPEC §7): парсинг детерминирован, карты
 * сортируются по id, моды хранятся в порядке источника, никаких «текущих»
 * дат — FETCHED фиксирован и меняется руками при ре-экстракте.
 *
 * Гейт: JSON строгий UTF-8 без BOM (fs.writeFileSync utf8 — Node не пишет
 * BOM; ручные правки PowerShell — только [IO.File]::WriteAllText c
 * UTF8Encoding($false), см. №224b префлайт make-portable).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Клон PoB2 — сосед _research у владельца; override для дата-сборок.
const POB2_ROOT = process.env.POE2_MAP_PREP_POB2_ROOT
  ? path.resolve(process.env.POE2_MAP_PREP_POB2_ROOT)
  : path.join(root, '..', '_research', 'path-of-building-poe2');

// SPEC §3.2: свежесть = дата экстракции + имя источника; патч-заметка GGG
// не выдумывается — пустая, пока не прочитана из реальных patch notes.
const FETCHED = '2026-10-09';

const worldAreasPath = path.join(POB2_ROOT, 'src', 'Data', 'WorldAreas.lua');
const modMapPath = path.join(POB2_ROOT, 'src', 'Data', 'ModMap.lua');
const outDir = path.join(root, 'packages', 'core', 'data', 'game', 'maps');

/** Fail-fast: молча «пустых» датасетов не делаем. */
function assertFile(p, label) {
  if (!fs.existsSync(p)) {
    console.error(`✖ ${label} не найден: ${p}`);
    process.exit(1);
  }
}
assertFile(worldAreasPath, 'WorldAreas.lua');
assertFile(modMapPath, 'ModMap.lua');

/** git rev клона PoB2 — фиксируем в _meta (фактический, не из памяти). */
function gitRev() {
  const r = spawnSync('git', ['log', '-1', '--format=%H|%ad|%s', '--date=short'], {
    cwd: POB2_ROOT,
    encoding: 'utf8',
  });
  const line = (r.stdout || '').trim();
  if (r.status !== 0 || !line) return { rev: 'unknown', note: 'git log недоступен' };
  const [rev, date, ...rest] = line.split('|');
  return { rev, note: `${rest.join(' ').trim()} (${date})` };
}
const pob2Rev = gitRev();

/** Lua-строка "..." → JS (в файле встречаются \" экранирования). */
function luaUnquote(raw) {
  const s = raw.trim();
  const m = /^"((?:\\.|[^"\\])*)"$/.exec(s);
  if (!m) return null;
  return m[1].replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
}

/** Список Lua-строк из тела таблицы (только цитированные элементы). */
function luaStringList(body) {
  const out = [];
  for (const m of body.matchAll(/"((?:\\.|[^"\\])*)"/g)) out.push(m[1].replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c)));
  return out;
}

// ============================================================================
// 1. WorldAreas.lua → maps.json
// ============================================================================

const worldAreasSrc = fs.readFileSync(worldAreasPath, 'utf8');

/**
 * Парсер сгенерированных блоков worldAreas["ID"] = { ... }.
 * Формат файла стабилен (machine-generated, №233), парсим построчно внутри
 * каждого блока — без полноценного Lua-интерпретатора (значения: строки,
 * числа, bool, inline-списки tags).
 */
function parseWorldAreas(src) {
  const areas = [];
  const blockRe = /^worldAreas\["((?:\\.|[^"\\])*)"\] = \{([\s\S]*?)^\}/gm;
  let m;
  while ((m = blockRe.exec(src)) !== null) {
    const id = m[1];
    const body = m[2];
    const area = { id };
    const num = (key) => {
      const r = new RegExp(`^\\s*${key} = (-?\\d+),?$`, 'm').exec(body);
      return r ? Number(r[1]) : undefined;
    };
    const flag = (key) => {
      const r = new RegExp(`^\\s*${key} = (true|false),?$`, 'm').exec(body);
      return r ? r[1] === 'true' : undefined;
    };
    const str = (key) => {
      const r = new RegExp(`^\\s*${key} = ("(?:\\.|[^"\\\\])*"),?$`, 'm').exec(body);
      return r ? luaUnquote(r[1]) : undefined;
    };
    const tagsMatch = /^\s*tags = \{(.*?)\},?$/m.exec(body);
    area.name = str('name');
    area.baseName = str('baseName');
    area.tags = tagsMatch ? luaStringList(tagsMatch[1]) : [];
    area.level = num('level');
    area.act = num('act');
    area.isMap = flag('isMap');
    area.isHideout = flag('isHideout');
    const list = (key) => {
      const r = new RegExp(`${key} = \\{([\\s\\S]*?)\\}`, 'm').exec(body);
      return r ? luaStringList(r[1]) : [];
    };
    area.monsterVarieties = list('monsterVarieties');
    area.bossVarieties = list('bossVarieties');
    areas.push(area);
  }
  return areas;
}

const allAreas = parseWorldAreas(worldAreasSrc);
if (allAreas.length < 100) {
  console.error(`✖ WorldAreas.lua распарсен подозрительно слабо: ${allAreas.length} блоков`);
  process.exit(1);
}

// Фильтр эндгейм-карт (SPEC §3.1 + задача):
//   id Map*, isMap=true, act>=10, level>=65; пиннакл-арены (MapUberBoss_*)
//   — НЕ карты атласа, покрыты core.bosses (№176 waystone-тиры/пиннаклы).
const BIOME_TAG_RE = /^has_([a-z]+)_biome_monsters$/;
const maps = allAreas
  .filter(
    (a) =>
      a.id.startsWith('Map') &&
      a.isMap === true &&
      a.act >= 10 &&
      a.level >= 65 &&
      !a.id.startsWith('MapUberBoss') &&
      !a.id.startsWith('MapHideout')
  )
  .map((a) => ({
    id: a.id,
    name_en: a.name,
    area_level: a.level,
    biomes: a.tags.map((t) => BIOME_TAG_RE.exec(t)).filter(Boolean).map((mm) => mm[1]),
    monster_varieties: a.monsterVarieties,
    boss_varieties: a.bossVarieties,
    verified: true,
  }))
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// Sanity SPEC §7 / отчёт №233 — утверждённые эталоны, гейт этапа 1.
const sanity = [
  {
    id: 'MapRustbowl',
    boss: ['Gozen, Rebellious Rustlord'],
    monsters: ['Ancient Ezomyte', 'Risen Arbalest'],
  },
  {
    id: 'MapBackwash',
    boss: ['Yaota, the Loathsome'],
    monsters: ['Filthy Crone', 'Filthy First-born', 'Filthy Lobber', 'Flathead Clubber', 'Flathead Warrior', 'Foul Blacksmith', 'Foul Mauler', 'Foul Sage', 'Pyromushroom Cultivator'],
  },
];
let sanityOk = true;
for (const s of sanity) {
  const e = maps.find((mm) => mm.id === s.id);
  const bossOk = e && JSON.stringify(e.boss_varieties) === JSON.stringify(s.boss);
  const monOk = e && JSON.stringify(e.monster_varieties) === JSON.stringify(s.monsters);
  if (!e || !bossOk || !monOk) {
    sanityOk = false;
    console.error(`✖ sanity #233 ${s.id}: босс=${bossOk} монстры=${monOk}`);
    if (e) console.error('  факт:', JSON.stringify(e));
  } else {
    console.log(`✓ sanity #233 ${s.id}: босс + ${e.monster_varieties.length} монстр(ов) совпали`);
  }
}
if (!sanityOk) process.exit(1);

// Гейт этапа 1 (SPEC §7) — согласованный минимум. SPEC ожидал ~149–173 карт,
// НО оба локальных клона PoB2 (main _research и TestPE) сходятся: 155 Map*-
// блоков = 135 обычных атлас-карт + 12 MapUberBoss_* (→ core.bosses) + 7
// MapHideout* + MapLeaguePortal (isMap=false). Число 135 — факт источника,
// не ошибка экстрактора (сверено 09.10.2026, rev bb52d6b3).
const EXPECTED_MIN_MAPS = 130;
if (maps.length < EXPECTED_MIN_MAPS) {
  console.error(`✖ гейт этапа 1: карт ${maps.length} < ${EXPECTED_MIN_MAPS} — источник/формат изменились`);
  process.exit(1);
}

const biomeSet = [...new Set(maps.flatMap((mm) => mm.biomes))].sort();

const mapsPayload = {
  _meta: {
    source: 'PathOfBuilding-PoE2 WorldAreas.lua (MIT)',
    fetched: FETCHED,
    local_clone: '_research/path-of-building-poe2',
    git_rev: pob2Rev.rev,
    git_note: pob2Rev.note,
    patch_note: '',
    map_count: maps.length,
    biome_tag_names: biomeSet,
    filter: 'id Map*, isMap=true, act>=10, level>=65, без MapUberBoss_* (пиннакл-арены → core.bosses) и MapHideout*',
  },
  maps,
};

// ============================================================================
// 2. ModMap.lua → waystone_mods.json
// ============================================================================

const modMapSrc = fs.readFileSync(modMapPath, 'utf8');

/** Lua-числовой массив literal → JS-структура (числа/вложенные массивы). */
function parseLuaValues(text) {
  let i = 0;
  function parseValue() {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === '{') {
      i++;
      const arr = [];
      while (i < text.length) {
        while (i < text.length && /[\s,]/.test(text[i])) i++;
        if (text[i] === '}') { i++; return arr; }
        arr.push(parseValue());
      }
      return arr;
    }
    const m = /^-?\d+(?:\.\d+)?/.exec(text.slice(i));
    if (!m) throw new Error(`не удалось разобрать values: ${text}`);
    i += m[0].length;
    return Number(m[0]);
  }
  const v = parseValue();
  return Array.isArray(v) ? v : [v];
}

/** Выдернуть fields группы из тела блока AffixData["Name"] = { ... }. */
function parseModMap(src) {
  const groups = [];
  const affixHeader = /^\tAffixData = \{/m;
  if (!affixHeader.test(src)) throw new Error('ModMap.lua: нет AffixData — формат источника изменился');

  // Блоки двух видов:
  //   многострочные ["Name"] = { ... } \n\t\t},
  //   однострочные пустые ["Name"] = { },  -- реальный stat-текст в комментарии
  const blockRe = /^\t\t\["((?:\\.|[^"\\])*)"\] = (?:\{\s*\}|([\s\S]*?)\n\t\t\}),?[ \t]*(?:--\s?(.*))?$/gm;
  let m;
  while ((m = blockRe.exec(src)) !== null) {
    const name = m[1].replace(/\\"/g, '"');
    const body = m[2] || '';
    const comment = (m[3] || '').trim();
    const group = { name, comment, };
    const strField = (key) => {
      const r = new RegExp(`^\\s*${key} = ("(?:\\.|[^"\\\\])*"),?$`, 'm').exec(body);
      return r ? luaUnquote(r[1]) : undefined;
    };
    const linesMatch = /tooltipLines = \{([^\n]*?)\}/.exec(body);
    const valuesMatch = /values = (\{[\s\S]*?\n?\})\s*,?\s*$/m.exec(body);
    const typeMatch = /^\s*type = "(\w+)",?$/m.exec(body);
    group.type = typeMatch ? typeMatch[1] : undefined;
    group.label = strField('label');
    group.tooltip = strField('tooltip');
    group.tooltipLines = linesMatch ? luaStringList(linesMatch[1]) : [];
    group.values = valuesMatch ? parseLuaValues(valuesMatch[1]) : undefined;
    groups.push(group);
  }
  return groups;
}

const modGroups = parseModMap(modMapSrc);
if (modGroups.length < 55) throw new Error(`ModMap.lua: групп ${modGroups.length} — формат изменился?`);

// kind: перекрёстная проверка по спискам Prefix/Suffix самого источника,
// фолбэк — именной префикс "of " (в PoE2 все суффиксы named "of ...").
const prefixNames = new Set(luaStringList(/Prefix = \{[\s\S]*?\n\t\}/.exec(modMapSrc)?.[0] ?? ''));
const suffixNames = new Set(luaStringList(/Suffix = \{[\s\S]*?\n\t\}/.exec(modMapSrc)?.[0] ?? ''));
for (const g of modGroups) {
  if (prefixNames.has(g.name) && !suffixNames.has(g.name)) g.kind = 'prefix';
  else if (suffixNames.has(g.name) && !prefixNames.has(g.name)) g.kind = 'suffix';
  else g.kind = g.name.startsWith('of ') ? 'suffix' : 'prefix';
}

/** Сгладить values-структуру одного тира в очередь чисел. */
function flatten(v) {
  const out = [];
  const walk = (x) => {
    if (Array.isArray(x)) x.forEach(walk);
    else out.push(x);
  };
  walk(v);
  return out;
}

/**
 * Рендер stat-текста тира (детерминированный, последовательный):
 * линейки tooltipLines используют числа из values[val] в порядке следования;
 * "(%d to %d)" потребляет пару из очереди. Неоднозначности самих исходных
 * данных PoB2 (напр. порядокof Miring линия/значение расходится с apply-кодом)
 * НЕ правим — берём tooltipLines как есть, расхождение зафиксировано в отчёте.
 */
let renderWarn = 0;
function renderTierStatText(lines, queue) {
  let q = [...queue];
  return lines
    .map((line) => {
      return line
        .replace(/\(%d to %d\)|%d/g, (pat) => {
          if (pat === '(%d to %d)') {
            const [a, b] = [q.shift(), q.shift()];
            if (a === undefined || b === undefined) { renderWarn++; return '?'; }
            return `(${a} to ${b})`;
          }
          const v = q.shift();
          if (v === undefined) { renderWarn++; return '?'; }
          return String(v);
        })
        .replace(/%%/g, '%');
    })
    .join('\n');
}

function humanizeId(name) {
  return name
    .replace(/'/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const mods = [];
for (const g of modGroups) {
  const tiers = [];
  if (!g.values || !Array.isArray(g.values) || g.values.length === 0) {
    // check-моды и пустые группы «other»: ступеней нет — одна запись; для
    // пустых групп статистика живёт в Lua-комментарии (реальный pool-мод).
    const lines = g.tooltipLines.length > 0 ? g.tooltipLines : g.comment ? [g.comment] : [];
    tiers.push({ stat_text_en: lines.join('\n') });
  } else {
    for (let t = 0; t < g.values.length; t++) {
      const queue = flatten(g.values[t]);
      tiers.push({
        stat_text_en: renderTierStatText(g.tooltipLines, queue),
        values: g.values[t],
      });
    }
  }
  mods.push({
    id: humanizeId(g.name),
    kind: g.kind,
    name_en: g.name,
    ...(g.label ? { config_label_en: g.label } : {}),
    ...(g.tooltip ? { tooltip_en: g.tooltip } : {}),
    tiers,
    verified: true,
  });
}

const modsPayload = {
  _meta: {
    source: 'PathOfBuilding-PoE2 ModMap.lua (MIT; собран вручную самим PoB2 — конфиг map-модов PoB2, not PoE1)',
    fetched: FETCHED,
    local_clone: '_research/path-of-building-poe2',
    git_rev: pob2Rev.rev,
    git_note: pob2Rev.note,
    patch_note: '',
    group_count: mods.length,
    prefix_count: mods.filter((x) => x.kind === 'prefix').length,
    suffix_count: mods.filter((x) => x.kind === 'suffix').length,
    render_warnings: 0, // заполнение ниже, после renderWarn учтено
  },
  mods,
};
modsPayload._meta.render_warnings = renderWarn;

// ============================================================================
// 3. Запись (UTF-8 без BOM — Node не пишет BOM; строго 2-space + \n)
// ============================================================================

const mapsJson = JSON.stringify(mapsPayload, null, 2) + '\n';
const modsJson = JSON.stringify(modsPayload, null, 2) + '\n';

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'maps.json'), mapsJson, 'utf8');
fs.writeFileSync(path.join(outDir, 'waystone_mods.json'), modsJson, 'utf8');

// ============================================================================
// 4. Валидация (гейт этапа 1): reparse, BOM-чек, пороги, отчёт
// ============================================================================

for (const [file, json] of [[path.join(outDir, 'maps.json'), mapsJson], [path.join(outDir, 'waystone_mods.json'), modsJson]]) {
  JSON.parse(fs.readFileSync(file, 'utf8'));
  const head = fs.readFileSync(file).subarray(0, 3);
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
    console.error(`✖ ${file}: BOM!`);
    process.exit(1);
  }
  console.log(`✓ ${path.relative(root, file)}: валидный JSON, без BOM, ${json.length} Б`);
}

console.log(`\n=== build_map_prep_data: итог ===`);
console.log(`карт: ${maps.length} (биомы: ${biomeSet.join(', ')})`);
console.log(`модов: ${mods.length} (prefix ${modsPayload._meta.prefix_count} / suffix ${modsPayload._meta.suffix_count}), render-warnings: ${renderWarn}`);
console.log(`PoB2 rev: ${pob2Rev.rev} — ${pob2Rev.note}`);
