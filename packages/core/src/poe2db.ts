/**
 * Сервис poe2db.tw — скрапинг и разбор страниц базы знаний PoE2.
 *
 * Порт `_research/poe2-mcp-server/src/services/poe2db.ts` (копирование
 * разрешено) на наш http.ts (httpText + RateLimiter) и cheerio.
 *
 * poe2db.tw: лимиты недокументированы — консервативно 15 запросов/мин,
 * отдельный лимитер на хост (не общий с API GGG).
 */

import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { httpText } from './http.js';

const ARABIC_TO_ROMAN: Record<string, string> = {
  '1': 'I',
  '2': 'II',
  '3': 'III',
  '4': 'IV',
  '5': 'V',
  '6': 'VI',
  '7': 'VII',
  '8': 'VIII',
  '9': 'IX',
  '10': 'X',
};

/**
 * «Urgent_Totems_2» → «Urgent_Totems_II» (poe2db использует римские цифры).
 * Без завершающей цифры — слаг без изменений.
 */
export function normalizeTrailingArabicToRoman(slug: string): string {
  const match = /^(.+_)(\d+)$/.exec(slug);
  if (!match) return slug;
  const roman = ARABIC_TO_ROMAN[match[2]!];
  return roman ? match[1]! + roman : slug;
}

/** Языки poe2db.tw. */
export type Poe2dbLang =
  | 'us' | 'tw' | 'cn' | 'kr' | 'jp' | 'ru' | 'de' | 'fr' | 'sp' | 'pt' | 'th';

const POE2DB_LANGS = new Set<string>([
  'us', 'tw', 'cn', 'kr', 'jp', 'ru', 'de', 'fr', 'sp', 'pt', 'th',
]);

/** Проверить, что строка — валидный код языка poe2db. */
export function isPoe2dbLang(value: unknown): value is Poe2dbLang {
  return typeof value === 'string' && POE2DB_LANGS.has(value);
}

/** Загрузить HTML-страницу poe2db по термину (имя гема/предмета/клавишевого слова). */
export async function getPoe2dbPage(term: string, lang: Poe2dbLang = 'us'): Promise<string> {
  const slug = term.replace(/\s+/g, '_');
  const normalizedSlug = normalizeTrailingArabicToRoman(slug);
  const url = `https://poe2db.tw/${lang}/${encodeURIComponent(normalizedSlug)}`;
  try {
    return await httpText(url);
  } catch (error) {
    // Если нормализация сработала, а страницы нет — пробуем оригинальный слаг.
    if (normalizedSlug !== slug) {
      const retryUrl = `https://poe2db.tw/${lang}/${encodeURIComponent(slug)}`;
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('HTTP 404')) return httpText(retryUrl);
    }
    throw error;
  }
}

// ─── Разбор секций страницы ───────────────────────────────────────────────

/** Секция страницы poe2db («Recommended Support Gems /29», «Level Effect /40», ...). */
export interface Poe2dbSection {
  id: string;
  header: string;
  content: string;
  /** Число из заголовка «/40» — сколько записей в секции. */
  itemCount: number | null;
}

/** Разобранная страница poe2db. */
export interface Poe2dbParsedPage {
  title: string;
  description: string;
  stats: string;
  sections: Map<string, Poe2dbSection>;
}

/** Фильтры секций для вывода. */
export type Poe2dbSectionFilter =
  | 'description'
  | 'stats'
  | 'supports'
  | 'supports_full'
  | 'acquisition'
  | 'levels'
  | 'history'
  | 'microtransactions'
  | 'monsters';

const DEFAULT_POE2DB_SECTIONS: Poe2dbSectionFilter[] = ['description', 'stats', 'supports', 'acquisition'];

const POE2DB_SECTION_MAP: Record<string, Poe2dbSectionFilter> = {
  'Recommended Support Gems': 'supports',
  'Supported By': 'supports_full',
  From: 'acquisition',
  'Level Effect': 'levels',
  'Version history': 'history',
  Microtransactions: 'microtransactions',
};

function mapSectionName(rawName: string): Poe2dbSectionFilter | null {
  if (rawName in POE2DB_SECTION_MAP) return POE2DB_SECTION_MAP[rawName]!;
  if (rawName.endsWith(' Attr')) return 'stats';
  if (rawName.endsWith(' Monster')) return 'monsters';
  return null;
}

