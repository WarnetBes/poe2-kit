/**
 * MCP-инструменты: гид по прокачке (точные зоны актов).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerLevelingTools(server: McpServer): number {
  server.registerTool(
    'poe2_leveling_plan',
    {
      title: 'PoE2 Leveling Plan',
      description: `План прокачки персонажа PoE2: точные зоны Актов 1–4 с уровнями монстров, квестовыми наградами и заметками.

Аргументы:
  - act (number, опц.): номер акта (1-4). Если не указан — весь план целиком.
  - from_level (number, опц.): показывать зоны с уровня монстров не ниже этого.

Источник: path-of-levelling-2 (автор Kami-Guru метод), данные зон и наград.

Примеры:
  - "Куда идти в Акте 2?" → act=2
  - "Что дают награды?" → весь план
`,
      inputSchema: {
        act: z.number().int().min(1).max(4).optional().describe('Номер акта (1-4)'),
        from_level: z.number().int().optional().describe('Мин. уровень монстров'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ act, from_level }) => {
      try {
        let plan = core.leveling.getLevelingPlan();
        if (act != null) plan = plan.filter((z) => z.act === act);
        if (from_level != null) plan = plan.filter((z) => z.monsterLevel >= from_level!);
        if (!plan.length) {
          return { content: [{ type: 'text', text: 'Нет зон по заданным фильтрам.' }] };
        }
        const lines = [`## План прокачки PoE2${act ? ` — Акт ${act}` : ''}`, ''];
        for (const z of plan) {
          const steps = z.steps.length ? z.steps.map((s) => `    - ${s}`).join('\n') : '';
          const rewards = z.rewards.length ? ` *(награда: ${z.rewards.join('; ')})*` : '';
          lines.push(`**Акт ${z.act} · ${z.zone}** (уровень ${z.monsterLevel})${rewards}`);
          if (steps) lines.push(steps);
          lines.push('');
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );

  return 1;
}