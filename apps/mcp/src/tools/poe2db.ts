/**
 * MCP-инструмент: справочник poe2db.tw (гемы/предметы/ключевые слова).
 * Скрапинг HTML-страниц poe2db (порт сервиса из poe2-mcp-server).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core, isPoe2dbLang, type Poe2dbSectionFilter } from '@poe2-kit/core';

export function registerPoe2dbTools(server: McpServer): number {
  server.registerTool(
    'poe2_poe2db_lookup',
    {
      title: 'PoE2 poe2db.tw Lookup',
      description: `Страница poe2db.tw по термину (гем, предмет, ключевое слово, монстр): описание, статы, рекомендуемые саппорт-гемы, где взять, уровни, история версий.

Аргументы:
  - term (string, обяз.): термин (например "Ice Strike", "Shock", "Kalandra's Touch").
  - lang (string, опц., по умолч. "us"): us/tw/cn/kr/jp/ru/de/fr/sp/pt/th.
  - sections (string[], опц.): какие секции включить — description, stats, supports, supports_full, acquisition, levels, history, microtransactions, monsters. По умолчанию: description, stats, supports, acquisition.
  - level_min / level_max (number, опц.): диапазон уровней для секции levels.
`,
      inputSchema: {
        term: z.string().min(2).describe('Термин для poe2db.tw'),
        lang: z.string().optional().describe('Код языка (us — английский)'),
        sections: z.array(z.string()).optional().describe('Секции вывода'),
        level_min: z.number().int().min(1).max(40).optional().describe('Минимальный уровень (levels)'),
        level_max: z.number().int().min(1).max(40).optional().describe('Максимальный уровень (levels)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ term, lang, sections, level_min, level_max }) => {
      const allowed = new Set<string>([
        'description', 'stats', 'supports', 'supports_full',
        'acquisition', 'levels', 'history', 'microtransactions', 'monsters',
      ]);
      const chosen = sections?.filter((s) => allowed.has(s));
      const levelRange =
        level_min != null || level_max != null
          ? { min: level_min ?? level_max ?? 1, max: level_max ?? level_min ?? 1 }
          : undefined;
      try {
        const result = await core.poe2db.lookupPoe2db(term, {
          lang: isPoe2dbLang(lang) ? lang : 'us',
          sections: chosen?.length ? (chosen as Poe2dbSectionFilter[]) : undefined,
          levelRange,
        });
        if (!result) {
          return { content: [{ type: 'text', text: `Страница poe2db по запросу «${term}» не найдена.` }] };
        }
        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка poe2db: ${msg}` }] };
      }
    },
  );
  return 1;
}