/** Отфильтровать строки уровней (Level Effect) по диапазону level..level. */
function filterLevelRows(content: string, levelRange: { min: number; max: number }): string {
  const lines = content.split(/\n/);
  const filtered: string[] = [];
  let headerLine = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const columns = trimmed.split(/\t/);
    const firstCol = columns[0]?.trim() ?? '';
    if (firstCol.toLowerCase() === 'level' || firstCol.toLowerCase().startsWith('levelrequires')) {
      headerLine = trimmed;
      continue;
    }
    const levelMatch = /^(\d+)/.exec(firstCol);
    if (levelMatch) {
      const level = parseInt(levelMatch[1]!, 10);
      if (level >= levelRange.min && level <= levelRange.max) filtered.push(trimmed);
    }
  }
  if (filtered.length === 0) return `Level ${levelRange.min} data not found`;
  if (headerLine) return headerLine + '\n' + filtered.join('\n');
  return filtered.join('\n');
}

/** Табличный (через tab) текст → markdown-таблица. */
function formatTableContent(content: string): string {
  const lines = content.split(/\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return content;
  if (!lines.some((l) => l.includes('\t'))) return content;
  const rows = lines.map((line) => line.split('\t').map((cell) => cell.trim()));
  if (rows.length === 0) return content;
  const output: string[] = [];
  const header = rows[0];
  output.push('| ' + header.join(' | ') + ' |');
  output.push('| ' + header.map(() => '---').join(' | ') + ' |');
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    while (row.length < header.length) row.push('');
    output.push('| ' + row.join(' | ') + ' |');
  }
  return output.join('\n');
}

// ─── Хелперы разбора HTML ─────────────────────────────────────────────────

function cleanHtmlNoise($: cheerio.CheerioAPI): void {
  $('script, style, nav, footer, header, noscript, .ad-container, #consent-box').remove();
}

function extractTitle($: cheerio.CheerioAPI): string {
  const ogTitle = $('meta[property="og:title"]').attr('content');
  if (ogTitle) return ogTitle;
  const h1Title = $('h1').first().text().trim();
  if (h1Title) return h1Title;
  const pageTitle = $('title').text().split('-')[0]?.trim();
  return pageTitle || 'Unknown';
}

function extractDescription($: cheerio.CheerioAPI): string {
  const ogDescription = $('meta[property="og:description"]').attr('content') ?? '';
  const flavorText = $('.gemPopup .secDescrText, .item-popup--poe2 .secDescrText').first().text().trim();
  const description = ogDescription || flavorText || '';
  if (description.includes('_') && !description.includes(' ')) return '';
  return description;
}

/** Похоже ли на внутренний id мода (например «damage_+%»). */
function isModId(text: string): boolean {
  return text.includes('_') && !text.includes(' ');
}

function extractStats($: cheerio.CheerioAPI): string {
  const stats: string[] = [];
  let popup = $('.gemPopup').first();
  if (popup.find('.property, .explicitMod').length === 0) {
    popup = $('.item-popup--poe2').first();
  }
  if (popup.find('.property, .explicitMod').length === 0) {
    popup = $('.Stats').first();
  }
  popup.find('.property, .explicitMod, .implicitMod, .requirements').each((_, el) => {
    const text = $(el).text().trim();
    if (text && !text.includes('Edit') && text.length < 200 && !isModId(text)) {
      stats.push(text);
    }
  });
  return stats.join('\n');
}

function parseTableRows($: cheerio.CheerioAPI, table: cheerio.Cheerio<Element>): string {
  const rows: string[] = [];
  table.find('tr').each((_, tr) => {
    const cells: string[] = [];
    $(tr).find('td, th').each((_, cell) => {
      const $cell = $(cell);
      const anchors = $cell.find('a');
      if (anchors.length > 1) {
        const anchorTexts: string[] = [];
        anchors.each((_, a) => {
          const text = $(a).text().trim();
          if (text) anchorTexts.push(text);
        });
        cells.push(anchorTexts.join(', '));
      } else {
        const cellText = $cell.text().trim();
        if (cellText) cells.push(cellText);
      }
    });
    if (cells.length > 0) rows.push(cells.join('\t'));
  });
  return rows.join('\n');
}

function parseSupportedByRow($: cheerio.CheerioAPI, row: cheerio.Cheerio<Element>): string {
  const gemEntries: string[] = [];
  row.find('.col').each((_, col) => {
    const anchors = $(col).find('a');
    let gemName = '';
    const tags: string[] = [];
    anchors.each((_, a) => {
      const text = $(a).text().trim();
      if (!text || text.length < 2 || text.includes('Reset')) return;
      if (!gemName) gemName = text;
      else tags.push(text);
    });
    if (gemName) gemEntries.push(tags.length > 0 ? `${gemName} (${tags.join(', ')})` : gemName);
  });
  return gemEntries.join(' | ');
}

