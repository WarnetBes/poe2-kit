/**
 * MCP-тул «Витрина poeshop» (волна poeshop-интеграции).
 * Источник — core/poeshopMarket.ts (data/game/market/poeshop_market.json,
 * генератор scripts/gen-poeshop-market.mjs, срез poeshop.ru).
 *
 * Тул `poe2_unique_market`: офлайн-цены уника (и не только) по витрине poeshop:
 * вкладка «ценная вещь — не выкидывай». Матчинг EN и RU имён — работает
 * с предметами из RU-клиента (Ctrl+C).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  lookupPoeshopMarket,
  searchPoeshopMarket,
  poeshopMarketMeta,
  type PoeshopMarketEntry,
  type PoeshopMarketLookup,
} from '@poe2-kit/core';

const TIER_ICON: Record<string, string> = {
  jackpot: '🔴',
  valuable: '🟠',
  keep: '🟡',
  sellable: '🟢',
  trash: '⚪',
};

function fmtNum(v: number | null | undefined, suffix = ''): string {
  if (v == null) return '—';
  const s = Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return `${s}${suffix}`;
}

function lookupBlock(lk: PoeshopMarketLookup): string {
  const e = lk.entry!;
  const lines = [
    `### ${e.en}${e.ru ? ` (${e.ru})` : ''}`,
    `- Тип: ${e.sub}${e.base ? `, база: ${e.base}` : ''}`,
  ];
  if (lk.league && lk.prices) {
    const p = lk.prices;
    const icon = lk.verdict ? TIER_ICON[lk.verdict.tier] : '❔';
    lines.push(
      `- **Вердикт:** ${lk.verdict ? lk.verdict.text : 'цены в свежих лигах нет'}`,
      `- Рыночный агрегат (лига ${lk.league}): ${fmtNum(p.divine)} div / ${fmtNum(p.exalt)} ex / ${fmtNum(p.chaos)} chaos`,
    );
    if (p.rub != null) {
      lines.push(
        `- Витрина: ~${fmtNum(p.rub, ' ₽')} (цена услуг RMT — НЕ стоимость гира${p.rub <= 60 ? ', возможен floor 50₽' : ''})`,
      );
    }
    if (p.change7d != null) lines.push(`- Динамика 7д: ${p.change7d > 0 ? '+' : ''}${p.change7d}%`);
    lines.push(`- Свежесть среза: ${lk.freshness ?? '?'}`);
  } else {
    lines.push('- Цен в датасете нет (не торгуется или карточка без цен).');
  }
  if (lk.matchedBy === 'ru') lines.push('- Матчинг по RU-имени из датасета.');
  return lines.join('\n');
}

function entryLine(e: PoeshopMarketEntry, leagueHint?: string | null): string {
  const lk = lookupPoeshopMarket(e.en, leagueHint ?? null);
  const div = lk.prices?.divine;
  const icon = lk.verdict ? TIER_ICON[lk.verdict.tier] : '❔';
  const lg = lk.league ?? '—';
  return `- ${icon} **${e.en}**${e.ru ? ` (${e.ru})` : ''} — ${div != null ? `${fmtNum(div)} div (${lg})` : 'без цен'} [${e.sub}]`;
}

/** Регистрация тулов «Витрина poeshop». Возвращает число зарегистрированных (1). */
export function registerPoeshopMarketTools(server: McpServer): number {
  server.registerTool(
    'poe2_unique_market',
    {
      title: 'PoE2 Unique Market (poeshop offline)',
      description: `Офлайн-цены уников PoE2 по витрине poeshop.ru (д датасет кита): вердикт «ценная вещь — не выкидывай», рыночный агрегат в div/ex/chaos, цена витрины в рублях с честным дисклеймером. Матчинг и EN («Temporalis Silk Robe», «Temporalis»), и RU («Темпоралис») имён — работает с Ctrl+C из RU-клиента.

⚠️ Дисклеймер: poeshop — витрина услуг (RMT). divine/exalt/chaos — рыночный агрегат, rub — цена витрины, НЕ рыночная стоимость. Срез Standard устаревает — смотри fetchedAt.

Вход:
  - name (string): имя уника (EN/RU, полное или каноническое) или предмета.
  - league (string, опц.): лига («Forbidden Rites», «Runes of Aldur», «standard», HC-варианты). Без лиги — приоритет свежих челлендж-лиг.
  - query (string, опц.): поиск по подстроке (до 10 подсказок).

Примеры:
  - "Temporalis сколько стоит" → name: Temporalis
  - "Темпоралис" (RU-клиент) → name: Темпоралис
  - "что дорогое из колец" → query: ring`,
      inputSchema: {
        name: z.string().min(2).optional().describe('имя уника (EN/RU) для точного lookup'),
        league: z.string().min(2).optional().describe('лига (RU/EN или код poeshop)'),
        query: z.string().min(2).optional().describe('подстрока для поиска подсказок'),
      },
      outputSchema: {
        markdown: z.string(),
        found: z.number(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ name, league, query }) => {
      try {
        const meta = poeshopMarketMeta();
        const footer = [
          '',
          `---`,
          `Источник: ${meta.provenance}; датасет кита от ${meta.generatedAt ?? '?'}.`,
          `${meta.caveats[0]}`,
        ];
        if (name) {
          const lk = lookupPoeshopMarket(name, league ?? null);
          if (lk.entry) {
            const md = ['# 🛒 Витрина poeshop', lookupBlock(lk), ...footer].join('\n');
            return { content: [{ type: 'text', text: md }], structuredContent: { markdown: md, found: 1 } };
          }
          if (lk.variants.length) {
            // Каноническое имя с вариантами баз (Runeforged/Runemastered и т.п.)
            const md = [
              '# 🛒 Витрина poeshop',
              `По имени найдено ${lk.variants.length} вариантов баз:`,
              ...lk.variants.map((e) => entryLine(e, league)),
              ...footer,
            ].join('\n');
            return { content: [{ type: 'text', text: md }], structuredContent: { markdown: md, found: lk.variants.length } };
          }
          if (query == null && name.length >= 2) {
            const hints = searchPoeshopMarket(name, 5);
            const hintMd = hints.length ? hints.map((e) => `- ${e.en}${e.ru ? ` (${e.ru})` : ''}`).join('\n') : 'нет похожих';
            const md = [`Не найдено в датасете poeshop: «${name}».`, '', 'Похожие:', hintMd, ...footer].join('\n');
            return { content: [{ type: 'text', text: md }], structuredContent: { markdown: md, found: 0 } };
          }
        }
        if (query) {
          const hits = searchPoeshopMarket(query, 10);
          const md = [
            '# 🛒 Витрина poeshop — поиск',
            ...(hits.length ? hits.map((e) => entryLine(e, league)) : ['Ничего не найдено.']),
            ...footer,
          ].join('\n');
          return { content: [{ type: 'text', text: md }], structuredContent: { markdown: md, found: hits.length } };
        }
        const md = ['Укажи name (точный lookup) или query (подстрока).', ...footer].join('\n');
        return { content: [{ type: 'text', text: md }], structuredContent: { markdown: md, found: 0 } };
      } catch (e) {
        return {
          content: [{ type: 'text', text: `Витрина poeshop недоступна: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  return 1;
}
