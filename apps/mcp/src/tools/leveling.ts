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
  - class (string, опц.): базовый класс ИЛИ асценданси ('Warrior', 'Sorceress', 'Ranger', 'Mercenary', 'Witch', 'Druid', 'Huntress', 'Monk', либо 'Invoker', 'Lich', 'Titan', 'Deadeye', ...) — обогатить план советами этого класса (камни/экипировка/механика).
  - monk (boolean, опц., deprecated): true — то же, что class='Monk'.

Источник: path-of-levelling-2 (автор Kami-Guru метод), данные зон и наград.

Примеры:
  - "Куда идти в Акте 2?" → act=2
  - "Что дают награды?" → весь план
  - "Гид прокачки Witch" → class=Witch
  - "Гид Ice Strike Monk" → class=Monk
`,
      inputSchema: {
        act: z.number().int().min(1).max(4).optional().describe('Номер акта (1-4)'),
        from_level: z.number().int().optional().describe('Мин. уровень монстров'),
        class: z.string().optional().describe('Класс или асценданси для советов (Warrior/Invoker/...)'),
        monk: z.boolean().optional().describe('deprecated: советы Ice Strike Monk (= class=Monk)'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ act, from_level, class: klass, monk }) => {
      try {
        const query = klass ?? (monk ? 'Monk' : undefined);
        const guide = query ? core.leveling.resolveLevelingClass(query) : null;
        let plan = guide
          ? core.leveling.getClassLevelingPlan(query)
          : core.leveling.getLevelingPlan();
        if (act != null) plan = plan.filter((z) => z.act === act);
        if (from_level != null) plan = plan.filter((z) => z.monsterLevel >= from_level!);
        if (!plan.length) {
          return { content: [{ type: 'text', text: 'Нет зон по заданным фильтрам.' }] };
        }
        const label = guide ? `План прокачки ${guide.baseClass}` : 'План прокачки PoE2';
        const lines = [
          `## ${label}${act ? ` — Акт ${act}` : ''}`,
          '',
        ];
        for (const z of plan) {
          const steps = z.steps.length ? z.steps.map((s) => `    - ${s}`).join('\n') : '';
          const rewards = z.rewards.length ? ` *(награда: ${z.rewards.join('; ')})*` : '';
          const wp = z.hasWaypoint ? ' ⚑вояпоинт' : '';
          lines.push(`**Акт ${z.act} · ${z.zone}** (уровень ${z.monsterLevel})${wp}${rewards}`);
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
    'poe2_leveling_class',
    {
      title: 'PoE2 Class Leveling Tips (any class)',
      description: `Билд-специфичные советы прокачки ЛЮБОГО класса PoE2: какие камни/способности использовать, приоритеты экипировки и механика по диапазонам уровней (Акты 1–4 + эндгейм).

Поддерживаются все 8 базовых классов и все асценданси: Monk/Invoker, Warrior/Titan, Sorceress/Stormweaver, Ranger/Deadeye, Mercenary/Witchhunter, Witch/Lich, Druid, Huntress/Amazon — передайте любой вариант, он будет резолвлен в базовый класс.

Аргументы:
  - class (string, опц.): базовый класс или асценданси ('Warrior', 'Invoker', 'Lich', 'Deadeye', ...). По умолчанию — Monk.
  - level (number, опц.): текущий уровень персонажа — вернуть только советы этого диапазона.
  - list (boolean, опц.): true — вернуть список всех классов с краткой характеристикой.

Примеры:
  - "Что брать ведьме в начале?" → class=Witch
  - "Гид прокачки Lich" → class=Lich
  - "Мне 30 ур, советы воину" → class=Warrior, level=30
  - "Какие классы бывают?" → list=true
`,
      inputSchema: {
        class: z.string().optional().describe('Класс или асценданси (Warrior/Invoker/...)'),
        level: z.number().int().min(1).optional().describe('Текущий уровень персонажа'),
        list: z.boolean().optional().describe('Показать список всех классов'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ class: klass, level, list }) => {
      try {
        if (list) {
          const classes = core.leveling.listLevelingClasses();
          const lines = ['## Классы PoE2 — гиды прокачки', ''];
          for (const c of classes) {
            lines.push(`- **${c.baseClass}** (${c.tipCount} диапазонов): ${c.tagline}`);
          }
          lines.push('');
          lines.push('_Передайте class (или асценданси) для деталей. Асценданси всех классов: poe2_dataset_info._');
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
        const guide = core.leveling.resolveLevelingClass(klass) ?? core.leveling.resolveLevelingClass('Monk')!;
        const tips = core.leveling.getClassLevelingTips(klass ?? guide.baseClass, level);
        const lines = [
          `## ${guide.baseClass} — советы прокачки`,
          `_${guide.tagline}_`,
          `Урон: ${guide.damage.join('; ')}`,
          `Защита: ${guide.defense.join('; ')}`,
          '',
        ];
        if (!tips.length) {
          lines.push(core.leveling.getClassLevelingHint(klass ?? guide.baseClass, level));
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
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );

  return 2;
}