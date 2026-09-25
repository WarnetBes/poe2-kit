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
  - monk (boolean, опц.): true — обогатить план советами Ice Strike Monk (камни/экипировка).

Источник: path-of-levelling-2 (автор Kami-Guru метод), данные зон и наград.

Примеры:
  - "Куда идти в Акте 2?" → act=2
  - "Что дают награды?" → весь план
  - "Гид Ice Strike Monk" → monk=true
`,
      inputSchema: {
        act: z.number().int().min(1).max(4).optional().describe('Номер акта (1-4)'),
        from_level: z.number().int().optional().describe('Мин. уровень монстров'),
        monk: z.boolean().optional().describe('Показать советы Ice Strike Monk'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ act, from_level, monk }) => {
      try {
        let plan = monk
          ? core.leveling.getMonkLevelingPlan()
          : core.leveling.getLevelingPlan();
        if (act != null) plan = plan.filter((z) => z.act === act);
        if (from_level != null) plan = plan.filter((z) => z.monsterLevel >= from_level!);
        if (!plan.length) {
          return { content: [{ type: 'text', text: 'Нет зон по заданным фильтрам.' }] };
        }
        const lines = [
          `## ${monk ? 'План прокачки Ice Strike Monk' : 'План прокачки PoE2'}${act ? ` — Акт ${act}` : ''}`,
          '',
        ];
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

  server.registerTool(
    'poe2_leveling_monk',
    {
      title: 'PoE2 Ice Strike Monk Leveling Tips',
      description: `Билд-специфичные советы прокачки Ice Strike Monk: какие камни/способности использовать, приоритеты экипировки и механика по диапазонам уровней (Акты 1–4).

Аргументы:
  - level (number, опц.): текущий уровень персонажа — вернуть только советы для этого диапазона.

Примеры:
  - "Что брать монаху в начале?" → без level
  - "Мне 30 уровень, что делать Ice Strike Monk?" → level=30
`,
      inputSchema: {
        level: z.number().int().min(1).optional().describe('Текущий уровень персонажа'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ level }) => {
      try {
        const tips = core.leveling.getMonkLevelingTips(level);
        const lines = ['## Ice Strike Monk — советы прокачки', ''];
        if (!tips.length) {
          lines.push(core.leveling.getMonkLevelingHint(level));
        }
        for (const t of tips) {
          const range = t.toLevel == null ? `${t.fromLevel}+` : `${t.fromLevel}–${t.toLevel}`;
          lines.push(`**Уровни ${range}**:`);
          if (t.gems?.length) lines.push(`  - Камни: ${t.gems.join(', ')}`);
          if (t.gear?.length) lines.push(`  - Экипировка: ${t.gear.join('; ')}`);
          if (t.notes?.length) {
            for (const n of t.notes) lines.push(`  - ${n}`);
          }
          lines.push('');
        }
        lines.push('_Совет: Ice Strike конвертит физику в холод — собирайте физический quarterstaff, крит и холодный адд-урон._');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );

  return 2;
}