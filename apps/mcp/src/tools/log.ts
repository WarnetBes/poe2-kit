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
        if (st.sessions.length > 0) {
          const cur = st.sessions[st.sessions.length - 1]!;
          const total = st.sessions.length;
          const first = st.sessions[0]!;
          lines.push(`- Игровых сессий в окне: **${total}** (текущая началась ${cur.startTimestamp}`);
          if (total > 1 && first !== cur) lines.push(`; окно лога — с ${first.startTimestamp}`);
          lines.push(')');
        }
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

  server.registerTool(
    'poe2_game_config',
    {
      title: 'PoE2 Game Config (local INI)',
      description: `Локальный конфиг PoE2-клиента (poe2_production_Config.ini из Documents/My Games/Path of Exile 2): режим ввода (WASD/click-к-движению — влияет на советы по билду), текущий акт, gateway, разрешение/рендер.

Аргументы:
  - config_path (string, опц.): явный путь к INI (иначе автодетект: OneDrive/Documents, USERPROFILE/Documents).

ВАЖНО: account_name пуст при Steam-аутентификации — персонажа определять через poe2_log_state (Client.txt).
Чисто локальный источник: файл читается только с диска пользователя.`,
      inputSchema: {
        config_path: z.string().optional().describe('Явный путь к poe2_production_Config.ini'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ config_path }) => {
      try {
        const cfg = core.gameConfig.getGameConfigSummary(config_path);
        if (!cfg.available) {
          return {
            content: [
              {
                type: 'text',
                text: `Конфиг недоступен: ${cfg.reason}\n\n` +
                  'Попросите пользователя указать config_path к poe2_production_Config.ini ' +
                  '(обычно в Documents/My Games/Path of Exile 2).',
              },
            ],
          };
        }
        const lines = ['## Конфиг PoE2-клиента', ''];
        lines.push(`- Путь: \`${cfg.configPath}\``);
        if (cfg.accountName) {
          lines.push(`- Аккаунт (standalone): **${cfg.accountName}**`);
        } else {
          lines.push('- Аккаунт: не определён (Steam не пишет account_name — см. poe2_log_state)');
        }
        if (cfg.inputMode) lines.push(`- Режим ввода: **${cfg.inputMode}** (влияет на рекомендации механик)`);
        if (cfg.actEnvironment) lines.push(`- Текущий акт: environment=${cfg.actEnvironment}${cfg.actHint ? ` → ${cfg.actHint}` : ''}`);
        if (cfg.gateway) lines.push(`- Gateway: ${cfg.gateway}`);
        if (cfg.resolution) lines.push(`- Разрешение: ${cfg.resolution}`);
        if (cfg.renderer) lines.push(`- Рендерер: ${cfg.renderer}`);
        if (cfg.framerateCap) lines.push(`- Кап FPS: ${cfg.framerateCap}`);
        if (cfg.gpu) lines.push(`- GPU: ${cfg.gpu}`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка чтения конфига: ${msg}` }] };
      }
    },
  );

  return 2;
}
