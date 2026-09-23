
/**
 * MCP-инструменты: poe.ninja PoE2 builds-лэддер (топы, мета, фильтры).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerLadderTools(server: McpServer): number {
  server.registerTool(
    'poe2_ladder_top',
    {
      title: 'PoE2 Ladder Top (poe.ninja)',
      description: `Топ-билды poe.ninja PoE2 (protobuf builds-API, колонки декодируются, классы/скиллы расшифровываются через nDIC-словари).

Аргументы:
  - league (string, опц.): slug лиги poe.ninja (например "forbiddenrites"); по умолчанию — текущая лига (Forbidden Rites).
  - class (string, опц.): фильтр по классу/асценданси, например "Invoker", "Pathfinder".
  - sort (string, опц., по умолч. "level"): сортировка — level, dps, ehp...
  - limit (number, опц., по умолч. 20): сколько строк показать (макс. 100).

Полезно для вопроса «что играют топы» и мета-обзоров.`,
      inputSchema: {
        league: z.string().optional().describe('Slug лиги poe.ninja (иначе текущая лига)'),
        class: z.string().optional().describe('Фильтр по классу/асценданси'),
        sort: z.string().optional().describe('Сортировка: level / dps / ehp'),
        limit: z.number().int().min(1).max(100).optional().describe('Число строк (1-100)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ league, class: className, sort, limit }) => {
      try {
        const leagueSlug = league ?? (await core.trade.currentDefaultLeague()).toLowerCase().replace(/\s+/g, '');
        const res = await core.ladder.searchLadderBuilds(leagueSlug, {
          class: className,
          sort: sort ?? 'level',
        });
        if (!res) {
          const avail = (await core.ladder.listLadderLeagues()).slice(0, 12).join(', ');
          return {
            content: [
              { type: 'text', text: `Лэддер недоступен. Доступные лиги: ${avail}` },
            ],
          };
        }
        const rows = res.rows.slice(0, limit ?? 20);
        const lines: string[] = [];
        lines.push(`## poe.ninja PoE2 — топ ${leagueSlug}${className ? ` / ${className}` : ''}${sort ? ` / sort=${sort}` : ''}`);
        lines.push(`Всего билдов в выборке: **${res.total ?? '?'}**`, '');
        lines.push(core.ladder.formatLadderRows(rows, rows.length));
        if (res.columns.length) {
          lines.push('', `_Колонки ответа: ${res.columns.join(', ')}_`);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка лэддера: ${msg}` }] };
      }
    },
  );

  server.registerTool(
    'poe2_ladder_leagues',
    {
      title: 'PoE2 Ladder Leagues (poe.ninja)',
      description: 'Список доступных снапшотов-лиг poe.ninja PoE2 (slug для poe2_ladder_top): lobbying-лиги, HC/SSF варианты, event-лиги.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const snaps = await core.ladder.getLadderSnapshots();
        const lines = snaps.map(
          (s) => `- \`${s.url}\` (snapshot: ${s.snapshotName}, v${s.version})`,
        );
        return {
          content: [
            { type: 'text', text: `## Лиги poe.ninja PoE2 (${snaps.length})\n\n${lines.join('\n')}` },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка списка лиг: ${msg}` }] };
      }
    },
  );
  return 2;
}
