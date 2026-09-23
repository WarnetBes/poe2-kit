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

  // ── Саппорт-гемы ──────────────────────────────────────────────────────────
  server.registerTool(
    'poe2_support_gems_lookup',
    {
      title: 'PoE2 Support Gems Lookup (offline)',
      description: `Поиск саппорт-гемов PoE2 в ОФФЛАЙН-датасете (680 шт., патч 0.5): по имени («Concentrated» → Concentrated Area Support). Показывает id, совместимость (compatible_with).

Аргументы:
  - query (string, обяз.): имя гема или подстрока.
  - limit (number, опц., по умолч. 10): сколько совпадений.
`,
      inputSchema: {
        query: z.string().min(2).describe('Имя саппорт-гема или подстрока'),
        limit: z.number().int().min(1).max(30).optional().describe('Сколько совпадений'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      const hits = core.dataset.searchSupportGems(query, limit ?? 10);
      if (!hits.length) {
        return { content: [{ type: 'text', text: `Саппорт-гемы по запросу «${query}» не найдены.` }] };
      }
      const lines = [`## Саппорт-гемы: «${query}» — ${hits.length}`, ''];
      for (const g of hits) {
        lines.push(
          `- **${g.name}** (${g.id})` +
            (g.compatible_with.length ? ` — подходит для: ${g.compatible_with.slice(0, 4).join(', ')}` : ''),
        );
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
  count++;

  // ── Узлы асценданси ────────────────────────────────────────────────────────
  server.registerTool(
    'poe2_ascendancy_nodes',
    {
      title: 'PoE2 Ascendancy Nodes (offline)',
      description: `Узлы деревьев асценданси PoE2 (429 узлов, офлайн): все узлы конкретной асценданси ИЛИ поиск по имени/тексту статов.

Аргументы:
  - ascendancy (string, опц.): имя асценданси (например "Invoker", "Pathfinder") — показать все её узлы.
  - query (string, опц.): поиск узла по имени или тексту стата (например "Sustainable Practices", "Elemental").
  - notables_only (boolean, опц.): только notable-узлы.
Один из аргументов обязателен.
`,
      inputSchema: {
        ascendancy: z.string().optional().describe('Имя асценданси — все её узлы'),
        query: z.string().optional().describe('Поиск по имени узла/тексту стата'),
        notables_only: z.boolean().optional().describe('Только notable-узлы'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ ascendancy, query, notables_only }) => {
      let nodes;
      if (ascendancy) {
        nodes = core.dataset.getAscendancyNodesByName(ascendancy);
        if (notables_only) nodes = nodes.filter((n) => n.kind === 'notable');
      } else if (query) {
        nodes = core.dataset.searchAscendancyNodes(query, { notablesOnly: notables_only, limit: 20 });
      } else {
        return { isError: true, content: [{ type: 'text', text: 'Укажите ascendancy или query.' }] };
      }
      if (!nodes.length) {
        return { content: [{ type: 'text', text: 'Узлы не найдены.' }] };
      }
      const label = ascendancy ? `Асценданси ${ascendancy}` : `Узлы: «${query}»`;
      const lines = [`## ${label} — ${nodes.length} узлов`, ''];
      for (const n of nodes) {
        const kind = n.kind === 'notable' ? '★ notable' : n.kind === 'start' ? '→ start' : '· small';
        lines.push(`- ${kind} **${n.name}** (${n.ascendancy}): ${n.stats.join('; ') || '—'}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
  count++;

  // ── Игровые описания статов (объяснение механик) ──────────────────────────
  server.registerTool(
    'poe2_stat_explain',
    {
      title: 'PoE2 Stat Explain (offline)',
      description: `Объяснение внутренней механики PoE2 по её тексту/подстроке: поиск по stat_id (внутренние идентификаторы игры) и выдача КАНОНИЧЕСКОГО игрового описания (как в клиенте) из датасета stat_descriptions (~10.7k описаний, офлайн).

Например: query="glory" покажет, как формально работает механика Glory, query="base_life" — формулировку increased life.

Аргументы:
  - query (string, обяз.): подстрока stat_id или механики ("glory", "armour_break", "base_life").
  - limit (number, опц., по умолч. 5).
`,
      inputSchema: {
        query: z.string().min(2).describe('Подстрока stat_id/механики'),
        limit: z.number().int().min(1).max(20).optional().describe('Сколько описаний'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      const descs = core.dataset.searchStatDescriptions(query, limit ?? 5);
      const statIds = core.dataset.searchStatIds(query, 5);
      const lines: string[] = [];
      if (descs.length) {
        lines.push(`## Игровые описания для «${query}» — ${descs.length}`, '');
        for (const d of descs) {
          lines.push(`- **${d.allStatIds.slice(0, 3).join(', ')}**\n  ${d.template}`);
        }
      } else {
        lines.push(`Описаний для «${query}» не найдено.`);
      }
      if (statIds.length) {
        lines.push('', `### Родственные stat_id: ${statIds.slice(0, 5).join(', ')}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
  count++;

  return count;
}
