// Валидатор и слияние вкладов в библиотеку предметов (для МЕЙНТЕЙНЕРА kit).
//
// Приём данных: issue на SourceCraft с приложенным
// poe2-items-contribution-<дата>.json (см. contribute-items.mjs).
//
// БЕЗОПАСНОСТЬ (см. SECURITY.md): этот скрипт — единственный путь, которым
// пользовательские данные попадают в репозиторий. Правила:
//   • читается ТОЛЬКО JSON (никакого eval/require пользовательских данных);
//   • строгая схема: белый список ключей, типы, лимиты длин и объёма;
//   • stat-id валидируются по формату/whitelist-префиксам;
//   • в датасеты пишутся только скалярные строки/числа — исполнить ничего
//     невозможно (данные читаются через JSON.parse и никогда не eval-ятся).
//   • скрипт сам ничего не коммитит: мейнтейнер смотрит git diff сам.
//
// Использование:
//   node merge-contributions.mjs poe2-items-contribution-2026-09-26.json [...]
// (запуск из packages/core).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Эталоны для проверки предложенных stat-шаблонов (сборка dist обязательна
// перед запуском: npm run build). Нет dist — проверка пропускается, merge
// продолжает работать как раньше (мягкая деградация).
let statdesc = null;
try {
  statdesc = await import('./dist/statdesc.js');
} catch {
  console.warn('⚠ dist/statdesc.js не собран — эталонная проверка датамайна пропущена');
}
let tradeSnapshot = null;
try {
  tradeSnapshot = await import('./dist/tradeSnapshot.js');
} catch {
  console.warn('⚠ dist/tradeSnapshot.js не собран — проверка по снапшоту каталога пропущена');
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, 'data', 'game', 'learned');
const MAX_ENTRIES_PER_CONTRIB = 5000;
const MAX_ITEMS_SEEN = 20000;

const STAT_ID_RE = /^(explicit|implicit|crafted|enchant|pseudo|fractured)\.stat_[0-9a-z_]{1,48}$/;
const RARITY_RE = /^[A-Za-z ]{1,32}$/;
const MAX_STR = { name: 128, baseType: 128, itemClass: 64, mod: 256, league: 64, source: 32 };

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

function str(v, max, what) {
  if (typeof v !== 'string') fail(`тип ${what}: ожидалась строка`);
  if (v.length === 0) return '';
  if (v.length > max) fail(`${what}: длиннее ${max} символов`);
  // только печатные символы без управляющих — данные, не код
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v)) fail(`${what}: управляющие символы`);
  return v;
}

function validateContribution(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) fail('корень не объект');
  const allowedRoot = new Set(['version', 'generatedAt', 'kitVersion', 'leagues', 'entries']);
  for (const k of Object.keys(raw)) if (!allowedRoot.has(k)) fail(`неизвестный ключ корня: ${k}`);
  if (raw.version !== 1) fail('version != 1');
  if (!Array.isArray(raw.entries)) fail('entries не массив');
  if (raw.entries.length > MAX_ENTRIES_PER_CONTRIB) fail(`entries > ${MAX_ENTRIES_PER_CONTRIB}`);
  if (raw.leagues != null && !Array.isArray(raw.leagues)) fail('leagues не массив');
  const allowedEntry = new Set([
    'at', 'league', 'source', 'rarity', 'name', 'baseType', 'itemClass',
    'itemLevel', 'reqLevel', 'mods', 'statIds',
  ]);
  const entries = [];
  for (const e of raw.entries) {
    if (e == null || typeof e !== 'object') fail('entry не объект');
    for (const k of Object.keys(e)) if (!allowedEntry.has(k)) fail(`неизвестный ключ entry: ${k}`);
    const baseType = str(e.baseType, MAX_STR.baseType, 'baseType');
    if (!baseType) fail('пустой baseType');
    const rarity = str(e.rarity, 32, 'rarity');
    if (!RARITY_RE.test(rarity)) fail(`rarity «${rarity}» не похожа на редкость`);
    const mods = Array.isArray(e.mods)
      ? e.mods.slice(0, 24).map((m) => str(m, MAX_STR.mod, 'mod'))
      : [];
    const statIds = Array.isArray(e.statIds)
      ? e.statIds.slice(0, 24).filter((id) => typeof id === 'string' && STAT_ID_RE.test(id))
      : [];
    entries.push({
      at: typeof e.at === 'string' ? e.at.slice(0, 32) : '',
      league: e.league ? str(e.league, MAX_STR.league, 'league') : null,
      source: e.source ? str(e.source, MAX_STR.source, 'source') : null,
      rarity,
      name: e.name ? str(e.name, MAX_STR.name, 'name') : null,
      baseType,
      itemClass: e.itemClass ? str(e.itemClass, MAX_STR.itemClass, 'itemClass') : null,
      itemLevel: Number.isFinite(e.itemLevel) ? e.itemLevel : null,
      reqLevel: Number.isFinite(e.reqLevel) ? e.reqLevel : null,
      mods: mods.filter(Boolean),
      statIds,
    });
  }
  return { entries, leagues: (raw.leagues ?? []).map((l) => str(l, MAX_STR.league, 'league')) };
}

