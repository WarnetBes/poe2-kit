/**
 * Wiki-сервис: поиск и чтение страниц poe2wiki.net (официальная MediaWiki API).
 *
 * Достойный источник для объяснения игровых механик: наш AI-слой просит модель
 * «не выдумывать механики» — теперь у неё есть инструмент проверки фактов.
 * Подход перенесён из _research/poe2-mcp-server/src/services/wiki.ts
 * (MediaWiki API action=query/parse — публичный HTTP-интерфейс wiki).
 */

import { httpJson } from './http.js';

/** Результат поиска по wiki. */
export interface WikiSearchResult {
  title: string;
  snippet: string;
  pageid: number;
}

/** Ищет по wiki PoE2, возвращает до `limit` результатов. */
export async function searchWiki(query: string, limit = 5): Promise<WikiSearchResult[]> {
  const url =
    `https://www.poe2wiki.net/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}` +
    `&format=json&srlimit=${limit}`;
  const data = await httpJson<{ query?: { search?: WikiSearchResult[] } }>(url);
  return data.query?.search ?? [];
}

/** Содержимое страницы wiki по названию (wikitext). */
export async function getWikiPage(title: string): Promise<string> {
  const url =
    `https://www.poe2wiki.net/w/api.php?action=parse&page=${encodeURIComponent(title)}` +
    `&prop=wikitext&format=json`;
  const data = await httpJson<{ parse?: { wikitext?: { '*'?: string } } }>(url);
  return data.parse?.wikitext?.['*'] ?? '';
}

/**
 * Поиск + чтение одним вызовом: до `limit` результатов с выдержками страниц.
 * Удобно для AI: верни краткие факты по вопросу о механике.
 * Максимум `maxChars` на страницу, чтобы не раздувать контекст.
 */
export async function lookupWiki(
  query: string,
  opts: { limit?: number; maxChars?: number } = {},
): Promise<{ query: string; results: Array<WikiSearchResult & { wikitext?: string }> }> {
  const limit = opts.limit ?? 3;
  const maxChars = opts.maxChars ?? 2000;
  const found = await searchWiki(query, limit);
  const results: Array<WikiSearchResult & { wikitext?: string }> = [];
  for (const r of found.slice(0, limit)) {
    let wikitext: string | undefined;
    try {
      wikitext = (await getWikiPage(r.title)).slice(0, maxChars);
    } catch {
      wikitext = undefined; // одна недоступная страница не ломает весь поиск
    }
    results.push({ ...r, wikitext });
  }
  return { query, results };
}
