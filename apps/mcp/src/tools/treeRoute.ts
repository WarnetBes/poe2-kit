/**
 * MCP-инструменты: маршрут по дереву пассивок (gap №3, пробел sec6).
 *
 * Тонкая обёртка над core.treeRoute.treeRoute(): вход — старт (класс
 * и/или асценданси), список целей (имя | GGG-slug | числовой id),
 * опц. уже взятые узлы и уровневая смета. Выход — маршрут с очками,
 * milestones «взять к L~N» и честными хвостами (unresolved/deferred).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerTreeRouteTools(server: McpServer): number {
  server.registerTool(
    'poe2_tree_route',
    {
      title: 'PoE2 Passive Tree Route Planner',
      description: `Маршрут по дереву пассивок PoE2 (BFS, офлайн-layout GGG): от старта класса/асценданси до заданных keypoints (keystone/notable) с минимальным числом новых очков и уровневыми метками «взять к L~N» (оценка ±2 уровня).

Аргументы:
  - class (string, опц.): базовый класс старта (Monk/Warrior/Sorceress/…).
  - ascendancy (string, опц.): асценданси-старт (Invoker/Acolyte of Chayula/…) — можно вместо или вместе с class.
  - targets (string[], обяз.): keypoints (keystones/notables) — имя узла, GGG-slug или числовой node id. Неизвестные честно попадут в unresolved.
  - allocated (string[], опц.): уже взятые узлы (числовые id) — стартовый фронт, их очки не считаются.
  - level_budget (number, опц.): смета очков; цели сверх неё → deferred (их хватило бы позже).

Нужен хотя бы один старт: class, ascendancy или allocated. Порядок целей — жадный BFS (ближайшая цель сначала), не глобальный оптимум; метки уровней — оценка.`,
      inputSchema: {
        class: z.string().optional().describe('Базовый класс старта (Monk, Warrior, …)'),
        ascendancy: z.string().optional().describe('Асценданси-старт (Invoker, …)'),
        targets: z
          .array(z.string().min(1))
          .min(1)
          .describe('Цели: имя узла | GGG-slug | числовой node id'),
        allocated: z
          .array(z.string().min(1))
          .optional()
          .describe('Уже взятые узлы (числовые id)'),
        level_budget: z.number().int().min(0).optional().describe('Смета очков; цели сверх → deferred'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ class: className, ascendancy, targets, allocated, level_budget }) => {
      try {
        if (!className && !ascendancy && !(allocated ?? []).length) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Не задан старт: укажите class, ascendancy или хотя бы один allocated-узел.',
              },
            ],
          };
        }
        const result = core.treeRoute.treeRoute({
          classStart: className,
          ascendancy,
          targets: targets ?? [],
          allocated,
          levelBudget: level_budget,
        });
        if (!result) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Маршрут не построен: ни одна цель не распознана, либо старт (класс/асценданси/allocated) не найден в дереве. Проверьте написание целей/старта.',
              },
            ],
          };
        }
        const lines: string[] = ['## Маршрут по дереву пассивок', ''];
        lines.push(
          `Старт: ${result.startNodeIds.length ? result.startNodeIds.join(', ') : '—'} | Новых очков: **${result.totalPoints}**`,
        );
        lines.push('', '### Milestones', '', '| # | Цель | Тип | Очков (этап/всего) | Взять к |', '|---|---|---|---|---|');
        result.milestones.forEach((m, i) => {
          const stepType = m.steps.at(-1)?.nodeType ?? 'allocated/start';
          lines.push(
            `| ${i + 1} | ${m.targetName} | ${stepType} | ${m.legPoints} / ${m.cumPoints} | ${m.takeByLevel != null ? `L~${m.takeByLevel}` : '—'} |`,
          );
        });
        if (result.steps.length) {
          lines.push('', '### Шаги маршрута', '');
          let leg = -1;
          for (const s of result.steps) {
            if (s.legIndex !== leg) {
              leg = s.legIndex;
              lines.push(`**Этап ${leg + 1} → ${result.milestones[leg]?.targetName ?? '?'}**`);
            }
            const lvl = s.takeByLevel != null ? ` (к L~${s.takeByLevel})` : '';
            lines.push(`- ${s.name} [${s.nodeType}]${s.isTarget ? ' ← цель' : ''}${lvl}`);
          }
        }
        const honesty: string[] = [];
        if (result.unresolved.length) honesty.push(`- ⚠️ Не распознаны: ${result.unresolved.join(', ')}`);
        if (result.unreachable.length) honesty.push(`- ⚠️ Недостижимы из старта: ${result.unreachable.join(', ')}`);
        if (result.deferred.length) honesty.push(`- ⏸️ Отложены (сверх level_budget): ${result.deferred.join(', ')}`);
        if (honesty.length) lines.push('', '### Хвосты', '', ...honesty);
        lines.push('', `_${result.estimated}_`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка маршрута: ${msg}` }] };
      }
    },
  );

  return 1;
}
