/**
 * MCP-инструмент: живое состояние игры из Client.txt (локальный лог PoE2).
 * Текущая зона / уровень персонажа / смерти / сессия — без сети и POESESSID.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerLogTools(server: McpServer): number {
  server.registerTool(
    'poe2_log_state',
    {
      title: 'PoE2 Log State',
      description: `Живое состояние игрока PoE2 из локального лога Client.txt: текущая зона (внутренний код + английское имя + акт), уровень и класс персонажа, смерти, AFK, сервер инстанса.

Аргументы:
  - log_path (string, опц.): явный путь к Client.txt/LatestClient.txt. Иначе — автодетект (Steam/GGG, диски C:/D:/E:).
  - poe2_install_path (string, опц.): корень установки PoE2 (папка, содержащая logs/).
  - full_history (boolean, опц.): читать полный Client.txt вместо LatestClient.txt.
  - tail_bytes (number, опц.): размер окна хвоста в байтах (по умолчанию 1048576 ≈ тысячи строк).

Чисто локальный источник: файл лога читается только с диска пользователя. useful для "где я сейчас", "какая зона дальше", "сколько я умер за сессию".
`,
      inputSchema: {
        log_path: z.string().optional().describe('Явный путь к логу'),
        poe2_install_path: z.string().optional().describe('Корень установки PoE2'),
        full_history: z.boolean().optional().describe('Читать полный Client.txt'),
        tail_bytes: z.number().int().min(4096).max(16_777_216).optional().describe('Окно хвоста, байт'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ log_path, poe2_install_path, full_history, tail_bytes }) => {
      try {
        const st = core.log.getClientState({
          logPath: log_path,
          poe2InstallPath: poe2_install_path,
          fullHistory: full_history,
          tailBytes: tail_bytes,
        });
        if (!st.available) {
          return {
            content: [
              {
                type: 'text',
                text: `Лог недоступен: ${st.reason ?? 'неизвестная причина'}\n\n` +
                  'Попросите пользователя указать путь к Client.txt (log_path) ' +
                  'или корень установки PoE2 (poe2_install_path — папка с подкаталогом logs/).',
              },
            ],
          };
        }
        const lines: string[] = ['## Текущее состояние (Client.txt)', ''];
        lines.push(`- Лог: \`${st.logPath}\``);
        lines.push(st.character ? `- Персонаж: **${st.character}** (${st.klass ?? '?'}), уровень ${st.level ?? '?'}` : '- Персонаж: неизвестно (нет событий level_up в окне)');
        if (st.zone) {
          const z = st.zone;
          const name = z.zoneName ?? z.decoded?.englishName ?? z.areaCode;
          const act = z.decoded?.act ?? '?';
          lines.push(`- Зона: **${name}** (код \`${z.areaCode}\`, Акт ${act}, уровень зоны ${z.areaLevel})`);
          if (z.decoded?.description) lines.push(`  - ${z.decoded.description}`);
        } else {
          lines.push('- Зона: неизвестно (нет событий area_change в окне)');
        }
        lines.push(`- Смертей в окне: ${st.deathsInWindow}`);
        if (st.afk != null) lines.push(`- AFK: ${st.afk ? 'включён' : 'выключен'}`);
        if (st.instanceServer) lines.push(`- Сервер инстанса: ${st.instanceServer}`);
        if (st.lastEventTime) lines.push(`- Последнее событие: ${st.lastEventTime}`);
        if (st.zoneVisits.length > 1) {
          lines.push('', '### Последние посещения зон');
          for (const v of st.zoneVisits.slice(-10).reverse()) {
            const n = v.zoneName ?? v.decoded?.englishName ?? v.areaCode;
            lines.push(`- ${v.timestamp} — ${n} (ур. ${v.areaLevel})`);
          }
        }
        if (!core.log.hasSubstantialLogData(st)) {
          lines.push('', '_Данных мало (возможно, игра только запущена). Попробуйте full_history=true._');
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );

  return 1;
}
