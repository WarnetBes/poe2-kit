/**
 * MCP-инструмент: poe2_resist_pairs — W3-3.
 *
 * План закрытия резист-капов ПАРАМИ предметов: какие слоты и с какими
 * минимумами стихий искать на trade (готовые label-min для poe2_trade_search).
 * Эвристика распределения, честные границы в core/resistPairs.ts.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

const RU_EL: Record<string, string> = { fire: 'огонь', cold: 'холод', lightning: 'молния', chaos: 'хаос' };
const LABEL: Record<string, string> = { fire: 'Fire Res', cold: 'Cold Res', lightning: 'Lightning Res', chaos: 'Chaos Res' };

export function registerResistPairsTools(server: McpServer): number {
  server.registerTool(
    'poe2_resist_pairs',
    {
      title: 'PoE2 Resist Pair Planner',
      description: `План закрытия резист-капов ВМЕСТЕ: скажите текущие резисты (панель игры) — получите 1-2 варианта пар предметов (кольцо/пояс/амулет/…) с готовыми минимумами стихий для trade-поиска. Один большой дефицит (>60) даёт сплит-пару «два предмета по половине» (дешевле одного максимального ролла); два дефицита дают пару «каждая стихия своим предметом» + компакт-вариант «один предмет с двойным резом» (редкий ролл). Chaos по умолчанию НЕ считается (CI-билдам не нужен), включается параметром.

Это план-распределение, НЕ оптимизация цены: листинги по каждому слоту проверяйте отдельным poe2_trade_search (значения needs → stat_overrides).`,
      inputSchema: {
        fire: z.number().int().min(-200).max(200).describe('Текущий Fire Resistance (панель)'),
        cold: z.number().int().min(-200).max(200).describe('Текущий Cold Resistance'),
        lightning: z.number().int().min(-200).max(200).describe('Текущий Lightning Resistance'),
        chaos: z.number().int().min(-200).max(200).optional().describe('Текущий Chaos Resistance (если считаете)'),
        include_chaos: z.boolean().optional().describe('Считать хаос-дефицит (default false — CI)'),
        cap: z.number().int().min(50).max(95).optional().describe('Кап (default 75)'),
        buffer: z.number().int().min(0).max(30).optional().describe('Буфер над капом (default 5 — панель гуляет)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ fire, cold, lightning, chaos, include_chaos, cap, buffer }) => {
      try {
        const plans = core.resistPairs.planResistPairs({
          resists: { fire, cold, lightning, ...(chaos != null ? { chaos } : {}) },
          includeChaos: include_chaos ?? false,
          ...(cap != null ? { cap } : {}),
          ...(buffer != null ? { buffer } : {}),
        });
        const lines: string[] = ['## Резист-пары: план закрытия капов', ''];
        for (let i = 0; i < plans.length; i++) {
          const p = plans[i]!;
          lines.push(`**Вариант ${i + 1}.** ${p.summary}`, '');
          for (const s of p.slots) {
            const needs = Object.entries(s.needs as Record<string, number>)
              .map(([el, min]) => `${LABEL[el] ?? el} ≥ ${min} (${RU_EL[el] ?? el})`)
              .join(' И ');
            lines.push(`- ${s.slotName} [категория trade: ${s.slotCategory}]: ${needs}`);
          }
          const remains = Object.entries(p.remains as Record<string, number>);
          if (remains.length) {
            lines.push(`- ⚠ Остаётся закрыть отдельно: ${remains.map(([e, g]) => `${RU_EL[e] ?? e} −${g}`).join(', ')}`);
          }
          lines.push('');
        }
        lines.push('_Эвристика распределения; листинги по каждой паре проверяйте poe2_trade_search/stat_overrides — цены здесь не оптимизируются._');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка резист-плана: ${msg}` }] };
      }
    },
  );

  return 1;
}
