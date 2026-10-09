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

/**
 * Классификация происхождения данных источника (№245, Этап 1 «источники
 * + автонововление данных»).
 *  - datamined  — датамайн из файлов игры / агрегация официальных API
 *                 (poe2db, PoB2, RePoE, poe.ninja, poe2scout);
 *  - community  — сообщество: гайды, вики, форумы (обновляется людьми);
 *  - official   — первоисточник GGG (новости, dev-docs, живой trade2 API).
 */
export type SourceKind = 'datamined' | 'community' | 'official';

/** Как данные источника попадают в kit (№245). */
export type SourceUpdate = 'auto' | 'manual';

export interface WebSource {
  /** Короткий id для MCP (source_id). */
  id: string;
  title: string;
  category: 'wiki' | 'official' | 'api' | 'guide' | 'community';
  /** Происхождение данных (№245): datamined / community / official. */
  kind: SourceKind;
  /** auto — скрипты/живой API освежают сами; manual — куратор обновляет руками (№245). */
  update: SourceUpdate;
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
    kind: 'community',
    update: 'manual',
    notes: 'Спец-тул лучше: он ходит в MediaWiki API и отдаёт чистый wikitext.',
  },
  {
    id: 'poe2db',
    title: 'poe2db.tw (база данных)',
    category: 'api',
    kind: 'datamined',
    update: 'auto',
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
    kind: 'official',
    update: 'manual',
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
    kind: 'official',
    update: 'manual',
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
    kind: 'official',
    update: 'auto',
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
    kind: 'datamined', // агрегатор официального trade-API GGG (данные — датамайн, не мнение сообщества)
    update: 'auto',
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
    kind: 'datamined', // API-агрегатор официальных данных GGG (аналогично poe.ninja)
    update: 'auto',
  },
  {
    id: 'maxroll-poe2',
    title: 'maxroll.gg PoE2 (эндгейм-гайды)',
    category: 'guide',
    base: 'https://maxroll.gg',
    landing: 'https://maxroll.gg/poe2',
    useFor: 'Гайды по механикам эндгейма, mapping, билд-принципы, чек-листы.',
    fetchable: true,
    kind: 'community',
    update: 'manual',
  },
  {
    id: 'mobalytics-poe2',
    title: 'Mobalytics PoE2 (билд-гайды)',
    category: 'guide',
    kind: 'community',
    update: 'manual',
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
    kind: 'community',
    update: 'manual',
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
    kind: 'community',
    update: 'manual',
    notes: 'Reddit агрессивно 403-ит не-браузерные UA: если текст пустой — пользуйтесь webfetch-агентом, НЕ retry-ьте.',
  },
  {
    id: 'pob2',
    title: 'Path of Building PoE2 (Lua-датамайн, локальный клон)',
    category: 'api',
    kind: 'datamined',
    update: 'auto', // git pull клона + перегон датасетов (№234/№245)
    base: 'https://github.com',
    landing: 'https://github.com/PathOfBuilding-PoE2/PathOfBuilding',
    useFor: 'Точные игровые данные: WorldAreas.lua, ModMap.lua, Bosses.lua, Gems.lua — фундамент наших датасетов (maps/waystone_mods, build_planner, enemy).',
    fetchable: false,
    notes: 'MIT. В датасетах kit ссылка — git_rev в _meta (например bb52d6b...); локальный клон: _research/path-of-building-poe2. Обновление: git pull + перегон скриптами сборки датасетов.',
  },
  {
    id: 'repoe',
    title: 'RePoE2 (repoe-fork) — экспорт игровых .dat в JSON',
    category: 'api',
    kind: 'datamined',
    update: 'auto', // экспорт обновляется на каждый патч RePoE-комьюнити
    base: 'https://repoe-fork.github.io',
    landing: 'https://repoe-fork.github.io/poe2/',
    useFor: 'Канонические stat_descriptions, base_items, mods, map_stat_descriptions — живой RePoE-слой kit (core.repoe).',
    mcpTool: 'через core.repoe (кэш 7 дней, см. poe2_data_freshness)',
    fetchable: false,
    notes: 'Данные между патчами почти не меняются (TTL кэша 7 дней). ⚠ packs:null в экспорте — дефект экспорта, НЕ игры (№232).',
  },
];

export function listWebSources(): WebSource[] {
  return SOURCES;
}

export function getWebSource(id: string): WebSource | undefined {
  const k = id.trim().toLowerCase();
  return SOURCES.find((s) => s.id === k);
}

// ─── Stale-логика свежести источников (№245) ─────────────────────────────────
//
// Пороги протухания по update-классификации:
//  - auto   — 30 дней (датамайн/живые API устаревают с патчем GGG);
//  - manual — 90 дней (гайды/вики живут дольше, куратор освежает руками).
// Для auto дополнительно: данные, полученные ДО известного патча, считаются
// протухшими независимо от возраста (сравнение fetchedAt < knownPatchAt).

/** Порог протухания для auto-источников (дней). */
export const STALE_DAYS_AUTO = 30;
/** Порог протухания для manual-источников (дней). */
export const STALE_DAYS_MANUAL = 90;

export interface SourceStaleness {
  /** Возраст данных в днях (целых, вниз). */
  ageDays: number;
  /** Применённый порог (зависит от update). */
  thresholdDays: number;
  /** Протух ли источник по правилам №245. */
  stale: boolean;
  /** Человекочитаемая причина stale (null если свежий). */
  staleReason: string | null;
}

/** Порог протухания по update-классификации (№245). */
export function staleThresholdDays(update: SourceUpdate): number {
  return update === 'auto' ? STALE_DAYS_AUTO : STALE_DAYS_MANUAL;
}

/**
 * Возраст и stale-вердикт источника/датасета по kind/update-классификации.
 * Чистая функция — вся свежестная reporting-логика (MCP + freshness) зовёт её.
 */
export function sourceStaleness(input: {
  update: SourceUpdate;
  fetchedAtMs: number;
  nowMs?: number;
  /** Дата известного патча GGG (ms): auto-данные старше патча = stale. */
  knownPatchAtMs?: number;
}): SourceStaleness {
  const now = input.nowMs ?? Date.now();
  const ageDays = Math.floor((now - input.fetchedAtMs) / 86_400_000);
  const thresholdDays = staleThresholdDays(input.update);
  let staleReason: string | null = null;
  if (ageDays > thresholdDays) {
    staleReason = `старше порога ${thresholdDays} дн (${input.update})`;
  }
  if (
    input.update === 'auto' &&
    input.knownPatchAtMs != null &&
    Number.isFinite(input.knownPatchAtMs) &&
    input.fetchedAtMs < input.knownPatchAtMs
  ) {
    staleReason = 'данные получены до известного патча';
  }
  return { ageDays, thresholdDays, stale: staleReason != null, staleReason };
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
