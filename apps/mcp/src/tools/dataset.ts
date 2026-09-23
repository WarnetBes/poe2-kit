/**
 * MCP-инструменты: офлайн-датасеты PoE2 (гемы, дерево пассивок, асценданси).
 * Работают БЕЗ сети — данные скопированы из hivemind-poe2-mcp (см. data/README.md).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerDatasetTools(server: McpServer): number {
  let count = 0;

  // ── Информация о датасетах + асценданси ──────────────────────────────────
  server.registerTool(
    'poe2_dataset_info',
    {
      title: 'PoE2 Offline Dataset Info',
      description: `Версия офлайн-датасетов PoE2 (патч, ревизия) и счётчики записей. Опционально: список асценданси-классов (все или по базовому классу: Monk, Warrior, Sorceress, Ranger, Mercenary, Huntress, Witch, Druid, Blood Mage...).

Аргументы:
  - ascendancy_class (string, опц.): базовый класс — показать только его асценданси.
`,
      inputSchema: {
        ascendancy_class: z.string().optional().describe('Базовый класс для фильтра асценданси'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ ascendancy_class }) => {
      const v = core.dataset.getDatasetVersion();
      const lines = [
        '## Офлайн-датасеты PoE2 Kit',
        '',
        `- Патч: **${v.patch_version} «${v.patch_name}»** (ревизия данных ${v.data_revision}, ${v.released_as})`,
        `- Извлечено: ${v.extracted_at}`,
        `- Источник: hivemind-poe2-mcp (извлечение из файлов игры)`,
        '',
      ];
      const ascs = ascendancy_class
        ? core.dataset.getAscendanciesByClass(ascendancy_class)
        : core.dataset.getAscendancies();
      lines.push(`### Асценданси${ascendancy_class ? ` (${ascendancy_class})` : ''} — ${ascs.length}`);
      for (const a of ascs) lines.push(`- **${a.displayName}** (${a.baseClass})`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
  count++;

  // ── Поиск гемов ───────────────────────────────────────────────────────────
  server.registerTool(
    'poe2_gems_lookup',
    {
      title: 'PoE2 Skill Gems Lookup (offline)',
      description: `Поиск активных гемов PoE2 в ОФФЛАЙН-датасете (патч 0.5): имя, теги скиллов, время каста, стоимость маны по уровням, максимум уровней.

Аргументы:
  - query (string, обяз.): имя гема или его часть (например "Ice Strike").
  - details (boolean, опц., по умолч. false): полная запись первого совпадения — статы/стоимость по всем уровням.
  - limit (number, опц., по умолч. 5): сколько совпадений вернуть.
`,
      inputSchema: {
        query: z.string().min(2).describe('Имя гема или подстрока'),
        details: z.boolean().optional().describe('Полные детали первого совпадения'),
        limit: z.number().int().min(1).max(20).optional().describe('Сколько совпадений'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, details, limit }) => {
      const hits = core.dataset.searchSkillGems(query, limit ?? 5);
      if (!hits.length) {
        return { content: [{ type: 'text', text: `Гемы по запросу «${query}» не найдены.` }] };
      }
      const lines = [`## Гемы по запросу «${query}» — ${hits.length}`, ''];
      for (const g of hits) {
        const firstCost = g.firstLevelCost ? Object.entries(g.firstLevelCost).map(([k, n]) => `${n} ${k}`).join(', ') : '—';
        lines.push(
          `- **${g.name}** — теги: ${g.skillTypes.slice(0, 6).join(', ') || '—'}; каст ${g.castTime}с; макс. уровень ${g.maxLevel}; стоимость 1-го уровня: ${firstCost}`,
        );
      }
      if (details) {
        const d = core.dataset.getSkillGemDetails(hits[0]!.name);
        if (d) {
          lines.push('', `### ${d.name} — по уровням (${d.levels.length})`, '', '| Ур. | Треб. уровень | Стоимость |', '|---|---|---|');
          for (const l of d.levels) {
            const cost = Object.entries(l.cost).map(([k, n]) => `${n} ${k}`).join(', ') || '—';
            lines.push(`| ${d.levels.indexOf(l) + 1} | ${l.levelRequirement} | ${cost} |`);
          }
        }
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
  count++;

  // ── Поиск по дереву пассивок ─────────────────────────────────────────────
  server.registerTool(
    'poe2_tree_search',
    {
      title: 'PoE2 Passive Tree Search (offline)',
      description: `Поиск по дереву пассивок PoE2 (~9600 узлов, офлайн): по имени узла ИЛИ тексту статов. Показывает имя, тип (keystone/notable/обычная), статы.

Аргументы:
  - query (string, обяз.): имя узла или эффект (например "Shock chance", "Prolonged Shock").
  - keystones_only (boolean, опц.): только ключевыe узлы (keystones).
  - limit (number, опц., по умолч. 10): сколько узлов вернуть.
`,
      inputSchema: {
        query: z.string().min(2).describe('Имя узла или текст стата'),
        keystones_only: z.boolean().optional().describe('Только keystone-узлы'),
        limit: z.number().int().min(1).max(30).optional().describe('Сколько узлов'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, keystones_only, limit }) => {
      const nodes = core.dataset.searchPassiveTree(query, {
        limit: limit ?? 10,
        keystonesOnly: keystones_only,
      });
      if (!nodes.length) {
        return { content: [{ type: 'text', text: `Узлы по запросу «${query}» не найдены.` }] };
      }
      const lines = [`## Дерево пассивок: «${query}» — ${nodes.length}`, ''];
      for (const n of nodes) {
        const type = n.isKeystone ? '🔑 KEYSTONE' : n.isNotable ? '★ notable' : '· обычная';
        const asc = n.ascendancy ? ` (${n.ascendancy})` : '';
        lines.push(`- ${type}${asc} **${n.name}**: ${n.stats.join('; ')}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
  count++;

  return count;
}
