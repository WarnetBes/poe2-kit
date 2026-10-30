/**
 * MCP-инструмент: poe2_items_compare — W5-B (№696).
 *
 * Head-to-head сравнение двух предметов «текущий vs кандидат»: мод-дифф
 * (общие / только A / только B, числа нормализуются) + gearscore обеих
 * сторон по одному профилю + вердикт upgrade/downgrade/sidegrade.
 * Core: itemsCompare.ts (idea reference poe2-upgrade-checker GPL-3 —
 * только идея сравнения, код свой).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerItemsCompareTools(server: McpServer): number {
  server.registerTool(
    'poe2_items_compare',
    {
      title: 'PoE2 Items Compare (head-to-head)',
      description: `Сравнение двух предметов лоб в лоб: «стоит ли менять A на B». Мод-дифф (общие суть-моды / только в A / только в B — роллы чисел нормализуются), gearscore обеих сторон по профилю (life-res / es-caster) и вердикт: upgrade / downgrade / sidegrade с причинами.

Вход: два клир-текста предметов (RU/EN, из игры Ctrl+C) + опц. профиль.

Границы честно: gearscore — эвристика (веса/капы профилей), verdict-порог ±5 очков; разные слоты сравниваются условно (вердикт unknown).`,
      inputSchema: {
        item_a: z.string().min(20).describe('Клир-текст ТЕКУЩЕГО предмета (Ctrl+C из игры, RU или EN)'),
        item_b: z.string().min(20).describe('Клир-текст КАНДИДАТА на замену'),
        profile: z.enum(['life-res', 'es-caster']).optional().describe('Профиль оценки (default life-res)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ item_a, item_b, profile }) => {
      try {
        const r = core.itemsCompare.compareItems({
          itemA: item_a,
          itemB: item_b,
          ...(profile ? { profile } : {}),
        });
        if (!r.ok) {
          return { isError: true, content: [{ type: 'text', text: `Ошибка compare: ${r.error}` }] };
        }
        const lines: string[] = ['## Items compare (head-to-head)', ''];
        const v: Record<string, string> = {
          upgrade: '✅ **UPGRADE** — кандидат лучше',
          downgrade: '⛔ **DOWNGRADE** — НЕ менять',
          sidegrade: '⚖️ **SIDEGRADE** — примерно равны, смотрите мод-дифф',
          unknown: '❓ **UNKNOWN** — сравнение условное, смотрите мод-дифф',
        };
        lines.push(v[r.verdict] ?? r.verdict, '');
        lines.push(`Текущий: **${r.nameA}** (${r.scoreA!.slot}, gearscore ${r.scoreA!.score ?? '—'})`);
        lines.push(`Кандидат: **${r.nameB}** (${r.scoreB!.slot}, gearscore ${r.scoreB!.score ?? '—'})`, '');
        for (const rsn of r.reasons) lines.push(`- ${rsn}`);
        if (r.shared.length) {
          lines.push('', `Общие моды (суть совпадает, роллы могут отличаться): ${r.shared.join(' | ')}`);
        }
        const onlyA = r.diff.filter((d) => d.side === 'a').map((d) => d.text);
        const onlyB = r.diff.filter((d) => d.side === 'b').map((d) => d.text);
        if (onlyA.length) lines.push('', `Только у текущего: ${onlyA.join(' | ')}`);
        if (onlyB.length) lines.push(`Только у кандидата: ${onlyB.join(' | ')}`);
        lines.push('', '_Gearscore — эвристика профилей кита (estimate-слой)._');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка items-compare: ${msg}` }] };
      }
    },
  );

  return 1;
}
