/**
 * MCP-инструменты: валюты (poe.ninja).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';
import { currentDefaultLeague } from '../leagues.js';

const LeagueSchema = z
  .string()
  .optional()
  .describe('Название лиги PoE2. Если не указана — берётся актуальная текущая лига (из poe2scout). Список: poe2_leagues.');

export function registerCurrencyTools(server: McpServer): number {
  server.registerTool(
    'poe2_currency_prices',
    {
      title: 'PoE2 Currency Prices',
      description: `Курсы обмена валют Path of Exile 2 (в chaos-эквиваленте) для заданной лиги. Лиги подтягиваются актуальные (poe2scout).
 
Аргументы:
  - league (string, опц.): название лиги. Если не указана — актуальная текущая лига (из poe2scout). Список: poe2_leagues.

Возвращает список валют с ценой в chaos и источником.

Примеры:
  - "Сколько стоит Exalted Orb?" → прайс-чек по валюте
  - "Курсы валют" → все валюты по убыванию
`,
      inputSchema: { league: LeagueSchema },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ league }) => {
      try {
        const L = league ?? (await currentDefaultLeague());
        core.trade.setLeague(L);
        const rates = await core.trade.fetchBestCurrencyRates(L);
        if (!rates.length) {
          return { content: [{ type: 'text', text: `Нет данных о валютах для лиги "${L}".` }] };
        }
        const rows = rates
          .filter((r) => r.chaosValue != null)
          .sort((a, b) => (b.chaosValue ?? 0) - (a.chaosValue ?? 0))
          .map((r) => `- **${r.name}**: ${r.chaosValue!.toFixed(2)} chaos`);
        return {
          content: [
            {
              type: 'text',
              text: `## Валюты — ${L}\n\n${rows.join('\n')}\n\nИсточник: poe2scout + poe.ninja.`,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );

  server.registerTool(
    'poe2_currency_check',
    {
      title: 'PoE2 Currency Value',
      description: `Значение конкретной валюты PoE2 в chaos.

Аргументы:
  - name (string): название валюты или его часть, напр. "divine", "exalted", "chaos".
  - league (string, опц.).

Примеры:
  - "Сколько стоит Divine Orb?" → name="Divine Orb"
  - "Цена Exalted" → name="Exalted"
`,
      inputSchema: {
        name: z.string().min(2).describe('Название валюты или его часть'),
        league: LeagueSchema,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ name, league }) => {
      try {
        const L = league ?? (await currentDefaultLeague());
        core.trade.setLeague(L);
        const rates = await core.trade.fetchBestCurrencyRates(L);
        const q = name.toLowerCase();
        const matches = rates.filter(
          (r) => r.name.toLowerCase().includes(q) && r.chaosValue != null,
        );
        if (!matches.length) {
          return {
            content: [
              {
                type: 'text',
                text: `Не найдена валюта "${name}" в ${L}. Подсказка: попробуй короче, напр. "divine", "exalted", "chaos".`,
              },
            ],
          };
        }
        const rows = matches.map((r) => `**${r.name}**: ${r.chaosValue!.toFixed(2)} chaos`);
        return { content: [{ type: 'text', text: `## Валюты по "${name}" — ${L}\n\n${rows.join('\n')}` }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );

  server.registerTool(
    'poe2_leagues',
    {
      title: 'PoE2 Active Leagues',
      description: `Актуальный список лиг Path of Exile 2 (из poe2scout). Актуальные лиги помечены ✦.
Без аргументов. Используется для выбора лиги в остальных торговых/валютных инструментах.
`,
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const leagues = await core.trade.fetchLeagues();
        if (!leagues.length) return { content: [{ type: 'text', text: 'Нет данных о лигах.' }] };
        const rows = leagues
          .map((l) => `- **${l.name}**${l.isCurrent ? ' ✦' : ''}${l.shortName ? ` (\`${l.shortName}\`)` : ''}`)
          .join('\n');
        return { content: [{ type: 'text', text: `## Лиги PoE2\n\n${rows}` }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );

  return 3;
}