/** Шаблон из конкретного текста мода: цифры → '#'. */
function toTemplate(text) {
  return text.replace(/-?\d+(?:\.\d+)?/g, '#').replace(/\s+/g, ' ').trim();
}

function loadJson(p, dflt) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return dflt;
  }
}

const files = process.argv.slice(2);
if (!files.length) fail('укажите файл(ы) вклада: node merge-contributions.mjs <файл.json> [...]');

const itemsSeen = loadJson(join(DATA, 'items_seen.json'), { version: 1, entries: {} });
const statMap = loadJson(join(DATA, 'stat_text_map.json'), { version: 1, entries: {} });

let shapes = 0, statLearned = 0, statUpdated = 0;
const leagues = new Set(itemsSeen.leagues ?? []);
// Предложения этого запуска: trade stat_id -> шаблон (для эталонной сверки).
const proposed = new Map();

for (const f of files) {
  console.log(`\nВклад: ${f}`);
  const raw = JSON.parse(readFileSync(f, 'utf8'));
  const { entries, leagues: ls } = validateContribution(raw);
  ls.forEach((l) => leagues.add(l));
  for (const e of entries) {
    // ── 1) форма предмета в items_seen (дедуп: rarity+name+baseType+mods) ──
    const key = [
      e.rarity, e.name ?? '', e.baseType,
      e.mods.map((m) => m.toLowerCase().replace(/\d+(?:\.\d+)?/g, '#')).sort().join('|'),
    ].join('\u0001');
    const cur = itemsSeen.entries[key];
    if (!cur) {
      itemsSeen.entries[key] = { ...e, count: 1 };
      shapes++;
    } else {
      cur.count = (cur.count ?? 1) + 1;
      if ((e.at ?? '') > (cur.lastSeen ?? '')) cur.lastSeen = e.at;
    }
    // ── 2) stat-id ↔ шаблон (только однозначные пары: число модов == числу id) ──
    if (e.mods.length > 0 && e.mods.length === e.statIds.length) {
      e.mods.forEach((m, i) => {
        const tpl = toTemplate(m);
        const id = e.statIds[i];
        if (!tpl.includes('#') || !STAT_ID_RE.test(id)) return;
        if (tpl.length > 160) return;
        const prev = statMap.entries[id];
        proposed.set(id, tpl);
        if (prev == null) { statMap.entries[id] = tpl; statLearned++; }
        else if (tpl.length > prev.length) { statMap.entries[id] = tpl; statUpdated++; }
      });
    }
  }
}

