/**
 * MCP-инструменты: построение и выполнение trade-запросов trade2
 * (официальный API) из модов предмета.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerTradeQueryTools(server: McpServer): number {
  server.registerTool(
    'poe2_trade_search',
    {
      title: 'PoE2 Trade Search (from item)',
      description: `Построить (и опционально выполнить) trade-запрос к официальному trade2 API PoE2 ИЗ КЛИР-ТЕКСТА ПРЕДМЕТА: базовый тип, рейтинги брони/уклонения/ES/DPS как числовые фильтры, моды → stat-фильтры (pseudo-статы: life, резисты, ES, атрибуты, Spirit).

Аргументы:
  - item_text (string, обяз.): клир-текст предмета (Ctrl+C в игре).
  - execute (boolean, опц., по умолч. false): выполнить запрос и вернуть живые листинги (медленнее, до ~2 сек).
  - league (string, опц.): лига (по умолчанию актуальная).
  - tolerance (number, опц., по умолч. 0): насколько ниже значений предмета искать моды.
  - price_max (number, опц.): потолок цены в хаосах для фильтра запроса.
  - limit (number, опц., по умолч. 10): сколько листингов вернуть при execute=true.

Без execute=true просто выдаёт JSON-запрос — его можно показать пользователю для ручного поиска на сайте trade.
`,
      inputSchema: {
        item_text: z.string().min(5).describe('Клир-текст предмета'),
        execute: z.boolean().optional().describe('Выполнить запрос (живые листинги)'),
        league: z.string().optional().describe('Лига'),
        tolerance: z.number().int().min(0).max(100).optional().describe('Допуск вниз для статов'),
        price_max: z.number().positive().optional().describe('Потолок цены (хаос)'),
        limit: z.number().int().min(1).max(20).optional().describe('Листингов'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ item_text, execute, league, tolerance, price_max, limit }) => {
      try {
        const payload = core.tradeQuery.buildTradeQueryFromItem(item_text, {
          tolerance,
          priceMax: price_max,
        });
        const lines: string[] = ['## Trade-запрос (официальный trade2 API PoE2)', ''];
        lines.push('```json');
        lines.push(JSON.stringify(payload, null, 2));
        lines.push('```');
        if (Object.keys(payload.query.stats ?? []).length === 0 && !payload.query.type && !payload.query.name) {
          lines.push('', '_⚠️ Не распознано ни одного фильтра — предмет слишком нестандартный._');
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
        if (execute) {
          const leagueName = league ?? (await core.trade.currentDefaultLeague()) ?? 'Standard';
          lines.push('', `### Выполняю в лиге «${leagueName}»...`);
          const res = await core.tradeQuery.searchTradeQuery(payload, { league: leagueName, limit });
          if (res.error) {
            lines.push(`- Ошибка API: ${res.error}`);
          } else {
            lines.push(`- Всего результатов: ${res.total ?? '?'} (показаны первые ${res.listings.length})`);
            if (res.listings.length) {
              lines.push('', '| Предмет | Цена | Продавец |', '|---|---|---|');
              for (const l of res.listings) {
                lines.push(`| ${l.item?.name ?? '?'} | ${l.price ? `${l.price.amount} ${l.price.currency}` : '—'} | ${l.accountName ?? '—'} |`);
              }
            }
          }
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка trade-запроса: ${msg}` }] };
      }
    },
  );

  return 1;
}
