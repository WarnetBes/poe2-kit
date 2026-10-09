/**
 * MCP-тул `poe2_simulacrum_guide` (№239 Phase-2): энциклопедия + гайд
 * по активности Simulacrum (Delirium 0.5.x) — офлайн, без запросов.
 *
 * Данные — core.simulacrum (тот же источник, что web-вкладка «🌀 Simulacrum»):
 * факты, цепочка доступа, волны, шарды, боссы, лут, стратегии, атлас-ноды,
 * чек-лист. Спорные факты помечены «unverified» — честность вместо
 * выдуманных чисел (механизм №236/№222).
 *
 * Вход: section (опц., по умолчанию 'all'). Выход: markdown-гайд +
 * structured {section, facts, waves, bosses, checklist} для машинных сценариев.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core, SIM_SECTIONS, SIM_FACTS, SIM_WAVES, SIM_BOSSES, SIM_CHECKLIST, SIM_OPEN_QUESTIONS } from '@poe2-kit/core';
import type { SimSection } from '@poe2-kit/core';

/** Регистрация тула `poe2_simulacrum_guide`. Возвращает число добавленных инструментов (1). */
export function registerSimulacrumTools(server: McpServer): number {
  server.registerTool(
    'poe2_simulacrum_guide',
    {
      title: 'PoE2 Simulacrum Guide',
      description: `Гайд по Simulacrum (Delirium, PoE2 0.5.x) — офлайн: цепочка доступа (зеркала → Fog Bank → предмет), 7 волн, Fracturing Shards, боссы (Kosis / Omniphobia / Tang'Mazu) с телеграфами и ответами, лут и экономика (Voices-джекпот), стратегии, атлас-ноды Delirium, чек-лист готовности. Спорные факты помечены «unverified» — без выдуманных чисел.

Вход:
  - section (string, опц.): 'all' (по умолчанию) | 'overview' | 'access' | 'waves' | 'bosses' | 'loot' | 'strategy' | 'atlas' | 'checklist'.

Примеры:
  - "Как работает Simulacrum в PoE2?" → section: all
  - "Чек-лист перед Simulacrum" → section: checklist
  - "Что роняет Kosis?" → section: bosses`,
      inputSchema: {
        section: z
          .enum(SIM_SECTIONS as [SimSection, ...SimSection[]])
          .optional()
          .describe('Какой блок гайда вернуть (по умолчанию all)'),
      },
      outputSchema: {
        section: z.string(),
        markdown: z.string(),
        facts: z.array(z.any()),
        waves: z.array(z.any()),
        bosses: z.array(z.any()),
        checklist: z.array(z.string()),
        open_questions: z.array(z.any()).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ section }) => {
      try {
        const sec: SimSection = (section as SimSection | undefined) ?? 'all';
        const markdown = core.simulacrum.simulacrumGuideMarkdown(sec);
        if (markdown == null) {
          return {
            content: [{ type: 'text' as const, text: `Неизвестная секция «${String(sec)}». Доступны: ${SIM_SECTIONS.join(', ')}.` }],
            isError: true,
          };
        }
        const payload = {
          section: sec,
          markdown,
          facts: SIM_FACTS,
          waves: SIM_WAVES,
          bosses: SIM_BOSSES.map((b) => ({ name: b.name, sub: b.sub, tags: b.tags, attacks: b.attacks, note: b.note, noteUnverified: b.noteUnverified })),
          checklist: SIM_CHECKLIST,
          open_questions: SIM_OPEN_QUESTIONS,
        };
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: payload,
        };
      } catch (e) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Ошибка simulacrum_guide: ${e instanceof Error ? e.message : String(e)}` }],
        };
      }
    },
  );
  return 1;
}