// ── 3) эталонная сверка предложенных stat-шаблонов ──────────────────────────
// Нормализация шаблона к сопоставимому виду: normalizeStatPattern (плейсхолдеры
// и числа → '#', теги → display) + срез голого знака перед '#' (learned-шаблон
// "+# to maximum Life" и каталог "# to maximum Life" — один паттерн).
const normPattern = (t) =>
  statdesc
    ? statdesc.normalizeStatPattern(t).replace(/[+-]\s*#/g, '#')
    : t.replace(/\s+/g, ' ').trim().toLowerCase();

const snapTexts = new Set();
const snapById = new Map();
if (tradeSnapshot) {
  for (const e of tradeSnapshot.getTradeStatSnapshot()) {
    const n = normPattern(e.text);
    snapTexts.add(n);
    if (!snapById.has(e.id)) snapById.set(e.id, n);
  }
}

const verify = { datamine: 0, snapshot: 0, unknown: [], conflicts: [] };
for (const [id, tpl] of proposed) {
  const n = normPattern(tpl);
  const inDatamine = statdesc ? statdesc.findStatIdByPattern(n) !== null : false;
  const inSnapshot = snapTexts.has(n);
  if (inDatamine) verify.datamine++;
  else if (inSnapshot) verify.snapshot++;
  else verify.unknown.push(`${id} :: ${tpl}`);
  // жёсткий сигнал: в снапшоте этот trade id есть, но текст ДРУГОЙ —
  // вероятно, неверная пара id↔мод в исходном вкладе
  const snapPair = snapById.get(id);
  if (snapPair !== undefined && snapPair !== n) {
    verify.conflicts.push(`${id}: вклад "${tpl}" ≠ каталог "${snapPair}"`);
  }
}

console.log(`\nЭталонная сверка предложенных шаблонов (${proposed.size}):`);
console.log(`  ✓ подтверждены датамайном (stat_descriptions): ${verify.datamine}`);
console.log(`  ✓ подтверждены снапшотом каталога trade2:       ${verify.snapshot}`);
if (verify.unknown.length) {
  console.log(`  ⚠ не найдены ни в одном эталоне: ${verify.unknown.length}`);
  for (const u of verify.unknown.slice(0, 20)) console.log(`      ${u}`);
  if (verify.unknown.length > 20) console.log(`      ... и ещё ${verify.unknown.length - 20}`);
  console.log('    (может быть новый патч — текст ещё не в датамайне; решение за мейнтейнером по git diff)');
}
if (verify.conflicts.length) {
  console.log(`  ✗ КОНФЛИКТ id↔текст (скорее всего ошибка вклада): ${verify.conflicts.length}`);
  for (const c of verify.conflicts.slice(0, 20)) console.log(`      ${c}`);
}

// ── кап items_seen: держим самые частые ──
const keys = Object.keys(itemsSeen.entries);
if (keys.length > MAX_ITEMS_SEEN) {
  keys.sort((a, b) => (itemsSeen.entries[b].count ?? 0) - (itemsSeen.entries[a].count ?? 0));
  for (const k of keys.slice(MAX_ITEMS_SEEN)) delete itemsSeen.entries[k];
}
itemsSeen.leagues = Array.from(leagues).sort();
itemsSeen.updated = new Date().toISOString();
statMap.updated = itemsSeen.updated;

writeFileSync(join(DATA, 'items_seen.json'), JSON.stringify(itemsSeen, null, 2), 'utf8');
writeFileSync(join(DATA, 'stat_text_map.json'), JSON.stringify(statMap, null, 2), 'utf8');

console.log(`\n✓ Форм предметов добавлено: ${shapes}; stat-шаблонов выучено: ${statLearned}, обновлено: ${statUpdated}.`);
console.log(`  items_seen: ${Object.keys(itemsSeen.entries).length} форм · stat_text_map: ${Object.keys(statMap.entries).length} id`);
console.log('\nДальше: проверьте git diff (data/game/learned/*), добавьте в коммит');
console.log('«feat(data): merge community item contributions» и запушьте.');
