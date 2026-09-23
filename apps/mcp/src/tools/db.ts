/**
 * MCP-инструменты: база данных предметов/модов RePoE.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerDbTools(server: McpServer): number {
  server.registerTool(
    'poe2_items_db',
    {
      title: 'PoE2 Item Base (RePoE)',
      description: `Информация о базовом предмете PoE2 из базы RePoE (по базовому типу или имени).

Аргументы:
  - name (string): имя базового типа, напр. "Focus", "Iron Greaves", "Wand".

Возвращает: базовый тип, слот/класс, теги, требования, параметры (армор/ES/ev и т.п.).

Примеры:
  - "Что за база Iron Greaves?"
  - "Параметры шаманского посоха"
`,
      inputSchema: {
        name: z.string().min(2).describe('Имя базового типа предмета'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ name }) => {
      try {
        const item = await core.repoe.lookupBaseItem(name);
        if (!item) {
          return { content: [{ type: 'text', text: `База "${name}" не найдена в RePoE.` }] };
        }
        const req = [
          item.reqLevel != null ? `L${item.reqLevel}` : null,
          item.reqStr != null ? `${item.reqStr} Str` : null,
          item.reqDex != null ? `${item.reqDex} Dex` : null,
          item.reqInt != null ? `${item.reqInt} Int` : null,
        ].filter(Boolean).join(', ');
        const lines: string[] = [
          `## База: ${item.name}`,
          `- **Класс:** ${item.itemClass ?? '—'}`,
          `- **Теги:** ${item.tags?.join(', ') || '—'}`,
          `- **Броня:** ${item.baseArmour ?? '—'}`,
          `- **Уклонение:** ${item.baseEvasion ?? '—'}`,
          `- **Энерг. щит:** ${item.baseEs ?? '—'}`,
        ];
        if (item.basePhysDamageMin != null) {
          lines.push(`- **Физ. урон:** ${item.basePhysDamageMin}-${item.basePhysDamageMax}`);
        }
        if (item.baseCritChance != null) lines.push(`- **Крит:** ${item.baseCritChance}%`);
        if (item.baseAttackTime != null) lines.push(`- **Атак/сек:** ${item.baseAttackTime}`);
        lines.push(`- **Требования:** ${req || '—'}`);
        if (item.dropLevel != null) lines.push(`- **Уровень выпадения:** ${item.dropLevel}`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );

  server.registerTool(
    'poe2_mod_tier',
    {
      title: 'PoE2 Mod Tier',
      description: `Определить тир мода предмета PoE2 по его тексту (по базе RePoE).

Аргументы:
  - mod_text (string): текст мода, напр. "Adds 10 to 20 Physical Damage".
  - tags (string[]): теги предмета (например ["body_armour", "str"]).
  - item_level (int, опц.): уровень предмета для расчёта доступного тира.

Возвращает тир, диапазон значений, лучший тир на данном ilvl, имя аффикса.
`,
      inputSchema: {
        mod_text: z.string().min(3).describe('Текст мода'),
        tags: z.array(z.string()).default([]).describe('Теги предмета'),
        item_level: z.number().int().optional().describe('Item Level'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ mod_text, tags, item_level }) => {
      try {
        const r = await core.repoe.matchSingleModTier(mod_text, tags, item_level ?? null);
        if (!r) {
          return { content: [{ type: 'text', text: `Не удалось определить тир мода "${mod_text}".` }] };
        }
        const lines = [
          `## Тир мода: ${r.affixName}`,
          `- **Тир:** ${r.tier}/${r.totalTiers}`,
          `- **Диапазон:** ${r.range[0]}-${r.range[1]}`,
          `- **Аффикс:** ${r.prefixSuffix}`,
        ];
        if (r.bestTierAtIlvl != null) lines.push(`- **Лучший тир на ilvl ${item_level}:** ${r.bestTierAtIlvl}`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );

  return 2;
}