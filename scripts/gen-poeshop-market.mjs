/**
 * Генератор датасета рыночных цен poeshop.ru (волна poeshop-интеграции).
 *
 * Данные poeshop: витрина услуг продажи гира/валюты (RMT). Цены divine/exalt/chaos —
 * рыночный агрегат по лигам, rub — цена витрины (НЕ рыночная стоимость гира).
 *
 * Пайплайн (offline-first):
 *   1. Вход: сырой снапшот скрапа `categories.<sub>.collected[]` (см. флаг --input;
 *      по умолчанию свежий снапшот в %TEMP%\opencode\poeshop_market_raw.json).
 *      Флаг --scrape: сначала дергаем сайт сами (curl --ssl-no-revoke, обход DPI).
 *   2. Компактификация: уютный JSON в packages/core/data/game/market/poeshop_market.json —
 *      ключ = norm(nameEn) полного имени; имя уника и база расщепляются по каталогу
 *      uniques_catalog.json (Kit, 433 записи); sparkline выкидываем, rub округляем,
 *      fetchedAt → дата-код YYYY-MM-DD.
 *
 * Запуск: node scripts/gen-poeshop-market.mjs [--input <raw.json>] [--scrape] [--out <path>]
 */

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULTRaw =
  process.env.POESHOP_RAW_SNAPSHOT ??
  path.join(process.env.TEMP ?? process.env.tmpdir ?? '.', 'opencode', 'poeshop_market_raw.json');
const OUT_DEFAULT = path.join(ROOT, 'packages', 'core', 'data', 'game', 'market', 'poeshop_market.json');
const CATALOG_PATH = path.join(ROOT, 'packages', 'core', 'data', 'game', 'uniques', 'uniques_catalog.json');

// --- CLI -------------------------------------------------------------------
const argv = process.argv.slice(2);
function argFlag(name) {
  return argv.includes(name);
}
function argVal(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
}
const RAW_PATH = argVal('--input', DEFAULTRaw);
const OUT_PATH = argVal('--out', OUT_DEFAULT);
const DO_SCRAPE = argFlag('--scrape');

