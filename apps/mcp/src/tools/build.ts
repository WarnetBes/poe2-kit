/**
 * MCP-инструменты: билды (декод PoB, сводка).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerBuildTools(server: McpServer): number {
  server.registerTool(
    'poe2_build_decode',
    {
      title: 'PoE2 Decode Build (PoB)',
      description: `Декодировать share-код билда PoB (Path of Building PoE2) в XML и структуру.

Аргументы:
  - code (string): share-код (обычно начинается с "AA...").
  - as_xml (boolean, опц.): если true — вернуть сырой XML (по умолчанию false).

Возвращает декодированный XML (или структуру BuildImport: класс, уровень, скиллы,
узлы дерева, снаряжение).

Примеры:
  - "Разбери мой билд" → вставь share-код
`,
      inputSchema: {
        code: z.string().min(5).describe('PoB share-код'),
        as_xml: z.boolean().optional().describe('Вернуть сырой XML'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ code, as_xml }) => {
      try {
        const xml = core.build.decodeShareCode(code);
        if (as_xml) {
          return { content: [{ type: 'text', text: xml }] };
        }
        const imported = await core.build.importBuild(xml);
        const text = [
          '## Билд (PoB)',
          `- **Класс:** ${imported.class ?? '—'}`,
          `- **Аскандаси:** ${imported.ascendancy ?? '—'}`,
          `- **Уровень:** ${imported.level ?? '—'}`,
          imported.skills.length ? `- **Скиллы:** ${imported.skills.join(', ')}` : null,
          imported.passiveNodes.length ? `- **Узлы пассивок:** ${imported.passiveNodes.length}` : null,
          imported.gear && Object.keys(imported.gear).length
            ? `- **Снаряжение:** ${Object.entries(imported.gear)
                .map(([slot, v]) => `${slot}: ${v}`)
                .join('; ')}`
            : null,
        ].filter(Boolean);
        return { content: [{ type: 'text', text: text.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка декода: ${msg}` }] };
      }
    },
  );

  server.registerTool(
    'poe2_build_summary',
    {
      title: 'PoE2 Build Summary',
      description: `Краткая человекочитаемая сводка по XML билда PoB.

Аргументы:
  - xml (string): декодированный XML-контент PathOfBuilding.

Возвращает компактный обзор: класс/аскандаси, уровень, основные скиллы, узлы и снаряжение.
`,
      inputSchema: {
        xml: z.string().min(20).describe('XML PathOfBuilding'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ xml }) => {
      try {
        const imported = await core.build.importBuild(xml);
        const text = `## Сводка билда\n\n- **Класс:** ${imported.class ?? '—'}\n- **Уровень:** ${imported.level ?? '—'}\n- **Скиллы:** ${imported.skills.join(', ') || '—'}\n- **Узлы пассивок:** ${imported.passiveNodes.length}\n- **Снаряжение:** ${Object.entries(imported.gear).map(([slot, v]) => `${slot}: ${v}`).join('; ') || '—'}`;
        return { content: [{ type: 'text', text }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );

  server.registerTool(
    'poe2_build_price',
    {
      title: 'PoE2 Price Whole Build',
      description: `Оценить цену всего снаряжения билда разом (прайс-чек каждого предмета из импортированного билда PoB).

Аргументы:
  - code (string): share-код билда PoB (или ссылка pobb.in/pastebin, или сырой XML).
  - league (string, опц.): лига (по умолчанию — текущая активная).

Возвращает отчёт по каждому предмету снаряжения: слот, имя, редкость, медианная цена,
оценка min/max, источники и число найденных объявлений, а также суммарную нижнюю
границу стоимости и число предметов с известной ценой.

Примеры:
  - "Сколько стоит собрать этот билд?" → вставь share-код
  - "Оцени всё снаряжение моего билда по живым ценам"
`,
      inputSchema: {
        code: z.string().min(5).describe('PoB share-код / ссылка / XML билда'),
        league: z.string().optional().describe('Лига (по умолчанию активная)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ code, league }) => {
      try {
        const report = await core.trade.priceBuild(code, { league });
        const lines: string[] = [
          `## Прайс-чек билда`,
          `- **Лига:** ${report.league ?? '—'}`,
          `- **Предметов обработано:** ${report.totalItems}`,
          `- **Оценено цен:** ${report.pricedCount}`,
          `- **Суммарная нижняя граница:** ${report.totalMin.toFixed(2)} ${report.league ?? ''}`,
          `- **Время:** ${report.elapsedMs} мс`,
          ``,
          `| Слот | Имя | Редкость | Медиана | Оценка (min–max) | Объявл. |`,
          `| --- | --- | --- | --- | --- | --- |`,
        ];
        for (const it of report.items) {
          const median = it.estimate?.median;
          const range = it.estimate
            ? `${it.estimate.min.toFixed(2)}–${it.estimate.max.toFixed(2)}`
            : '—';
          lines.push(
            `| ${it.slot || '—'} | ${it.name || '—'} | ${it.rarity} | ${median != null ? median.toFixed(2) : '—'} | ${range} | ${it.listingsCount} |`,
          );
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка прайс-чека билда: ${msg}` }] };
      }
    },
  );

  return 3;
}