function extractSectionContent(
  $: cheerio.CheerioAPI,
  headerEl: cheerio.Cheerio<Element>,
  isSupportsSection: boolean,
): string {
  let current = headerEl.next();
  let attempts = 0;
  while (current.length && attempts < 5) {
    if (current.hasClass('card-body') && !isSupportsSection) {
      return current.text().trim();
    }
    if (current.hasClass('row') && isSupportsSection) {
      const content = parseSupportedByRow($, current);
      if (content) return content;
    }
    if (current.hasClass('table-responsive')) return parseTableRows($, current);
    if (current.is('table')) return parseTableRows($, current);
    if (current.hasClass('card-header')) break;
    current = current.next();
    attempts++;
  }
  return headerEl.parent().find('.card-body').first().text().trim();
}

/** Разобрать HTML poe2db в структуру (заголовок, описание, статы, секции). */
export function parsePoe2dbHtml(html: string): Poe2dbParsedPage {
  const $ = cheerio.load(html);
  cleanHtmlNoise($);
  const title = extractTitle($);
  const description = extractDescription($);
  const sections = new Map<string, Poe2dbSection>();
  let stats = extractStats($);

  $('.card-header').each((_, el) => {
    const headerText = $(el).text().trim();
    if (!headerText || headerText.length < 2) return;
    const match = /^(.+?)\s*\/(\d+)\s*$/.exec(headerText);
    const rawName = match?.[1]?.trim() ?? headerText;
    const itemCount = match?.[2] ? parseInt(match[2], 10) : null;
    const isSupportsSection = rawName === 'Supported By';
    const content = extractSectionContent($, $(el), isSupportsSection);
    const filterKey = mapSectionName(rawName);
    if (filterKey) {
      sections.set(filterKey, { id: rawName, header: headerText, content, itemCount });
      if (filterKey === 'stats' && !stats) stats = content;
    }
  });

  return { title, description, stats, sections };
}

/** Отфильтровать и отформатировать секции в markdown. */
export function formatPoe2dbSections(
  page: Poe2dbParsedPage,
  term: string,
  lang: Poe2dbLang,
  sections?: Poe2dbSectionFilter[],
  levelRange?: { min: number; max: number },
): string {
  const filters = sections ?? DEFAULT_POE2DB_SECTIONS;
  const url = `https://poe2db.tw/${lang}/${encodeURIComponent(term.replace(/\s+/g, '_'))}`;
  const output: string[] = [`## poe2db: ${page.title} (${lang})`, `🔗 ${url}`, ''];

  if (filters.includes('description') && page.description) output.push(page.description, '');
  if (filters.includes('stats') && page.stats) output.push('### Stats', page.stats, '');

  if (filters.includes('acquisition')) {
    const section = page.sections.get('acquisition');
    if (section) output.push(`### ${section.id}`, section.content, '');
  }

  if (filters.includes('supports')) {
    const section = page.sections.get('supports');
    if (section) output.push('### Recommended Support Gems', formatTableContent(section.content), '');
  }

  if (filters.includes('supports_full')) {
    const section = page.sections.get('supports_full');
    if (section) {
      const gems = section.content.split(' | ');
      const count = gems.length;
      if (count > 50) {
        output.push(
          `### Supported By (${count} gems)`,
          `⚠️ Large list (${count} entries). Showing first 50.`,
          gems.slice(0, 50).join(' | '),
          '',
        );
      } else {
        output.push('### Supported By', section.content, '');
      }
    }
  }

  if (filters.includes('levels')) {
    const section = page.sections.get('levels');
    if (section) {
      const range = levelRange ?? { min: 1, max: 1 };
      const filtered = filterLevelRows(section.content, range);
      const header = range.min === range.max ? `### Level ${range.min} Stats` : `### Levels ${range.min}-${range.max}`;
      output.push(header, filtered, '');
    }
  }

  if (filters.includes('history')) {
    const section = page.sections.get('history');
    if (section) output.push('### Version History', section.content, '');
  }

  if (filters.includes('microtransactions')) {
    const section = page.sections.get('microtransactions');
    if (section) output.push('### Microtransactions', section.content, '');
  }

  if (filters.includes('monsters')) {
    const section = page.sections.get('monsters');
    if (section) output.push('### Monsters Using This', section.content, '');
  }

  return output.join('\n').trim();
}

// ─── Перевод базовых предметов (локализация → английский слаг) ─────────────

/**
 * Словари локализации со страницы класса предметов poe2db:
 *  - bases: локализованное имя базового типа → английское имя (слаг → пробелы);
 *  - uniques: локализованное имя уника → английское имя уника.
 */
