/**
 * MCP-инструмент: проверка игровых механик по poe2wiki.net.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerWikiTools(server: McpServer): number {
  server.registerTool(
    'poe2_wiki_lookup',
    {
      title: 'PoE2 Wiki Lookup',
      description: `Поиск и чтение poe2wiki.net (официальное сообщество-вики). Используйте для проверки фактов о механиках, геме, унике, боссе — НЕ выдумывайте механики по памяти.

Аргументы:
  - query (string, обяз.): поисковый запрос (название механики/предмета/босса).
  - limit (number, опц.): сколько страниц вернуть (по умолчанию 3).
  - max_chars (number, опц.): сколько символов wikitext на страницу (по умолчанию 2000).

Примеры:
  - "Как работает Shock?" → query="Shock"
  - "Что делает гем Ice Strike?" → query="Ice Strike"
`,
      inputSchema: {
        query: z.string().min(2).describe('Поисковый запрос'),
        limit: z.number().int().min(1).max(5).optional().describe('Макс. результатов'),
        max_chars: z.number().int().min(200).max(8000).optional().describe('Символов wikitext на страницу'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, limit, max_chars }) => {
      try {
        const { results } = await core.wiki.lookupWiki(query, { limit, maxChars: max_chars });
        if (!results.length) {
          return { content: [{ type: 'text', text: `По запросу «${query}» в poe2wiki.net ничего не найдено.` }] };
        }
        const lines = [`## poe2wiki.net: «${query}»`, ''];
        for (const r of results) {
          lines.push(`### ${r.title} (page ${r.pageid})`);
          const snippet = r.snippet?.replace(/<[^>]+>/g, '').trim();
          if (snippet) lines.push(`>${snippet}`);
          if (r.wikitext) {
            lines.push('');
            lines.push('```wikitext');
            lines.push(r.wikitext);
            lines.push('```');
          }
          lines.push('');
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка wiki-поиска: ${msg}` }] };
      }
    },
  );

  return 1;
}
