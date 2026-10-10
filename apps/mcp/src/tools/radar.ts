/**
 * MCP-тулы «🛡 Радар» (№256/Этап 4-2): живые баги PoE2 + легальные
 * хитрости. Источник - core/radar.ts (known_issues.json + tricks.json,
 * курация по дайджестам ресёрч-волн).
 *
 * Тул 1 `poe2_known_issues`: что сейчас сломано / исправлено /
 *    «фича-не-баг». Фильтры: status, подстрока в id/title, id для
 *    точечного запроса. unverified-записи помечаются ❓ - не факт.
 * Тул 2 `poe2_tricks`: легальные приёмы (loot-правила, перф, пати).
 *
 * Дисциплина: risk='ban' встречается только в fixed-архиве; для
 * живого эксплойт-контента политика - «знать, но не использовать».
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  listKnownIssues,
  listKnownTricks,
  findIssue,
  findTrick,
  radarMeta,
  type KnownIssue,
  type KnownTrick,
  type IssueStatus,
} from '@poe2-kit/core';

const STATUS_LABEL: Record<IssueStatus, string> = {
  live: 'жив',
  unverified: '❓ неподтверждён',
  fixed: 'исправлен',
  feature: 'фича-не-баг',
};

function issueBlock(i: KnownIssue): string {
  const head = `### ${i.status === 'unverified' ? '❓ ' : ''}${i.title} (${i.id})`;
  const lines = [
    head,
    `- Статус: ${STATUS_LABEL[i.status]}${i.fixed_in ? ` - в ${i.fixed_in}` : ''}${i.severity ? `; тяжесть: ${i.severity}` : ''}`,
    `- Механизм: ${i.mechanism}`,
  ];
  if (i.workaround) lines.push(`- Воркараунд: ${i.workaround}`);
  if (i.unverified) lines.push(`- ❓ Пояснение: ${i.unverified}`);
  if (Array.isArray(i.report_dates) && i.report_dates.length) {
    lines.push(`- Репорты: ${i.report_dates.join(', ')}`);
  }
  if (Array.isArray(i.sources) && i.sources.length) lines.push(`- Источники: ${i.sources.join('; ')}`);
  return lines.join('\n');
}

function trickBlock(t: KnownTrick): string {
  const lines = [
    `### ${t.unverified ? '❓ ' : ''}${t.title} (${t.id})`,
    `- Механизм: ${t.mechanism}`,
    `- Как использовать: ${t.usage}`,
  ];
  if (t.category) lines.push(`- Категория: ${t.category}`);
  if (t.risk) lines.push(`- Риск: ${t.risk}`);
  if (t.status_note) lines.push(`- Статус: ${t.status_note}`);
  if (t.unverified) lines.push(`- ❓ Пояснение: ${t.unverified}`);
  if (Array.isArray(t.sources) && t.sources.length) lines.push(`- Источники: ${t.sources.join('; ')}`);
  return lines.join('\n');
}

/** Регистрация тулов «Радара». Возвращает число зарегистрированных (2). */
export function registerRadarTools(server: McpServer): number {
  server.registerTool(
    'poe2_known_issues',
    {
      title: 'PoE2 Known Issues & Patch Radar',
      description: `Живые баги PoE2 (эпоха 0.5.5e) и патч-радар: что сейчас сломано, воркараунды, что исправлено и в каком патче, а что - фича-не-баг (например Arbiter of Divinity non-quest Origin Core). unverified-записи помечены ❓ - единичные репорты, не факт.

Вход:
  - status (string, опц.): 'all' (по умолч.) | 'live' | 'unverified' | 'fixed' | 'feature'.
  - query (string, опц.): подстрока в id/title (например "abyss", "ritual").
  - id (string, опц.): точечный поиск по id (игнорирует status/query).

Примеры:
  - "что сейчас сломано в poe2" → status: live
  - "баг abyss не спавнит мобов" → query: abyss
  - "расскажи про delirium-island-arena" → id: delirium-island-arena`,
      inputSchema: {
        status: z.enum(['all', 'live', 'unverified', 'fixed', 'feature']).optional().describe('фильтр по статусу'),
        query: z.string().min(2).optional().describe('подстрока в id/title'),
        id: z.string().min(2).optional().describe('точный id записи'),
      },
      outputSchema: {
        markdown: z.string(),
        issues: z.array(z.any()),
        total: z.number(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, query, id }) => {
      try {
        let matched: KnownIssue[];
        if (id) {
          const one = findIssue(id);
          matched = one ? [one] : [];
        } else {
          const all = listKnownIssues();
          matched = status && status !== 'all' ? all.filter((i) => i.status === status) : [...all];
          if (query) {
            const q = query.toLowerCase();
            matched = matched.filter(
              (i) => i.id.toLowerCase().includes(q) || i.title.toLowerCase().includes(q),
            );
          }
        }
        const m = radarMeta();
        const header = [
          `## 🛡 Радар PoE2 - ${m.patch}, срез ${m.asOf}`,
          `Всего ${m.issuesTotal} (live ${m.issuesLive}, ❓ ${m.issuesUnconfirmed}, fixed ${m.issuesFixed}, фичи ${m.issuesFeature})`,
          '',
        ];
        const md = header.concat(matched.length ? matched.map(issueBlock) : ['Ничего не найдено.']).join('\n');
        return { content: [{ type: 'text', text: md }], structuredContent: { markdown: md, issues: matched, total: matched.length } };
      } catch (e) {
        return {
          content: [{ type: 'text', text: `Радар недоступен: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'poe2_tricks',
    {
      title: 'PoE2 Legal Tricks & Survival Rules',
      description: `Легальные хитрости PoE2 0.5.5e-эпохи: loot-правила (Ritual postpone), перф (Texture Quality low-VRAM), превентивные правила (патч-день и стэш), пати-роли (MF-culler, Aurabot). Эксплойты с риском бана сюда НЕ входят.

Вход:
  - query (string, опц.): подстрока в id/title.
  - category (string, опц.): 'loot-rule' | 'survival-rule' | 'perf' | 'build-fix' | 'party' | 'economy'.
  - id (string, опц.): точечный поиск по id.

Примеры:
  - "легальные хитрости для пати" → query: пати
  - "что делать перед патчем" → query: патч`,
      inputSchema: {
        query: z.string().min(2).optional().describe('подстрока в id/title'),
        category: z.string().optional().describe('фильтр по категории'),
        id: z.string().min(2).optional().describe('точный id трюка'),
      },
      outputSchema: {
        markdown: z.string(),
        tricks: z.array(z.any()),
        total: z.number(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, category, id }) => {
      try {
        let matched: KnownTrick[];
        if (id) {
          const one = findTrick(id);
          matched = one ? [one] : [];
        } else {
          let all = listKnownTricks();
          if (category) all = all.filter((t) => t.category === category);
          matched = [...all];
          if (query) {
            const q = query.toLowerCase();
            matched = matched.filter(
              (t) => t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q),
            );
          }
        }
        const md = ['## 💡 Хитрости PoE2 (легальные)', '', ...(matched.length ? matched.map(trickBlock) : ['Ничего не найдено.'])].join('\n');
        return { content: [{ type: 'text', text: md }], structuredContent: { markdown: md, tricks: matched, total: matched.length } };
      } catch (e) {
        return {
          content: [{ type: 'text', text: `Хитрости недоступны: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  return 2;
}