export interface Poe2dbClassTranslations {
  bases: Map<string, string>;
  uniques: Map<string, string>;
}

/**
 * Загрузить словари «локализация → английский» со страницы класса предметов
 * poe2db (структура: уники — `a.UniqueItem` c `.uniqueName`, базы — `a.whiteitem`).
 * При ошибке сети возвращает пустые мапы (тихо, без throw).
 */
export async function fetchClassTranslations(
  itemClassSlug: string,
  lang: Poe2dbLang = 'ru',
): Promise<Poe2dbClassTranslations> {
  const bases = new Map<string, string>();
  const uniques = new Map<string, string>();
  const put = (map: Map<string, string>, text: string, slug: string): void => {
    const en = slug.replace(/_/g, ' ').trim();
    const key = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (key && en && key.length < 120) map.set(key, en);
  };
  try {
    const html = await getPoe2dbPage(itemClassSlug, lang);
    const $ = cheerio.load(html);
    // Уники: <a class="UniqueItem" href="/ru/Doedres_Damning"><span class="uniqueName">…</span> …
    $('a.UniqueItem').each((_, el) => {
      const m = ($(el).attr('href') ?? '').match(/([A-Za-z][A-Za-z0-9_]+)$/);
      const name = m ? $(el).find('.uniqueName').first().text().trim() : '';
      if (name) put(uniques, name, m![1]!);
    });
    // Базовые типы: <a class="whiteitem Ring" href="Iron_Ring">Железное кольцо</a>
    $('a.whiteitem').each((_, el) => {
      const m = ($(el).attr('href') ?? '').match(/([A-Za-z][A-Za-z0-9_]+)$/);
      const text = m ? $(el).text().replace(/\s+/g, ' ').trim() : '';
      if (text) put(bases, text, m![1]!);
    });
  } catch {
    // Тихо: словарь просто останется пустым, сопоставление уйдёт в точный матч.
  }
  return { bases, uniques };
}

const baseTypeCache = new Map<string, Map<string, string>>();

/** Собрать мапу «локализованное имя базового типа → английский слаг» со страницы класса предметов. */
async function fetchBaseTypeTranslations(
  itemClassSlug: string,
  lang: Poe2dbLang,
): Promise<Map<string, string>> {
  const cacheKey = `${lang}:${itemClassSlug}`;
  const cached = baseTypeCache.get(cacheKey);
  if (cached) return cached;

  const map = new Map<string, string>();
  try {
    const html = await getPoe2dbPage(itemClassSlug, lang);
    const $ = cheerio.load(html);
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (!href || !text) return;
      const slugMatch = href.match(/^(?:\/[a-z]{2}\/)?([A-Za-z][A-Za-z0-9_]+)$/);
      if (!slugMatch) return;
      const slug = slugMatch[1]!;
      if (
        slug === itemClassSlug ||
        slug.length < 3 ||
        /^(Items|Unique|Gem|Skill|Support|Spirit|Modifier|Keyword|Craft|Quest|Ascend|passive|Act|Waystone|Endgame|Reforging|Desecrated|Lineage|Liquid|Resistances|Spells|patreon|Reset)/.test(
          slug,
        )
      ) {
        return;
      }
      if (text.length >= 2 && text.length < 100 && !text.includes('\n')) {
        map.set(text.toLowerCase(), slug);
      }
    });
  } catch {
    // Тихо: enrichment продолжится без перевода
  }
  baseTypeCache.set(cacheKey, map);
  return map;
}

/** Локализованное имя базового типа → английский слаг poe2db. */
export async function resolveEnglishBaseType(
  localizedName: string,
  itemClassSlug: string,
  lang: Poe2dbLang,
): Promise<string | null> {
  if (lang === 'us') return localizedName.replace(/\s+/g, '_');
  const translations = await fetchBaseTypeTranslations(itemClassSlug, lang);
  return translations.get(localizedName.toLowerCase()) ?? null;
}

/** Полный цикл: страница poe2db по термину → markdown. null, если страница не найдена. */
export async function lookupPoe2db(
  term: string,
  opts: { lang?: Poe2dbLang; sections?: Poe2dbSectionFilter[]; levelRange?: { min: number; max: number } } = {},
): Promise<string | null> {
  const lang = opts.lang ?? 'us';
  try {
    const html = await getPoe2dbPage(term, lang);
    const page = parsePoe2dbHtml(html);
    if (page.title === 'Unknown' && !page.description && page.stats === '' && page.sections.size === 0) {
      return null;
    }
    const formatted = formatPoe2dbSections(page, term, lang, opts.sections, opts.levelRange);
    return formatted === '' ? null : formatted;
  } catch {
    return null;
  }
}