// --- нормализация имён (совместима с uniques.ts: lowercase/trim) ------------
function norm(s) {
  return (s ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

function dateCode(iso) {
  return typeof iso === 'string' ? iso.slice(0, 10) : null;
}

// --- скрап(poeshop.ru, Next.js flight-чанки) ---------------------------------
async function httpGet(url) {
  // node-fetch периодически флейкает «fetch failed» из-за DPI — curl-фолбэк (урок №202).
  try {
    const r = await fetch(url, {signal: AbortSignal.timeout(30000)});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch {
    return execFileSync('curl.exe', ['--ssl-no-revoke', '-sS', '--max-time', '60', url], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  }
}

function parseCardFromFlight(chunk) {
  // Карточки лежат в self.__next_f.push(...) чанках: {"item":{...},"pricesByLeague":{...}}
  const out = [];
  const re = /\{"item":\{.*?\},"pricesByLeague":\{.*?\}(?:," Повтор|)\}/g;
  let m;
  while ((m = re.exec(chunk))) {
    try {
      out.push(JSON.parse(m[0]));
    } catch {
      /* не-JSON обрывки игнорируем */
    }
  }
  return out;
}

async function scrapeRaw() {
  const CATEGORIES = [
    'unique-charms',
    'unique-weapons',
    'unique-armours',
    'unique-accessories',
    'unique-flasks',
    'unique-jewels',
    'unique-maps',
    'currency',
    'runes',
    'essences',
  ];
  const categories = {};
  for (const cat of CATEGORIES) {
    const collected = [];
    for (let page = 1; page <= 50; page++) {
      const url = `https://poeshop.ru/catalogue/${cat}?page=${page}`;
      const html = await httpGet(url);
      const cards = parseCardFromFlight(html);
      if (!cards.length) break;
      for (const c of cards) {
        const item = c.item ?? {};
        if (!item || !item.id) continue;
        collected.push({
          itemId: `${cat}:${item.id}`,
          nameEn: item.nameEn ?? null,
          nameRu: item.nameRu ?? null,
          category: item.category ?? null,
          subcategory: cat,
          baseType: item.metaJson?.baseType ?? null,
          baseTypeRu: item.metaJson?.baseTypeRu ?? null,
          listingCount: item.metaJson?.listingCount ?? null,
          prices: c.pricesByLeague ?? null,
        });
      }
      await new Promise((r) => setTimeout(r, 900));
    }
    categories[cat] = {total: collected.length, collected};
    console.error(`[scrape] ${cat}: ${collected.length}`);
  }
  return {_source: 'poeshop.ru', _scrapedAt: new Date().toISOString(), categories};
}

// --- подготовка каталога уников для расщепления «Имя База» -------------------
function loadCatalogIndex() {
  const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const byName = new Map(); // norm(uniqueName) -> entry
  for (const [key, e] of Object.entries(raw.uniques ?? {})) {
    if (e?.name) byName.set(norm(e.name), e);
  }
  return {byName, total: byName.size};
}

/**
 * Расщепить nameEn («Temporalis Silk Robe») на {name, base} по каталогу кита.
 * Порядок: exact-имя → префикс имени + остаток = база → остаток сам по себе.
 */
function splitName(nameEn, baseType, catalog) {
  const full = (nameEn ?? '').toString();
  const exact = catalog.byName.get(norm(full));
  if (exact) return {name: exact.name, base: exact.baseType};
  // Префиксное имя: ищем каталоговое имя, которым начинается nameEn.
  let best = null;
  for (const [nkey, e] of catalog.byName) {
    if (full.length > nkey.length + 1 && norm(full).startsWith(nkey + ' ')) {
      if (!best || nkey.length > norm(best.name).length) best = e;
    }
  }
  if (best) {
    const base = full.slice(best.name.length).trim();
    return {name: best.name, base: base || best.baseType};
  }
  // Фолбэк: baseType из metaJson уже может быть базой, а nameEn — полным именем.
  return {name: full, base: baseType ?? null};
}

// --- компактификация --------------------------------------------------------
const LEAGUE_TITLES = {
  standard: 'Standard',
  hardcore: 'Hardcore',
  'new-league': 'Runes of Aldur (new-league)',
  'hardcore-new-league': 'HC Runes of Aldur (hardcore-new-league)',
  'forbidden-rites': 'Forbidden Rites',
  'hardcore-forbidden-rites': 'HC Forbidden Rites',
  // legacy-коды встречаются в старых срезах — сохраняем как есть, если появятся
};

function compactLeague(prices) {
  if (!prices) return null;
  const out = {};
  for (const [lg, p] of Object.entries(prices)) {
    if (!p) continue;
    // Два формата: сырой сайт (priceDivine/sparkline.totalChange) и
    // нормализованный снапшот-скрапер (divine/change).
    const dv = p.priceDivine ?? p.divine;
    const ex = p.priceExalt ?? p.exalt;
    const ch = p.priceChaos ?? p.chaos;
    const rb = p.priceRub ?? p.rub;
    const chg = p.sparkline?.totalChange ?? p.change;
    const rec = {};
    if (typeof dv === 'number') rec.divine = round(dv, 2);
    if (typeof ex === 'number') rec.exalt = round(ex, 0);
    if (typeof ch === 'number') rec.chaos = round(ch, 1);
    if (typeof rb === 'number') rec.rub = round(rb, 0);
    if (typeof chg === 'number') rec.change7d = round(chg, 2);
    if (p.fetchedAt) rec.fetchedAt = dateCode(p.fetchedAt);
    if (Object.keys(rec).length) out[lg] = rec;
  }
  return Object.keys(out).length ? out : null;
}

function round(v, digits) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

async function main() {
  let raw;
  if (DO_SCRAPE) {
    console.error('[gen] скрап poeshop.ru...');
    raw = await scrapeRaw();
    fs.writeFileSync(RAW_PATH, JSON.stringify(raw));
    console.error(`[gen] сырой снапшот сохранён: ${RAW_PATH}`);
  } else {
    raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
  }

  const catalog = loadCatalogIndex();
  const items = {};
  const ruIndex = {}; // norm(nameRu) -> key
  const aliasIndex = {}; // norm(канонич. имя уника) -> [keys] (варианты баз Runeforged и т.п.)
  let withPrices = 0;
  let unmatched = 0;

  for (const [cat, catData] of Object.entries(raw.categories ?? {})) {
    const collected = catData.collected ?? [];
    // collected бывает и массивом, и объектом-словарём
    const records = Array.isArray(collected) ? collected : Object.values(collected);
    for (const rec of records) {
      if (!rec?.nameEn) continue;
      const leagues = compactLeague(rec.prices);
      if (!leagues) continue; // карточки без блока цен для датасета бесполезны
      const {name, base} = splitName(rec.nameEn, rec.baseType, catalog);
      if (base === null && cat.startsWith('unique')) unmatched++;
      const key = norm(rec.nameEn);
      if (items[key]) {
        // дубль между категориями — мержим цены по лигам
        Object.assign(items[key].leagues, leagues);
        continue;
      }
      withPrices++;
      items[key] = {
        en: rec.nameEn,
        ru: rec.nameRu ?? null,
        name,
        base,
        sub: rec.subcategory ?? cat,
        leagues,
      };
      if (rec.nameRu) ruIndex[norm(rec.nameRu)] = key;
      const akey = norm(name);
      if (akey !== key) (aliasIndex[akey] ??= []).push(key);
    }
  }

  const meta = {
    provenance: `poeshop.ru (витрина услуг, RMT), scrape ${dateCode(raw._scrapedAt) ?? 'unknown'}`,
    generatedAt: new Date().toISOString().slice(0, 10),
    caveats: [
      'divine/exalt/chaos — рыночный агрегат poeshop по лигам; rub — цена витрины услуг (НЕ рыночная стоимость гира).',
      'У дешёвых предметов rub имеет floor ≈50₽ (мин. цена витрины) — не трактовать как стоимость.',
      'Срез Standard по данным сайта устаревает сильнее текущих лиг — см. fetchedAt каждой лиги.',
      'Источник без открытой лицензии: только внутреннее использование в poe2-kit (offline assistant).',
    ],
    leagueTitles: LEAGUE_TITLES,
    counts: {
      itemsWithPrices: withPrices,
      uniqueCatalogSize: catalog.total,
      namesUnmatchedToKitCatalog: unmatched,
      ruNames: Object.keys(ruIndex).length,
    },
  };

  const dataset = {_meta: meta, items, ruIndex, aliasIndex};
  fs.mkdirSync(path.dirname(OUT_PATH), {recursive: true});
  fs.writeFileSync(OUT_PATH, JSON.stringify(dataset));
  const sizeKb = Math.round(fs.statSync(OUT_PATH).size / 1024);
  console.error(`[gen] ${withPrices} записей с ценами → ${OUT_PATH} (${sizeKb} KB)`);
  console.error(`[gen] RU-имён: ${meta.counts.ruNames}; не смэтчено с каталогом: ${unmatched}`);
}

main().catch((e) => {
  console.error('[gen] FAIL:', e);
  process.exit(1);
});
