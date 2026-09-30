/**
 * MCP-инструменты: руны/аугменты PoE2 — прайс-чек (trade2 по base-типу).
 *
 * Руны = аугменты (Ezomyte — глобальный дроп, Kalguuran — с Verisium Remnant /
 * Expedition; Lesser → → Greater → Perfect, верстак 3→1). Каждая руна —
 * торгуемый base-тип, цены берутся живьём с trade2 (search + fetch топ-листингов).
 * RU-имена в оверлее переводятся словарём v4 (слаг poe2db 'Augment'), здесь — EN.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';
import { currentDefaultLeague } from '../leagues.js';

const LeagueSchema = z
  .string()
  .optional()
  .describe('Название лиги PoE2. Если не указана — актуальная текущая лига (из poe2scout).');

const TierSchema = z
  .enum(['all', 'lesser', 'regular', 'greater', 'perfect'])
  .optional()
  .describe('Тир руны: lesser (Малая), regular (без приставки), greater (Великая), perfect (Perfect).');

const KindSchema = z
  .enum(['rune', 'soul core', 'all'])
  .optional()
  .describe('Вид аугмента: rune (руны), soul core (ядра душ), all.');

interface RunePriceRow {
  name: string;
  total: number | undefined;
  median: string | null;
  cheapest: string | null;
  error?: string;
}

/** Медиана цен первых листингов (строки вида "5 exalted"). */
function priceString(amount: number, currency: string): string {
  return `${amount} ${currency}`;
}

export function registerRuneTools(server: McpServer): number {
  server.registerTool(
    'poe2_rune_prices',
    {
      title: 'PoE2 Rune Prices',
      description: `Живые цены рун и аугментов PoE2 (trade2, лига по умолчанию — актуальная челлендж-лига).

Аргументы:
  - name (string, опц.): подстрока EN-имени руны, напр. "desert", "glacial", "storm", "greater alacrity", "soul core of".
  - tier (опц.): lesser | regular | greater | perfect | all.
  - kind (опц.): rune | soul core | all.
  - max (int, опц., 1–12, default 6): сколько рун оценивать. Каждая = отдельный
    trade2-запрос (search + fetch), больше 8 — медленно.

Возвращает таблицу: имя, всего листингов, медиана и минимум из первых 5 листингов.

Примеры:
  - "Сколько стоят Great Storm Rune / Greater руны?" → name="storm", tier="greater"
  - "Цены soul cores" → kind="soul core"
  - "Прайс-чек всех рун пустыни" → name="desert"
`,
      inputSchema: {
        name: z.string().optional().describe('Подстрока EN-имени руны (см. poe2_base_items / датасет)'),
        tier: TierSchema,
        kind: KindSchema,
        max: z.number().int().min(1).max(12).optional(),
        league: LeagueSchema,
      },
      annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ name, tier, kind, max, league }) => {
      try {
        const L = league ?? (await currentDefaultLeague());
        const limit = Math.min(max ?? 6, 12);
        const augments = core.runes.searchAugments(name ?? '', {
          tier: tier ?? 'all',
          kind: kind ?? 'rune',
          limit: name ? limit : limit,
        });
        if (!augments.length) {
          return {
            content: [{
              type: 'text',
              text: `Аугменты не найдены (name=${JSON.stringify(name ?? '')}, tier=${tier ?? 'all'}, kind=${kind ?? 'rune'}). Имена — EN: см. poe2_base_items, класс Augment.`,
            }],
          };
        }
        const rows: RunePriceRow[] = [];
        // №94: медиана без приведения — смешанные валюты («3 exalted» и «1 chaos»
        // складывались как числа). Приводим каждый листинг к chaos курсом
        // poe2scout/poe.ninja (кэш core, один fetch на вызов), медиану считаем
        // в chaos; курс неизвестен → листинг в chaos-медиану не входит.
        // Ключи курса = те же, что в attachListingChaos (№67): полное имя
        // lower + без хвоста « orb» ('Exalted Orb'→'exalted') + короткие
        // id trade2 ('alch', 'regal'...).
        const TRADE2_ALIAS: Record<string, string> = {
          alch: 'orb of alchemy',
          regal: 'regal orb',
          exalt: 'exalted orb',
          aug: 'orb of augmentation',
          trans: 'orb of transmutation',
        };
        const rateById = new Map<string, number>();
        for (const r of await core.trade.fetchBestCurrencyRates(L)) {
          if (r.chaosValue == null || !Number.isFinite(r.chaosValue)) continue;
          const k = r.name.toLowerCase();
          rateById.set(k, r.chaosValue);
          rateById.set(k.replace(/\s*orb$/, ''), r.chaosValue);
        }
        const chaosValue = (currency: string): number | null => {
          const c = currency.toLowerCase();
          return rateById.get(c) ?? rateById.get(TRADE2_ALIAS[c] ?? '') ?? null;
        };
        for (const a of augments) {
          const res = await core.tradeQuery.searchTradeQuery(
            {
              query: { status: { option: 'available' }, type: a.name, filters: {} },
              sort: { price: 'asc' },
            },
            { league: L, limit: 5 },
          );
          const prices = res.listings
            .map((l) => l.price)
            .filter((p): p is { amount: number; currency: string } => !!p && typeof p.amount === 'number')
            .sort((x, y) => x.amount - y.amount);
          const inChaos = prices
            .map((p) => {
              const cv = chaosValue(p.currency);
              return cv != null ? p.amount * cv : null;
            })
            .filter((c): c is number => c != null);
          inChaos.sort((x, y) => x - y);
          const medianChaos = inChaos.length
            ? inChaos.length % 2
              ? inChaos[(inChaos.length - 1) / 2]!
              : (inChaos[inChaos.length / 2 - 1]! + inChaos[inChaos.length / 2]!) / 2
            : null;
          const median = medianChaos != null && inChaos.length === prices.length
            ? priceString(+medianChaos.toFixed(2), 'chaos (приведено)')
            : prices.length
              ? priceString(
                  prices.length % 2
                    ? prices[(prices.length - 1) / 2]!.amount
                    : (prices[prices.length / 2 - 1]!.amount + prices[prices.length / 2]!.amount) / 2,
                  prices[0]!.currency,
                )
              : null;
          rows.push({
            name: a.name,
            total: res.total,
            median,
            cheapest: prices.length ? priceString(prices[0]!.amount, prices[0]!.currency) : null,
            error: res.error,
          });
        }
        const tableRows = rows
          .map((r) =>
            `| ${r.name} | ${r.total ?? '—'} | ${r.median ?? '—'} | ${r.cheapest ?? '—'} |`,
          )
          .join('\n');
        const errors = rows.filter((r) => r.error);
        return {
          content: [{
            type: 'text',
            text:
              `## Руны — ${L} (trade2, первые листинги)\n\n` +
              (rows.length
                ? `| Руна | Всего | Медиана (топ-5) | Минимум |\n|---|---|---|---|\n${tableRows}\n`
                : '') +
              (errors.length ? `\nОшибки: ${errors.map((e) => `${e.name}: ${e.error}`).join('; ')}` : '') +
              `\n\nОверлей: Ctrl+F1 на руны работает и в RU-клиенте (словарь v4).`,
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );
  return 1;
}
