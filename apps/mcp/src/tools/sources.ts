/**
 * MCP-инструменты №69: библиотека веб-источников PoE2.
 * poe2_sources_list — агенту видно, откуда брать данные и какими тулами.
 * poe2_sources_fetch — честный фетч страниц из курируемого реестра (host-guard в core).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerSourcesTools(server: McpServer): number {
  let n = 0;

  server.registerTool(
    'poe2_sources_list',
    {
      title: 'PoE2 Web Sources Library',
      description: `Библиотека курируемых источников PoE2 Kit: откуда черпать информацию для помощи игроку.

Для КАЖДОГО источника: id, что там искать, какому специализированному тулу kit'а отдать предпочтение (raw-fetch не нужен), можно ли тянуть текст напрямую и честные оговорки.

Порядок предпочтения при доборе информации:
  1. Локальные туры kit'а (dataset, build, leveling, calculators, poe2_overlay_state/gaps) — без сети.
  2. Спец-туры по API (poe2_wiki_lookup, poe2_poe2db_lookup, poe2_currency_*, poe2_ladder_*, poe2_trade_search).
  3. poe2_sources_fetch — для fetchable-источников (новости GGG, гайды maxroll/mobalytics, fextralife).
НЕ выдумывайте факты о механиках по памяти: сначала тул, потом ответ.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const lines = ['## Библиотека источников PoE2 Kit', ''];
      for (const s of core.sources.listWebSources()) {
        lines.push(`### ${s.id} — ${s.title} [${s.category}]`);
        lines.push(`- Для чего: ${s.useFor}`);
        if (s.mcpTool) lines.push(`- Спец-тул (предпочесть!): ${s.mcpTool}`);
        lines.push(`- Fetchable: ${s.fetchable ? 'да (poe2_sources_fetch)' : 'нет — только спец-тул/браузер'}`);
        if (s.searchTemplate) lines.push(`- Поиск: поддерживает query=${'{query}'}`);
        if (s.notes) lines.push(`- Оговорки: ${s.notes}`);
        lines.push('');
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
  n++;

  server.registerTool(
    'poe2_sources_fetch',
    {
      title: 'Fetch Curated Source Page',
      description: `Тянуть страницу из курируемого реестра источников (host-guard: произвольные URL запрещены — только id из poe2_sources_list).

Аргументы:
  - source_id (string, обяз.): id источника из poe2_sources_list (fetchable=true).
  - path (string, опц.): подстраница, начинается с "/" (например /news/... для official-news).
  - query (string, опц.): поисковый запрос — только для источников с шаблоном поиска (см. poe2_sources_list; проверенных шаблонов может не быть).
  - max_chars (number, опц.): лимит текста (500-20000, по умолчанию 4000).

Примеры:
  - source_id=official-news → список анонсов/патчноутов GGG (проверено, работает).
  - source_id=maxroll-poe2, path="/poe2/build-guides" → списки эндгейм-гайдов (200 OK).
  - source_id=fextralife-wiki → помечен мёртвым (timeout 29.09.2026), нужен живой ре-чек перед использованием.`,
      inputSchema: {
        source_id: z.string().min(2).describe('id источника из poe2_sources_list'),
        path: z.string().optional().describe('Подстраница источника (начинается с /)'),
        query: z.string().optional().describe('Поисковый запрос (для источников с шаблоном поиска)'),
        max_chars: z.number().int().min(500).max(20_000).optional().describe('Лимит символов текста'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ source_id, path, query, max_chars }) => {
      const page = await core.sources.fetchWebSource(source_id, { path, query, maxChars: max_chars });
      const lines = [
        `## ${page.sourceId}: ${page.url}`,
        `Символов: ${page.chars}`,
        ...(page.warning ? [`⚠ ${page.warning}`] : []),
        '',
        page.text,
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
  n++;

  return n;
}
