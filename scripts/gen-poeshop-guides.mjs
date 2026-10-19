/**
 * Генератор датасета билд-гайдов poeshop.ru/blog?game=poe2 (волна poeshop-гайдов).
 *
 * Что собираем (фактура, НЕ прозаические тексты — копирайт poeshop не трогаем):
 *   - индекс листинга: все страницы /blog?game=poe2&page=N → {slug, title, class, asc, date, readMin, cover}
 *   - тир-лист S/A/B/C со страницы 1 (видимые ссылки секций тир-листа)
 *   - каждая статья (raw HTML, серверный рендер): связки скиллов с уровнями/качеством
 *     (gear-card блоки: категория, main-гем, гемы+уровни), уники из ttip_items-ссылок
 *
 * Пайплайн:
 *   1. Fetch listing pages (до пустой страницы, максимум ~40)
 *   2. Fetch каждой статьи (30 страниц за проход по умолчанию НЕ ограничено;
 *      --limit N для отладки; resume: уже собранные статьи пропускаются)
 *   3. Компактный JSON в packages/core/data/game/guides/poeshop_guides.json
 *
 * Запуск: node scripts/gen-poeshop-guides.mjs [--limit N] [--only listing|articles] [--out <path>]
 * Вежливость: задержка 350 мс между запросами, UA-заголовок, retry + curl-фолбэк (урок №202).
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DEFAULT = path.join(ROOT, 'packages', 'core', 'data', 'game', 'guides', 'poeshop_guides.json');
const BASE = 'https://poeshop.ru';
const DELAY_MS = 350;
const MAX_PAGES = 40;

const argv = process.argv.slice(2);
function argFlag(name) { return argv.includes(name); }
function argVal(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
}
const LIMIT = Number(argVal('--limit', '0')) || 0;
const ONLY = argVal('--only', 'all');
const OUT_PATH = argVal('--out', OUT_DEFAULT);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function httpGet(url) {
  try {
    const r = await fetch(url, {
      headers: {'user-agent': 'poe2-kit-guides-bot/1.0 (dataset research)'},
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch (e) {
    // curl-фолбэк: DPI-сети душат node:https (урок №202)
    try {
      return execFileSync('curl', ['--ssl-no-revoke', '-sS', '--max-time', '30', '-A',
        'poe2-kit-guides-bot/1.0 (dataset research)', url], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
    } catch {
      throw e;
    }
  }
}

async function httpGetRetry(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await httpGet(url); }
    catch (e) { lastErr = e; await sleep(1500 * (i + 1)); }
  }
  throw lastErr;
}

// --- парсеры ----------------------------------------------------------------

function decodeEntities(s) {
  return s
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»');
}

/** Карточки статей на листинге (реальная структура страницы, проверено по HTML 19.10.2026):
 *  <a href="/blog/SLUG" ...> ... /uploads/poe2-classes/<class>_<asc>.webp ... <span class="truncate">Асценданси</span>
 *  ... />DD месяц YYYY г.</span> ... NR<!-- --> мин чтения ... <h3 ...>TITLE</h3> */
function parseListing(html) {
  const cards = [];
  const linkRe = /href="(\/blog\/[a-z0-9-]+)"/g;
  const marks = [];
  let m;
  while ((m = linkRe.exec(html)) !== null) marks.push({url: m[1], idx: m.index});
  const seen = new Set();
  for (let i = 0; i < marks.length; i++) {
    const slug = marks[i].url.replace('/blog/', '');
    if (seen.has(slug) || marks[i].url.startsWith('/blog/page-')) continue;
    const from = marks[i].idx;
    const to = i + 1 < marks.length ? marks[i + 1].idx : Math.min(from + 12000, html.length);
    const seg = html.slice(from, to);
    const clsM = seg.match(/\/uploads\/poe2-classes\/(\w+)_(\w+)\.webp/);
    const ruM = seg.match(/<span class="truncate">([^<]+)<\/span>/);
    const dateM = seg.match(/>(\d{1,2}\s+[а-я]+\s+\d{4})\s+г\./);
    const readM = seg.match(/(\d+)<!--\s*-->\s*мин чтения/);
    const h3m = seg.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    const coverM = seg.match(/<img[^>]*src="(\/uploads\/blog\/[^"]+)"/);
    const title = h3m ? decodeEntities(h3m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : null;
    if (!title) continue;
    seen.add(slug);
    cards.push({
      slug,
      cover: coverM ? BASE + coverM[1] : null,
      class_en: clsM ? clsM[1] : null,
      asc_file: clsM ? clsM[2] : null,
      asc_ru: clsM && ruM ? decodeEntities(ruM[1]).trim() : null, // чип карточки = асценданси
      date_ru: dateM ? dateM[1] : null,
      read_min: readM ? Number(readM[1]) : null,
      title,
    });
  }
  return cards;
}

/** Тир-лист со страницы 1: секции с title="Обязателен — ..." (S) / "Отличный выбор..." (A) /
 *  "Рабочий..." (B) / "Нишевый..." (C); в каждой — ссылки /blog/<slug>.
 *  Маркеры дублируются (моб/десктоп) — первый тир приоритетнее. */
