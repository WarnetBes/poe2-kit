/**
 * MCP-инструменты: валюты (poe.ninja).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core, KNOWN_LEAGUES } from '@poe2-kit/core';

const defaultLeague = KNOWN_LEAGUES[0]?.name ?? 'Runes of Aldur';

const LeagueSchema = z
  .string()
  .default(defaultLeague)
  .describe(`Название лиги PoE2. По умолчанию: "${defaultLeague}". Доступно: ${KNOWN_LEAGUES.map((l) => l.name).join(', ')}`);

export function registerCurrencyTools(server: McpServer): number {
  server.registerTool(
    'poe2_currency_prices',
    {
      title: 'PoE2 Currency Prices',
      description: `Курсы обмена валют Path of Exile 2 с poe.ninja (в chaos-эквиваленте).

Аргументы:
  - league (string, опц.): название лиги.

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
        core.trade.setLeague(league);
        const rates = await core.trade.fetchCurrencyRates(league);
        if (!rates.length) {
          return { content: [{ type: 'text', text: `Нет данных о валютах для лиги "${league}".` }] };
        }
        const rows = rates
          .filter((r) => r.chaosValue != null)
          .sort((a, b) => (b.chaosValue ?? 0) - (a.chaosValue ?? 0))
          .map((r) => `- **${r.name}**: ${r.chaosValue!.toFixed(2)} chaos`);
        return {
          content: [
            {
              type: 'text',
              text: `## Валюты — ${league}\n\n${rows.join('\n')}\n\nИсточник: poe.ninja PoE2 Economy API.`,
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
        core.trade.setLeague(league);
        const rates = await core.trade.fetchCurrencyRates(league);
        const q = name.toLowerCase();
        const matches = rates.filter(
          (r) => r.name.toLowerCase().includes(q) && r.chaosValue != null,
        );
        if (!matches.length) {
          return {
            content: [
              {
                type: 'text',
                text: `Не найдена валюта "${name}" в ${league}. Подсказка: попробуй короче, напр. "divine", "exalted", "chaos".`,
              },
            ],
          };
        }
        const rows = matches.map((r) => `**${r.name}**: ${r.chaosValue!.toFixed(2)} chaos`);
        return { content: [{ type: 'text', text: `## Валюты по "${name}" — ${league}\n\n${rows.join('\n')}` }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );

  return 2;
}