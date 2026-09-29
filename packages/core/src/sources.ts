/**
 * Библиотека веб-источников PoE2 Kit (№69).
 *
 * Назначение: ИИ-агент (OpenCode/Claude через MCP) не должен гадать, откуда
 * брать данные. Здесь — курируемый реестр источников:
 *  - что за источник, для чего использовать;
 *  - есть ли специализированный MCP-тул (тогда raw-fetch не нужен);
 *  - можно ли тянуть текст страниц (fetchable) и с какими оговорками.
 *
 * Фетч — только по кураторским URL; произвольные URL запрещены (host-guard:
 * итоговый хост обязан совпадать с базой источника). Троттл и честный UA —
 * из http.ts (единый rate-limit-клиент kit'а).
 */

import { httpText } from './http.js';

export interface WebSource {
  /** Короткий id для MCP (source_id). */
  id: string;
  title: string;
  category: 'wiki' | 'official' | 'api' | 'guide' | 'community';
  /** Хост-базовое происхождение (для host-guard). */
  base: string;
  /** Страница по умолчанию (что вернёт фетч без path). */
  landing: string;
  /** Что искать/читать здесь; когда предпочесть этот источник. */
  useFor: string;
  /** Имя специализированного MCP-тула kit'а — предпочесть его вместо raw-fetch. */
  mcpTool?: string;
  /** Можно ли тянуть страницы как текст (иначе работает только спец-тул/браузер). */
  fetchable: boolean;
  /** Шаблон поиска с {query} (только проверенные MediaWiki-шаблоны). */
  searchTemplate?: string;
  /** Честные оговорки/предостережения (в т.ч. ❓ непроверенное). */
  notes?: string;
}

/** Реестр: менять только с понятным обоснованием — это «лицо» kit'а перед агентом. */
const SOURCES: WebSource[] = [
  {
    id: 'poe2wiki',
    title: 'poe2wiki.net (официальное сообщество-вики)',
    category: 'wiki',
    base: 'https://poe2wiki.net',
    landing: 'https://poe2wiki.net/wiki/Main_Page',
    useFor: 'Механики, камни, уники, боссы, термины — проверка фактов о механике игры.',
    mcpTool: 'poe2_wiki_lookup',
    fetchable: false,
    notes: 'Спец-тул лучше: он ходит в MediaWiki API и отдаёт чистый wikitext.',
  },
  {
    id: 'poe2db',
    title: 'poe2db.tw (база данных)',
    category: 'api',
    base: 'https://poe2db.tw',
    landing: 'https://poe2db.tw',
    useFor: 'Точные числа: моды, базы, уровни камней, таблицы дропа.',
    mcpTool: 'poe2_poe2db_lookup',
    fetchable: false,
  },
  {
    id: 'official-news',
    title: 'pathofexile.com/news (новости и патчноуты GGG)',
    category: 'official',
    base: 'https://www.pathofexile.com',
    landing: 'https://www.pathofexile.com/news',
    useFor: 'Патчноуты, анонсы лиг, изменения механик из первых рук.',
    fetchable: true,
    notes: 'Список анонсов; сам патчноут — по path вида /news/...',
  },
  {
    id: 'official-devdocs',
    title: 'GGG Developer Docs (правила API)',
    category: 'official',
    base: 'https://www.pathofexile.com',
    landing: 'https://www.pathofexile.com/developer/docs',
    useFor: 'Легал-границы публичных API GGG: rate-limits, что можно/нельзя.',
    fetchable: true,
    notes: 'Страница может быть JS-обёрткой вокруг OpenAPI-спеки: если текст пустой — это нормально, СПЕКА НЕ ПРОВЕРЕНА через фетч ❓.',
  },
  {
    id: 'trade2',
    title: 'pathofexile.com/trade2 (официальная торговля PoE2)',
    category: 'official',
    base: 'https://www.pathofexile.com',
    landing: 'https://www.pathofexile.com/trade2',
    useFor: 'Живые цены/листинги.',
    // поиск занимает очередь и троттлится аккуратно
    mcpTool: 'poe2_trade_query / прайс-чек тулы',
    fetchable: false,
    notes: "JS-приложение, raw-fetch бесполезен. Только через API-туры кита (тот же путь, что у Awakened PoE Trade).",
  },
  {
    id: 'poe-ninja',
    title: 'poe.ninja (PoE2 — курсы валют/экзотика)',
    category: 'api',
    base: 'https://poe.ninja',
    landing: 'https://poe.ninja/poe2/',
    useFor: 'Курсы валют, тренды, ladder-снапшоты.',
    mcpTool: 'poe2_currency_* / poe2_ladder_* / poe2_history_*',
    fetchable: false,
    notes: "Лимит 10 запросов/5 мин — только через туры кита с общим троттлом.",
  },
  {
    id: 'poe2scout',
    title: 'poe2scout.com (курацию цен PoE2)',
    category: 'api',
    base: 'https://poe2scout.com',
    landing: 'https://poe2scout.com',
    useFor: 'Актуальные цены уников/exotics, история цен.',
    mcpTool: 'poe2_currency_* / poe2_history_*',
    fetchable: false,
  },
  {
    id: 'maxroll-poe2',
    title: 'maxroll.gg PoE2 (эндгейм-гайды)',
    category: 'guide',
    base: 'https://maxroll.gg',
    landing: 'https://maxroll.gg/poe2',
    useFor: 'Гайды по механикам эндгейма, mapping, билд-принципы, чек-листы.',
    fetchable: true,
  },
  {
    id: 'mobalytics-poe2',
    title: 'Mobalytics PoE2 (билд-гайды)',
    category: 'guide',
    base: 'https://mobalytics.gg',
    landing: 'https://mobalytics.gg/path-of-exile-2',
    useFor: 'Свежие билд-гайды и сравнение архетипов.',
    fetchable: true,
    notes: '⚠ Проверено 29.09.2026: 403 на не-браузерный UA — прямым фетчем недоступен, использовать webfetch агента (браузерного).',
  },
  {
    id: 'fextralife-wiki',
    title: 'pathofexile2.wiki (fextralife)',
    category: 'wiki',
    base: 'https://pathofexile2.wiki',
    landing: 'https://pathofexile2.wiki',
    useFor: 'Быстрый lookup: квесты, NPC, локации, базовая справка.',
    fetchable: true,
    notes: '❌ Проверено 29.09.2026: соединение не устанавливается (connect timeout) — сайт, вероятно, недоступен/закрыт. Если фетч падает — не retry-ть, источник считается мёртвым.',
  },
  {
    id: 'reddit-poe2',
    title: 'r/PathOfExile2 (сообщество)',
    category: 'community',
    base: 'https://old.reddit.com',
    landing: 'https://old.reddit.com/r/pathofexile2/',
    useFor: 'Мета-обсуждения, «что актуально после патча» — как намёки, не как факт.',
    fetchable: true,
    notes: 'Reddit агрессивно 403-ит не-браузерные UA: если текст пустой — пользуйтесь webfetch-агентом, НЕ retry-ьте.',
  },
];

