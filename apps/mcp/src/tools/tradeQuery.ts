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
  - tolerance (number, опц., 0..50, по умолч. 20): допуск вниз В ПРОЦЕНТАХ — автозаполненные минимумы (ar/ev/es/DPS) и моды ищутся не ниже floor(value×(100−tolerance)/100).
  - stat_overrides (массив, опц.): явные фильтры ПО ИМЕНИ стата с приоритетом над автозаполнением — [{name:'es', min:500}, {name:'Evasion', disabled:true}, {name:'pseudo.pseudo_total_life', min:80}]. Имена: ar/armour, ev/evasion, es/energy shield, dps/pdps/edps, label мода ('Fire Res', 'Spirit') или готовый stat-id.
  - gear (string[], опц.): клир-тексты ЭКИПИРОВАННЫХ предметов (ваш текущий гир) — для auto_weights.
  - auto_weights (boolean, опц.): «найти апгрейд с учётом билда» — веса статов считаются из gear (статы, которые гир stack'ает = ваши приоритеты: жизнь/резисты/ES/дух/скорость/атрибуты; уники игнорируются, double-count локальных модов исключён) и превращаются в stat-фильтры с min = средний ролл − tolerance. Приоритет: ваши stat_overrides выше.
  - price_max (number, опц.): потолок цены в хаосах для фильтра запроса.
  - limit (number, опц., по умолч. 10): сколько листингов вернуть при execute=true.

Без execute=true просто выдаёт JSON-запрос — его можно показать пользователю для ручного поиска на сайте trade.
`,
      inputSchema: {
        item_text: z.string().min(5).describe('Клир-текст предмета'),
        execute: z.boolean().optional().describe('Выполнить запрос (живые листинги)'),
        league: z.string().optional().describe('Лига'),
        tolerance: z.number().int().min(0).max(100).optional().describe('Допуск вниз для статов, % (эфф. 0..50)'),
        stat_overrides: z.array(z.object({
          name: z.string().min(1).describe('Имя стата: ar/ev/es/dps/pdps/edps (и алиасы), label мода или stat-id'),
          min: z.number().optional(),
          max: z.number().optional(),
          disabled: z.boolean().optional().describe('Убрать фильтр из запроса'),
        })).optional().describe('Явные min/max по имени стата (приоритет над автозаполнением)'),
        gear: z.array(z.string().min(5)).optional().describe('Клир-тексты экипированных предметов (для auto_weights)'),
        auto_weights: z.boolean().optional().describe('Веса статов из гира → stat-фильтры («апгрейд с учётом билда»)'),
        price_max: z.number().positive().optional().describe('Потолок цены (хаос)'),
        limit: z.number().int().min(1).max(20).optional().describe('Листингов'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ item_text, execute, league, tolerance, stat_overrides, gear, auto_weights, price_max, limit }) => {
      try {
        // W3-2: автовеса из гира → stat-фильтры «апгрейд с учётом билда».
        // Приоритет: явные stat_overrides пользователя ВЫШЕ автовесов.
        let overrides = stat_overrides;
        // №696 P2-5: один расчёт фокуса на запрос (раньше double parseItemText гира).
        const gearFocus = auto_weights && gear?.length ? core.autoWeights.suggestGearFocus(gear) : [];
        if (gearFocus.length) {
          const auto = core.autoWeights.gearFocusToOverrides(gearFocus, tolerance ?? 20);
          const names = new Set((stat_overrides ?? []).map((o) => o.name.toLowerCase()));
          const merged = [...(stat_overrides ?? [])];
          for (const a of auto) {
            if (!names.has(a.name.toLowerCase())) merged.push(a);
          }
          overrides = merged;
        }
        const payload = core.tradeQuery.buildTradeQueryFromItem(item_text, {
          tolerancePct: tolerance, // % (кап 50 enforced в core)
          statOverrides: overrides,
          priceMax: price_max,
        });
        const lines: string[] = ['## Trade-запрос (официальный trade2 API PoE2)', ''];
        if (gearFocus.length) {
          lines.push('### Автовеса из вашего гира (стат → слотов × средний ролл → фильтр min)', '');
          for (const f of gearFocus) {
            lines.push(`- ${f.label}: ${f.slots} слот(ов), ролл ~${f.avgValue} → min ${f.suggestedMin}${tolerance ? ` (после tolerance −${tolerance}%: ${Math.max(1, Math.floor((f.suggestedMin * (100 - Math.min(tolerance ?? 20, 50))) / 100))})` : ''}`);
          }
          lines.push('');
        }
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
