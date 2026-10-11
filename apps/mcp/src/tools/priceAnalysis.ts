/**
 * MCP-инструменты: анализ рынка валют poe2scout (тренд/волатильность/объёмы/сигналы).
 * История — живые эндпоинты poe2scout (Items/{id}/History + DailyStatsHistory),
 * анализ — офлайн core.priceAnalysis (порт MIT-логики poe2scout-mcp).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';
import { currentDefaultLeague } from '../leagues.js';

const LeagueSchema = z
  .string()
  .optional()
  .describe('Название лиги PoE2. Если не указана — актуальная текущая лига (из poe2scout).');

const TREND_RU: Record<string, string> = {
  rising: 'рост',
  falling: 'падение',
  stable: 'стабильно',
};
const LEVEL_RU: Record<string, string> = {
  low: 'низкая',
  medium: 'средняя',
  high: 'высокая',
};
const VOL_RU: Record<string, string> = {
  low: 'низкий',
  normal: 'нормальный',
  high: 'высокий',
};
const REC_RU: Record<string, string> = {
  buy: '.buy — дешевле среднего, тренд не падает',
  sell: 'sell — дороже среднего, тренд не растёт',
  hold: 'hold — непонятно',
  fair_value: 'справедливая цена — около среднего',
};

export function registerPriceAnalysisTools(server: McpServer): number {
  server.registerTool(
    'poe2_price_analysis',
    {
      title: 'PoE2 Price Analysis',
      description: `Анализ рынка валюты Path of Exile 2: тренд, волатильность, объёмы, выбросы (манипуляции), торговые сигналы (buy/sell/hold) и дневной тренд. Источник истории — poe2scout (часовые логи + дневные OHLC). Все цены — в базовой валюте лиги (обычно exalted).

Аргументы:
  - item (string, обяз.): название валюты. Примеры: "Divine Orb", "divine", "Chaos Orb", "Exalted Orb", "Mirror of Kalandra".
  - league (string, опц.): лига. Если не указана — актуальная текущая.
  - hours (number, опц., 1..500): сколько часовых точек истории. По умолчанию 48.
  - days (number, опц., 1..90): сколько дневных свечей. По умолчанию 7.

Возвращает вердикт: сигнал_buy/sell, тренд, волатильность, диапазон цен, объёмы, дневное изменение. Используйте для вопросов вида «покупать/продавать Divine сейчас?», «оседать ли в Divines», «не манипуляция ли этот скачок цены».
`,
      inputSchema: {
        item: z.string().describe('Название валюты (или ApiId): "Divine Orb", "divine", "chaos"...'),
        league: LeagueSchema,
        hours: z.number().int().min(1).max(500).optional(),
        days: z.number().int().min(1).max(90).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ item, league, hours, days }) => {
      try {
        const L = league ?? (await currentDefaultLeague());
        core.trade.setLeague(L);

        // ApiId→ItemId берём из списка валют лиги; матчим пользовательскую строку.
        const ids = await core.trade.fetchScoutApiIds(L);
        const apiId = core.trade.matchScoutApiId(item, ids.keys());
        if (!apiId) {
          return {
            content: [
              {
                type: 'text',
                text: `Не удалось сопоставить "${item}" с валютой poe2scout в лиге "${L}". Попробуйте точное имя из poe2_currency_prices.`,
              },
            ],
          };
        }

        const [hourly, daily] = await Promise.all([
          core.trade.fetchScoutPriceHistory(apiId, { league: L, logCount: hours ?? 48 }),
          core.trade.fetchScoutDailyStats(apiId, { league: L, dayCount: days ?? 7 }),
        ]);
        if (!hourly || hourly.length === 0) {
          return {
            content: [{ type: 'text', text: `Нет истории цен для "${item}" в лиге "${L}" (poe2scout).` }],
          };
        }

        const analysis = core.priceAnalysis.analyzePricesFull(item, hourly, daily ?? []);
        const a = analysis.priceAnalysis;
        const dt = analysis.dailyTrend;
        const lines: string[] = [];

        lines.push(`## ${item} — анализ рынка (${L})`);
        lines.push('');
        lines.push(`- Текущая цена (в базовой валюте лиги): **${analysis.currentPrice}**`);
        lines.push(`- Тренд: **${TREND_RU[a.trend] ?? a.trend}** (${a.trendStrength}), волатильность: ${LEVEL_RU[a.volatility] ?? a.volatility}`);
        lines.push(`- Диапазон за окно: ${a.priceRange.min.toFixed(2)}…${a.priceRange.max.toFixed(2)} (среднее ${a.priceRange.avg.toFixed(2)})`);
        lines.push(`- Объём: ${VOL_RU[a.volumeLevel] ?? a.volumeLevel}${analysis.marketContext.recentVolumeSpike ? ', свежий всплеск объёма' : ''}`);
        lines.push(`- Уверенность анализа: ${LEVEL_RU[a.confidence] ?? a.confidence}; риск: ${LEVEL_RU[a.riskLevel] ?? a.riskLevel}`);
        if (analysis.marketContext.outlierDetected) {
          lines.push(`- ⚠ Выброс: точка ${analysis.marketContext.outlierPrice} — вероятно аномалия/манипуляция, не ориентируйтесь на неё.`);
        }
        const sig = analysis.tradingSignals;
        lines.push(
          `- Сигналы: **buy=${sig.buySignal}, sell=${sig.sellSignal}, hold=${sig.holdRecommendation}** → ${REC_RU[a.recommendation] ?? a.recommendation}`,
        );
        if (dt.changePct != null) {
          lines.push(`- Дневной тренд (${daily?.length ?? 0} дн.): ${dt.changePct >= 0 ? '+' : ''}${dt.changePct.toFixed(1)}% за окно`);
        }
        if (dt.volumeTrend != null) {
          lines.push(`- Динамика объёма: последний день = ${(dt.volumeTrend * 100).toFixed(0)}% от среднего.`);
        }
        lines.push('');
        for (const ins of analysis.insights) lines.push(`- ${ins}`);
        lines.push('');
        lines.push(`Источник: poe2scout (${hourly.length} часовых точек, ${daily?.length ?? 0} дневных).`);

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          structuredContent: { analysis },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );
  return 1;
}
