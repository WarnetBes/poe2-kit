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
      description: `Поиск активных гемов PoE2 в ОФФЛАЙН-датасете (патч 0.5): имя, теги скиллов, время каста, стоимость маны по уровням, максимум уровней, а также ИСТОЧНИК получения (P0 #5): Uncut Skill/Spirit Gem + уровень открытия.

Аргументы:
  - query (string, обяз.): имя гема или его часть (например "Ice Strike").
  - details (boolean, опц., по умолч. false): полная запись первого совпадения — статы/стоимость/требования по всем уровням.
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
        const src = g.source
          ? `${g.source.item}${g.source.unlockLevel != null ? ` (открытие ~ур. ${g.source.unlockLevel})` : ''}`
          : '—';
        lines.push(
          `- **${g.name}** — теги: ${g.skillTypes.slice(0, 6).join(', ') || '—'}; каст ${g.castTime}с; макс. уровень ${g.maxLevel}; стоимость 1-го уровня: ${firstCost}; источник: ${src}`,
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
          if (d.source) {
            lines.push('', `**Источник (P0 #5):** ${d.source.item}${d.source.unlockLevel != null ? ` · открытие ~ур. ${d.source.unlockLevel}` : ''}`);
            lines.push(`> ${d.source.note}`);
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

  server.registerTool(
    'poe2_tree_search_stats',
    {
      title: 'PoE2 Passive Tree AND Search by Stats',
      description: `Поиск по дереву пассивок PoE2 по НАБОРУ статов (AND-агрегат). Находит узлы, у которых в имени ИЛИ статах встречаются ВСЕ заданные слова/фразы (не перебор по одному слову).

Аргументы:
  - stats (string[], обяз.): массив слов/фраз, которые должны встретиться (AND). Напр. ["% increased Energy Shield", "Evasion Rating"] → «узлы с X% ES и уклонением».
  - any (boolean, опц.): если true — хотя бы одно из слов (OR).
  - keystones_only (boolean, опц.): только keystone/notable.
  - limit (number, опц., по умолч. 10).

Примеры:
  - "Узлы с increased ES и уклонением" → stats: ["% increased Energy Shield", "Evasion Rating"]
  - "Крит и freeze" → stats: ["Critical", "Freeze"]
`,
      inputSchema: {
        stats: z.array(z.string().min(1)).min(1).describe('Слова/фразы для AND-поиска'),
        any: z.boolean().optional().describe('Хотя бы одно слово (OR)'),
        keystones_only: z.boolean().optional().describe('Только keystone-узлы'),
        limit: z.number().int().min(1).max(30).optional().describe('Сколько узлов'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ stats, any: anyMode, keystones_only, limit }) => {
      const nodes = core.dataset.searchPassiveTreeByStats(
        Array.isArray(stats) ? stats : [stats],
        { limit: limit ?? 10, keystonesOnly: keystones_only, any: anyMode },
      );
      if (!nodes.length) {
        return { content: [{ type: 'text', text: `Узлы по набору ${anyMode ? '(OR) ' : '(AND) '}«${stats.join('», «')}» не найдены.` }] };
      }
      const lines = [`## Дерево пассивок: AND «${stats.join('» ∩ «')}» — ${nodes.length}`, ''];
      for (const n of nodes) {
        const type = n.isKeystone ? '🔑 KEYSTONE' : n.isNotable ? '★ notable' : '· обычная';
        const asc = n.ascendancy ? ` (${n.ascendancy})` : '';
        lines.push(`- ${type}${asc} **${n.name}**: ${n.stats.join('; ')}`);
      }
      if (nodes.length >= (limit ?? 10)) lines.push('', `_Показаны первые ${nodes.length} (лимит ${limit ?? 10})._`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
  count++;

  // ── Резолв узлов дерева по ID ───────────────────────────────────────────────
  server.registerTool(
    'poe2_tree_ids',
    {
      title: 'PoE2 Passive Tree Nodes By ID',
      description: `Резолв узлов дерева пассивок PoE2 по их ID. Понимает обе схемы ID:
  - символьные (как их возвращает poe2_tree_search: "attributes1", …) — обычное дерево,
  - числовые (как в PoB: <Spec nodes="…"> или URL дерева, например 12876) — и обычное дерево, и асценданси.
Возвращает имя, тип (keystone/notable/обычная), асценданси и статы.
Числовые ID обычного дерева резолвятся по числовой карте (passive_tree/numeric_ids.json, P0 #1b).
Ненайденные (например из другой версии дерева) — тул честно сообщит.

Аргументы:
  - ids (string[], обяз.): массив ID узлов (символьные или числовые строки).
  - keystones_only (boolean, опц.): только keystone/notable-узлы.
  - show_stats (boolean, опц., по умолч. true): показывать статы узлов.

Примеры:
  - "Что за узлы 12876, 7621, 8143?" → ids: ["12876", "7621", "8143"]
  - "Разбери дерево билда" → ids из poe2_build_decode
`,
      inputSchema: {
        ids: z.array(z.string().min(1)).describe('ID узлов дерева (как в PoB)'),
        keystones_only: z.boolean().optional().describe('Только keystone/notable-узлы'),
        show_stats: z.boolean().optional().describe('Показывать статы узлов'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ ids, keystones_only, show_stats }) => {
      const normalized = (Array.isArray(ids) ? ids : [ids])
        .map((s) => String(s).trim())
        .filter(Boolean);
      if (!normalized.length) {
        return { isError: true, content: [{ type: 'text', text: 'Укажите хотя бы один ID узла.' }] };
      }
      const report = core.dataset.resolvePassiveNodes(normalized);
      const shown = keystones_only
        ? report.resolved.filter((n) => n.isKeystone || n.isNotable)
        : report.resolved;

      const lines = [`## Узлы по ID — найдено ${report.resolved.length} из ${report.requested}`, ''];
      for (const n of shown) {
        const type = n.isKeystone ? '🔑 KEYSTONE' : n.isNotable ? '★ notable' : '· малый';
        const asc = n.ascendancy ? ` (${n.ascendancy})` : '';
        const stats = show_stats !== false && n.stats.length ? `: ${n.stats.join('; ')}` : '';
        const src = n.source === 'ascendancy' ? ' · асценданси' : '';
        lines.push(`- **${n.id}** — ${type}${asc}${src} **${n.name}**${stats}`);
      }
      if (report.missing.length) {
        lines.push('');
        lines.push(`⚠ Не найдено в датасете (${report.missing.length}): ${report.missing.slice(0, 40).join(', ')}${report.missing.length > 40 ? '…' : ''}`);
        if (report.missingNumeric.length === report.missing.length) {
          lines.push('_Все ненайденные — числовые ID, которых нет в числовой карте дерева (возможно, из другой версии treeVersion, чем 0_3). Проверьте в Path of Building._');
        } else {
          lines.push('_Возможно, узлы из другой версии дерева (PoB treeVersion ≠ актуальному патчу) — сверить в Path of Building._');
        }
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
      description: `Поиск саппорт-гемов PoE2 в ОФФЛАЙН-датасете (680 шт., патч 0.5): по имени («Concentrated» → Concentrated Area Support). Показывает id, совместимость (compatible_with) и ИСТОЧНИК получения (P0 #5): Uncut Support Gem.

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
        const src = g.source ? `${g.source.item} — ${g.source.note}` : '—';
        lines.push(
          `- **${g.name}** (${g.id})` +
            (g.compatible_with.length ? ` — подходит для: ${g.compatible_with.slice(0, 4).join(', ')}` : '') +
            `; источник: ${src}`,
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

  // ── Свежесть и версионирование данных ───────────────────────────────────────
  server.registerTool(
    'poe2_data_freshness',
    {
      title: 'PoE2 Data Freshness (versions + cache)',
      description: `Версии и свежесть всех источников данных poe2-kit:
- офлайн-датасеты (патч, ревизия, дата извлечения);
- дисковый кэш живых источников (лиги poe2scout, RePoE base_items/mods, снапшоты/словари poe.ninja) — URL, возраст.

После патча игры: clear=true — очистить кэш, чтобы лиги/предметы перезагрузились свежими.

Аргументы:
  - clear (boolean, опц.): очистить дисковый кэш перед сводкой.
`,
      inputSchema: {
        clear: z.boolean().optional().describe('Очистить дисковый кэш живых источников'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async ({ clear }) => {
      let cleared = 0;
      if (clear) cleared = core.cache.clearHttpCache();
      const v = core.dataset.getDatasetVersion();
      const entries = core.cache.httpCacheInfo();
      const lines = [
        '## Свежесть данных poe2-kit',
        '',
        '### Офлайн-датасеты',
        `- Патч: **${v.patch_version} «${v.patch_name}»** (ревизия ${v.data_revision}, ${v.released_as}), извлечено ${v.extracted_at}`,
        '',
        `### Дисковый кэш живых источников — ${entries.length} записей${clear ? ` (очищено ${cleared})` : ''}`,
      ];
      if (!entries.length) {
        lines.push('_Кэш пуст — живые запросы пока не делались._');
      } else {
        lines.push('| Источник | Возраст |', '|---|---|');
        for (const e of entries) {
          const age = e.ageHours < 1 ? `${(e.ageHours * 60).toFixed(0)} мин` : `${e.ageHours.toFixed(1)} ч`;
          const short = e.url.replace(/^https:\/\//, '').slice(0, 70);
          lines.push(`| ${short} | ${age} |`);
        }
        lines.push('', '_TTL: лиги 6ч, RePoE 7 дней, снапшоты poe.ninja 1ч, словари poe.ninja — бессрочно (адресованы хэшем)._');
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
  count++;

  return count;
}
