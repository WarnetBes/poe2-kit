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

  server.registerTool(
    'poe2_currency_history',
    {
      title: 'PoE2 Currency Price History',
      description: `История/тренд курса валют Path of Exile 2 за окно poe.ninja (≈7 дней). Для «покупай сейчас / жди» и отслеживания скачков после патча.

Аргументы:
  - name (string, опц.): валюта или её часть ("divine", "exalted", "chaos"). Если не указана — топ движений по всем валютам.
  - league (string, опц.).

Честно: poe.ninja PoE2 не отдаёт публичный history-эндпоинт с ценами по дням. Тренд строится на sparkline из текущего обзора: totalChange (% за окно) и дневной ряд изменений.

Примеры:
  - "История Divine Orb" → тренд/скачки
  - "Какие валюты скакнули после патча?" → топ движений
`,
      inputSchema: { name: z.string().optional().describe('Название валюты или её часть'), league: LeagueSchema },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ name, league }) => {
      try {
        const L = league ?? (await currentDefaultLeague());
        core.trade.setLeague(L);
        const hist = await core.trade.fetchCurrencyHistory(L);
        if (!hist.length) return { content: [{ type: 'text', text: `Нет данных истории для лиги "${L}".` }] };
        const text = renderHistory(hist, name);
        return { content: [{ type: 'text', text: `## История цен валют — ${L}\n\n${text}` }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );

  server.registerTool(
    'poe2_price_history',
    {
      title: 'PoE2 Price History',
      description: `История цен по запросу. Охватывает валюты (единственная public-история трендов у poe.ninja PoE2 — sparkline из Exchange Overview). Для предметов/уников отдельной публичной истории poe.ninja не отдаёт — текущие цены смотри через poe2_price_check / poe2_build_price.

Аргументы:
  - name (string, опц.): что ищем ("Divine Orb", "Exalted"). Если совпало с валютой — тренд; иначе честная подсказка.
  - league (string, опц.).

Примеры:
  - "История цен Divine" → тренд
  - "Что дорожает?" → топ движений
`,
      inputSchema: { name: z.string().optional().describe('Что ищем (валюта)'), league: LeagueSchema },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ name, league }) => {
      try {
        const L = league ?? (await currentDefaultLeague());
        core.trade.setLeague(L);
        const hist = await core.trade.fetchCurrencyHistory(L);
        if (!hist.length) return { content: [{ type: 'text', text: `Нет данных истории для лиги "${L}".` }] };
        const q = name?.trim().toLowerCase();
        const matched = q ? hist.filter((h) => h.name.toLowerCase().includes(q)) : null;
        if (q && matched && matched.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `## История цен "${name}" — ${L}\n\nИмени "${name}" нет среди валют, для которых poe.ninja отдаёт тренд. Публичная история цен ПРЕДМЕТОВ/уников у poe.ninja PoE2 отсутствует. Текущие цены предметов — через poe2_price_check. Вот топ движений валют на окне:\n\n${topMovers(hist)}`,
              },
            ],
          };
        }
        const text = renderHistory(hist, name);
        return { content: [{ type: 'text', text: `## История цен — ${L}\n\n${text}` }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );

  return 5;
}

type HistPoint = Awaited<ReturnType<typeof core.trade.fetchCurrencyHistory>>[number];

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  const s = v > 0 ? '+' : '';
  return `${s}${v.toFixed(1)}%`;
}

/** Честная эвристика «что делать» по тренду (не обещание рынка). */
function historyAdvice(t: number | null): string {
  if (t == null) return 'нет данных тренда';
  if (t > 12) return 'резко растёт — возможен перегрев';
  if (t > 0) return 'растёт';
  if (t < -12) return 'падает — возможен момент для покупки';
  if (t < 0) return 'падает';
  return 'в целом стабильна';
}

function historyRow(h: HistPoint): string {
  const arrow = h.totalChange == null ? '' : h.totalChange > 0 ? '▲' : h.totalChange < 0 ? '▼' : '•';
  const cat = h.category && h.category !== 'Currency' ? ` (${h.category})` : '';
  return `- **${h.name}**${cat}: ${h.chaosValue != null ? h.chaosValue.toFixed(3) : '—'} chaos | за окно ${arrow} ${fmtPct(h.totalChange)} → ${historyAdvice(h.totalChange)}`;
}

function topMovers(hist: HistPoint[]): string {
  const ranked = hist
    .filter((h) => h.totalChange != null)
    .sort((a, b) => Math.abs(b.totalChange!) - Math.abs(a.totalChange!))
    .slice(0, 12);
  if (!ranked.length) return 'Нет данных о движениях.';
  return ranked.map(historyRow).join('\n');
}

function renderHistory(hist: HistPoint[], name?: string): string {
  const q = name?.trim().toLowerCase();
  if (q) {
    const m = hist.filter((h) => h.name.toLowerCase().includes(q));
    if (!m.length) {
      return `Валюта "${name}" не найдена среди тех, кому poe.ninja отдаёт тренд. Вот топ движений на окне:\n\n${topMovers(hist)}`;
    }
    const lines = m.map((h) => {
      const len = (h.days ?? []).length;
      const series = (h.days ?? [])
        .map((d) => (d == null ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1)}`))
        .join(' → ');
      return [
        historyRow(h),
        len ? `  Ряд (${len} дн.): ${series}` : '  Ряд: нет данных',
      ].join('\n');
    });
    return lines.join('\n\n');
  }
  return topMovers(hist);
}