function parseTierList(html) {
  const tiers = {};
  const labels = [
    ['S', /title="Обязателен[^"]*"/g],
    ['A', /title="Отличный выбор[^"]*"/g],
    ['B', /title="Рабочий[^"]*"/g],
    ['C', /title="Нишевый[^"]*"/g],
  ];
  const marks = [];
  for (const [t, re] of labels) {
    let m;
    while ((m = re.exec(html)) !== null) marks.push({tier: t, idx: m.index});
  }
  marks.sort((a, b) => a.idx - b.idx);
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].idx;
    const to = i + 1 < marks.length ? marks[i + 1].idx : Math.min(from + 60000, html.length);
    const seg = html.slice(from, to);
    const linkRe = /href="\/blog\/([a-z0-9-]+)"/g;
    let l;
    while ((l = linkRe.exec(seg)) !== null) {
      if (!tiers[l[1]]) tiers[l[1]] = marks[i].tier;
    }
  }
  return tiers;
}

/** Статья: метаданные + gear-card связки. Возвращает null, если разбор не удался. */
function parseArticle(slug, html) {
  if (!html || html.length < 5000) return null;
  const titleM = html.match(/<title>(.*?)\s*\|\s*POESHOP<\/title>/);
  if (!titleM) return null;
  const title = decodeEntities(titleM[1]).trim();
  const clsM = html.match(/game=poe2&(?:amp;)?class=(\w+)/);
  const ascM = html.match(/class=\w+&(?:amp;)?asc=(\w+)/);
  const dateM = html.match(/"article:published_time" content="([^"]+)"/);
  const readM = html.match(/(\d+)\s*мин чтения/);

  // gear-card блоки: категория, main-гем (первый ttip_title внутри <strong>), гемы+уровни
  const skills = [];
  const parts = html.split('<div class="gear-card">').slice(1);
  for (const raw of parts) {
    const block = raw.slice(0, raw.indexOf('</div><div class="gear-card">') >= 0 ? raw.indexOf('</div><div class="gear-card">') : Math.min(raw.length, 20000));
    // категория: текст h3
    const h3m = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    let category = h3m ? decodeEntities(h3m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : '';
    // main-гем: первый ttip_title в блоке (он внутри <strong>)
    const firstGem = block.match(/<strong>[\s\S]{0,200}?ttip_title">([\s\S]*?)<\/span>/);
    const mainGem = firstGem ? decodeEntities(firstGem[1]).trim() : null;
    // цвет main-гема: ttip_red/blue/green
    const colM = firstGem && firstGem[0].match(/ttip_(red|blue|green)/);
    const mainColor = colM ? colM[1] : null;
    // уровни: блок gem-levels → плоский текст: "Уровни: NAME — ур. 20, кач. 23%; NAME — ур. 1."
    const lvBlock = block.match(/class="blog-gem-levels"[\s\S]*?<\/p>/);
    const gems = [];
    if (lvBlock) {
      const flat = lvBlock[0]
        .replace(/<!--.*?-->/g, '')
        .replace(/<span class="blog-gem-levels-label">[\s\S]*?<\/span>/, '')
        .replace(/<span class="blog-item-sep">[\s\S]*?<\/span>/g, '\u0001')
        .replace(/<[^>]+>/g, '');
      const gemRe = /([\S][^\u0001—]*?)\s*—\s*ур\.\s*(\d+)(?:,\s*кач\.\s*(\d+)%)?/g;
      let g;
      while ((g = gemRe.exec(decodeEntities(flat))) !== null) {
        const name = g[1].replace(/^[\s\u0001.]+|[\s.;]+$/g, '')
          .replace(/^[\s\S]*?blog-gem-levels[^>]*>\s*/, '') // остатки label-спана
          .trim();
        if (!name || name.includes('"') || name.includes('<')) continue;
        gems.push({name, level: Number(g[2]), quality: g[3] ? Number(g[3]) : null});
      }
    }
    if (!category && !mainGem && gems.length === 0) continue;
    skills.push({category: category || null, main: mainGem, color: mainColor, gems});
  }

  // уники: ttip_items-ссылки на каталог
  const uniques = [];
  const useen = new Set();
  const uRe = /ttip_items[^>]*href="(\/catalog\/[a-z0-9-\/]+)"[\s\S]{0,300}?ttip_title">([\s\S]*?)<\/span>/g;
  let u;
  while ((u = uRe.exec(html)) !== null) {
    const name = decodeEntities(u[2].replace(/<[^>]+>/g, '')).trim();
    if (!name || useen.has(name)) continue;
    useen.add(name);
    uniques.push({name, slug: u[1].split('/').pop()});
  }

  return {
    slug,
    url: `${BASE}/blog/${slug}`,
    title,
    class_en: clsM ? clsM[1] : null,
    asc_en: ascM ? ascM[1] : null,
    date: dateM ? dateM[1].slice(0, 10) : null,
    read_min: readM ? Number(readM[1]) : null,
    skills,
    uniques,
  };
}

// --- пайплайн ----------------------------------------------------------------

const startedAt = Date.now();
const scrapedAt = new Date().toISOString().slice(0, 10);

// resume: читаем прошлый датасет
let prev = null;
if (fs.existsSync(OUT_PATH)) {
  try { prev = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')); } catch { prev = null; }
}
const prevBySlug = new Map((prev?.guides ?? []).map((g) => [g.slug, g]));
const prevTiers = prev?._meta?.tiers ?? {};

console.log(`[poeshop-guides] start; resume=${prevBySlug.size} guides, ${Object.keys(prevTiers).length} tiers`);

// 1) листинг
let listing = [];
let tiers = {...prevTiers};
let failedListing = [];
if (ONLY === 'all' || ONLY === 'listing') {
  for (let p = 1; p <= MAX_PAGES; p++) {
    try {
      const html = await httpGetRetry(`${BASE}/blog?game=poe2${p > 1 ? `&page=${p}` : ''}`);
      const cards = parseListing(html);
      if (p === 1) tiers = {...parseTierList(html), ...prevTiers};
      if (cards.length === 0) { console.log(`[poeshop-guides] page ${p}: 0 cards → конец листинга`); break; }
      listing.push(...cards);
      console.log(`[poeshop-guides] page ${p}: ${cards.length} cards (total ${listing.length})`);
      if (p >= MAX_PAGES) break;
      await sleep(DELAY_MS);
    } catch (e) {
      failedListing.push(p);
      console.log(`[poeshop-guides] page ${p} FAILED: ${e.message}`);
      if (failedListing.length >= 3) break;
      await sleep(2000);
    }
  }
  // дедуп по slug
  const seen = new Map();
  for (const c of listing) if (!seen.has(c.slug)) seen.set(c.slug, c);
  listing = [...seen.values()];
} else {
  listing = [...prevBySlug.values()];
}

console.log(`[poeshop-guides] listing total: ${listing.length}, tiers: ${Object.keys(tiers).length}`);

// 2) статьи
const guides = [];
const failedArticles = [];
if (ONLY !== 'listing') {
  let done = 0;
  for (const card of listing) {
    if (prevBySlug.has(card.slug) && !prevBySlug.get(card.slug).partial) { guides.push(prevBySlug.get(card.slug)); continue; }
    if (LIMIT && done >= LIMIT) { guides.push({...card, skills: [], uniques: [], partial: true}); continue; }
    try {
      const html = await httpGetRetry(`${BASE}/blog/${card.slug}`);
      const art = parseArticle(card.slug, html);
      if (art) {
        guides.push({
          ...art,
          class_en: card.class_en ?? art.class_en ?? null,
          asc_file: card.asc_file ?? null,
          asc_ru: card.asc_ru ?? null,
          date_ru: card.date_ru ?? null,
          read_min: card.read_min ?? art.read_min ?? null,
          cover: card.cover ?? null,
          tier: tiers[card.slug] ?? null,
        });
        done++;
      } else {
        failedArticles.push(card.slug);
      }
    } catch (e) {
      failedArticles.push(card.slug);
      console.log(`[poeshop-guides] article ${card.slug} FAILED: ${e.message}`);
    }
    if (guides.length % 25 === 0) console.log(`[poeshop-guides] articles progress: ${guides.length}/${listing.length}`);
    await sleep(DELAY_MS);
  }
} else {
  guides.push(...listing.map((c) => prevBySlug.get(c.slug) ?? {...c, skills: [], uniques: [], tier: tiers[c.slug] ?? null}));
}

// сортировка: тир, потом дата (новые выше)
const tierRank = {S: 0, A: 1, B: 2, C: 3};
guides.sort((a, b) =>
  (tierRank[a.tier ?? 'z'] - tierRank[b.tier ?? 'z']) ||
  String(b.date ?? '').localeCompare(String(a.date ?? '')) ||
  a.title.localeCompare(b.title));

// 3) датасет
const ds = {
  _meta: {
    source: 'poeshop.ru/blog?game=poe2',
    source_name: 'POESHOP (RU)',
    scraped_at: scrapedAt,
    license_note: 'Фактура билдов (названия, связки скиллов с уровнями, классы, тиры) как данные; прозаические тексты и ассеты poeshop НЕ копируются. Атрибуция — поле url у каждой записи.',
    counts: {guides: guides.length, listing: listing.length, tiers: Object.keys(tiers).length},
    tiers: null,
    failed_articles: failedArticles.length ? failedArticles : null,
    failed_listing_pages: failedListing.length ? failedListing : null,
    built_with: 'scripts/gen-poeshop-guides.mjs',
  },
  guides,
};
ds._meta.tiers_scraped = Object.keys(tiers).length;
fs.mkdirSync(path.dirname(OUT_PATH), {recursive: true});
fs.writeFileSync(OUT_PATH, JSON.stringify(ds, null, 1), 'utf8');
console.log(`[poeshop-guides] written ${OUT_PATH}: ${guides.length} guides, ${failedArticles.length} failed, ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