export function listWebSources(): WebSource[] {
  return SOURCES;
}

export function getWebSource(id: string): WebSource | undefined {
  const k = id.trim().toLowerCase();
  return SOURCES.find((s) => s.id === k);
}

export interface FetchWebSourceOptions {
  /** Подстраница источника (должна начинаться с '/', без схемы). */
  path?: string;
  /** Поисковый запрос для источников с searchTemplate. */
  query?: string;
  /** Сколько символов текста вернуть (по умолчанию 4000, максимум 20000). */
  maxChars?: number;
}

export interface FetchedWebPage {
  sourceId: string;
  url: string;
  chars: number;
  text: string;
  /** Честная пометка, если что-то пошло не так (вместо исключения). */
  warning?: string;
}

/** Огрубленный HTML → читабельный текст (для гайдов/новостей, не для API). */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/**
 * Тянуть страницу источника как текст. Только:
 *  - источники с fetchable=true;
 *  - URL = landing / landing+path / searchTemplate+query (host-guard: хост
 *    итогового URL обязан совпадать с базой источника — SSRF/произвольный фетч
 *    невозможны by design).
 */
export async function fetchWebSource(
  id: string,
  opts: FetchWebSourceOptions = {},
): Promise<FetchedWebPage> {
  const src = getWebSource(id);
  if (!src) {
    const ids = SOURCES.map((s) => s.id).join(', ');
    throw new Error(`Источник «${id}» не найден. Доступны: ${ids}`);
  }
  if (!src.fetchable) {
    throw new Error(
      `Источник «${src.id}» не fetchable${src.mcpTool ? ` — используйте спец-тул: ${src.mcpTool}` : ''}.`,
    );
  }
  let url: string;
  if (src.searchTemplate && opts.query) {
    url = src.searchTemplate.replace('{query}', encodeURIComponent(opts.query));
  } else if (opts.path) {
    if (!opts.path.startsWith('/') || /:\/\//.test(opts.path)) {
      throw new Error('path должен начинаться с "/" и не содержать схемы');
    }
    url = `${src.base}${opts.path}`;
  } else {
    url = src.landing;
  }
  // host-guard: источник сам себя ограничивает
  const urlHost = new URL(url).host;
  const baseHost = new URL(src.base).host;
  if (urlHost !== baseHost) {
    throw new Error(`host-guard: ${urlHost} ≠ ${baseHost} — фетч произвольных хостов запрещён`);
  }

  const maxChars = Math.min(Math.max(opts.maxChars ?? 4000, 500), 20_000);
  let text = '';
  let warning: string | undefined;
  try {
    const html = await httpText(url, { timeoutMs: 15_000 });
    text = htmlToText(html).slice(0, maxChars);
  } catch (e) {
    throw new Error(`Фетч ${url} не удался: ${(e as Error).message}`);
  }
  if (!text) warning = 'Пустой текст: возможно JS-обёртка или блокировка не-браузерного UA (см. notes источника).';
  return { sourceId: src.id, url, chars: text.length, text, warning };
}
