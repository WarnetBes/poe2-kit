/**
 * MCP-инструмент: контекст прокачки — живое состояние клиента (Client.txt)
 * + заметки текущей зоны/акта + следующие зоны с наградами.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerZoneNotesTools(server: McpServer): number {
  server.registerTool(
    'poe2_leveling_context',
    {
      title: 'PoE2 Leveling Context (live)',
      description: `Контекст прокачки PoE2: читает состояние игры (Client.txt — персонаж, уровень, текущая зона), подставляет заметки текущей зоны (каких боссов убить, какие гемы/пассивки получить), сводку акта и следующие 3 рекомендованные зоны с наградами.

Аргументы:
  - log_path (string, опц.): явный путь к Client.txt (иначе автодетект).
  - act (number, опц.): если лог недоступен — контекст для этого акта (1-4).
  - full_zone_notes (boolean, опц., по умолч. false): полные заметки зоны вместо кратких подсказок.
`,
      inputSchema: {
        log_path: z.string().optional().describe('Путь к Client.txt'),
        act: z.number().int().min(1).max(4).optional().describe('Акт для fallback-контекста'),
        full_zone_notes: z.boolean().optional().describe('Показать полные заметки зоны'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ log_path, act, full_zone_notes }) => {
      try {
        const state = core.log.getClientState({ logPath: log_path });
        const ctx = core.zoneNotes.getLevelingContext(state.available ? state : null, {
          actFallback: act,
        });
        const lines: string[] = [];
        lines.push('## Контекст прокачки PoE2', '');
        lines.push(`- Персонаж: **${ctx.summary}**${ctx.available ? '' : ' (⚠️ лог недоступен)'}`);
        if (ctx.zone) {
          lines.push(
            `- Текущая зона: **${ctx.zone.zoneName ?? ctx.zone.areaCode}** (\`${ctx.zone.areaCode}\`, акт ${state.act ?? '?'})`,
          );
        } else {
          lines.push(`- Зона неизвестна${act ? `, рассматривается акт ${act}` : ''}`);
        }
        lines.push('', '### Подсказки');
        for (const h of ctx.hints) lines.push(`- ${h}`);
        if (ctx.zoneNotes && full_zone_notes) {
          lines.push('', `### Полные заметки: ${ctx.zoneNotes.zoneName}`, '', ctx.zoneNotes.notes);
        }
        if (ctx.actNotes && full_zone_notes) {
          lines.push('', `### Награды акта (${ctx.actNotes.actName})`, '', ctx.actNotes.notes);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка контекста прокачки: ${msg}` }] };
      }
    },
  );
  return 1;
}
