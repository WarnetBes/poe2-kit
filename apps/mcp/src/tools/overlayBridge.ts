/**
 * MCP-инструменты №85: агентский мост — оверлей становится двусторонним.
 *
 * Записывает команды в agent-queue.json в userData оверлея; overlay
 * поллимит файл каждые 2 с, применяет и удаляет (единственный применяющий =
 * нет race по watchlist).
 *
 * Каталог DataDir — тот же контракт, что у overlayState.ts:
 *  1. аргумент data_dir;
 *  2. env POE2K_OVERLAY_DATA;
 *  3. %APPDATA%\@poe2-kit\overlay. Для удалённого ПК (у друга):
 *     data_dir="\\<overlay-pc-ip>\OpenCodeProjectsF\poe2-kit\apps\overlay" —
 *     ВАЖНО: очередь пишется в <data_dir>/agent-queue.json, overlay поллит её
 *     и в userData, и рядом со своим dist. Зеркало userData
 *     (\\<overlay-pc-ip>\poe2kit-appdata\overlay) READ-ONLY — туда писать нельзя.
 *
 * Формат очереди (append-merge):
 *  { notify: [{title?, text}], watchAdd: [...], watchRemove: [id] }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const QUEUE_FILE = 'agent-queue.json';

function resolveDataDir(explicit?: string): string {
  if (explicit) return explicit;
  const env = process.env['POE2K_OVERLAY_DATA'];
  if (env) return env;
  return path.join(os.homedir(), 'AppData', 'Roaming', '@poe2-kit', 'overlay');
}

interface QueueShape {
  notify?: Array<{ title?: string; text: string }>;
  watchAdd?: Array<{ itemText: string; label?: string }>;
  watchRemove?: string[];
}

/** Слить команду с текущей очередью (overlay применит и удалит файл). */
function appendQueue(dataDir: string, patch: QueueShape): { file: string; queued: number } {
  const file = path.join(dataDir, QUEUE_FILE);
  let cur: QueueShape = {};
  try {
    cur = JSON.parse(fs.readFileSync(file, 'utf8')) as QueueShape;
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) cur = {};
  } catch {
    cur = {}; // нет файла или битый — начинаем с пустого
  }
  cur.notify = Array.isArray(cur.notify) ? cur.notify : [];
  cur.watchAdd = Array.isArray(cur.watchAdd) ? cur.watchAdd : [];
  cur.watchRemove = Array.isArray(cur.watchRemove) ? cur.watchRemove : [];

  let queued = 0;
  if (patch.notify) {
    for (const n of patch.notify.slice(0, 5)) {
      cur.notify!.push(n);
      queued++;
    }
  }
  if (patch.watchAdd) {
    for (const w of patch.watchAdd.slice(0, 10)) {
      cur.watchAdd!.push(w);
      queued++;
    }
  }
  if (patch.watchRemove) {
    for (const id of patch.watchRemove.slice(0, 20)) {
      cur.watchRemove!.push(id);
      queued++;
    }
  }
  // Атомарность на SMB условная, но поллинг overlayа устойчив к битому JSON
  // (файл удаляется, команда теряется — поэтому клиента предупреждаем ниже).
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cur), 'utf8');
  return { file, queued };
}

export function registerOverlayBridgeTools(server: McpServer): number {
  let n = 0;

  server.registerTool(
    'poe2_overlay_notify',
    {
      title: 'PoE2 Overlay Notify',
      description: `Показать игроку тост-уведомление поверх игры (через оверлей PoE2 Kit).

Пишет {notify:[{title,text}]} в agent-queue.json в userData оверлея; overlay подхватывает за ≤2 с (поллинг). Оверлей должен быть запущен — иначе команда будет применена при следующем старте (файл не теряется).

Аргументы:
  - text (string, обяз.): текст уведомления (до 500 символов доходит до UI).
  - title (string, опц.): заголовок тоста, по умолчанию «🤖 Агент».
  - data_dir (string, опц.): каталог userData оверлея (UNC-путь для удалённого ПК).`,
      inputSchema: {
        text: z.string().min(1).max(2000).describe('Текст уведомления для игрока'),
        title: z.string().max(200).optional().describe('Заголовок тоста'),
        data_dir: z.string().optional().describe('Каталог очереди: локально — userData оверлея; удалённо — \\\\<overlay-pc-ip>\\OpenCodeProjectsF\\poe2-kit\\apps\\overlay (зеркало userData read-only)'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ text, title, data_dir }) => {
      const dir = resolveDataDir(data_dir);
      try {
        const { queued } = appendQueue(dir, { notify: [{ title, text }] });
        return {
          content: [
            {
              type: 'text' as const,
              text: `✅ Уведомление поставлено в очередь (${queued}) в ${dir}. Оверлей покажет тост за ≤2 с (если запущен).`,
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: `❌ Не удалось записать очередь в ${dir}: ${err instanceof Error ? err.message : err}` },
          ],
        };
      }
    },
  );
  n++;

  server.registerTool(
    'poe2_overlay_watch_add',
    {
      title: 'PoE2 Overlay Watchlist Add',
      description: `Добавить предмет в watchlist оверлея игрока (десятиминутный прайс-поллинг + алерт при падении цены).

Требует ПОЛНЫЙ текст предмета (как Ctrl+C в игре): первая строка-блок должна содержать "Rarity:" / "Редкость:" — оверлей валидирует и отклонит огрызки (PoB-код, подсказки и т.п.).

Аргументы:
  - item_text (string, обяз.): полный текст предмета из буфера игры.
  - label (string, опц.): человекочитаемая метка.
  - data_dir (string, опц.): каталог userData оверлея (UNC-путь для удалённого ПК).`,
      inputSchema: {
        item_text: z.string().min(5).max(20000).describe('Полный текст предмета (Rarity: … — как Ctrl+C в игре)'),
        label: z.string().max(200).optional().describe('Метка предмета в списке'),
        data_dir: z.string().optional().describe('Каталог очереди: локально — userData оверлея; удалённо — \\\\<overlay-pc-ip>\\OpenCodeProjectsF\\poe2-kit\\apps\\overlay (зеркало userData read-only)'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ item_text, label, data_dir }) => {
      const dir = resolveDataDir(data_dir);
      if (!/^\s*(Rarity|Редкость|Item Class|Класс предмета)\s*:/im.test(item_text)) {
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: '❌ item_text не похож на предмет: нет строки "Rarity:"/"Редкость:". Скопируйте предмет в игре (Ctrl+C) целиком.' },
          ],
        };
      }
      try {
        const { queued } = appendQueue(dir, { watchAdd: [{ itemText: item_text, label }] });
        return {
          content: [
            {
              type: 'text' as const,
              text: `✅ Предмет поставлен в очередь watchAdd (${queued}) в ${dir}. Оверлей добавит его в watchlist за ≤2 с (если запущен; иначе — при следующем старте).`,
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `❌ Не удалось записать очередь в ${dir}: ${err instanceof Error ? err.message : err}` }],
        };
      }
    },
  );
  n++;

  server.registerTool(
    'poe2_overlay_watch_remove',
    {
      title: 'PoE2 Overlay Watchlist Remove',
      description: `Удалить запись из watchlist оверлея игрока по её id.

Список id — из poe2_overlay_state (блок watchlist) или poe2_watch_list.

Аргументы:
  - id (string, обяз.): id записи watchlist.
  - data_dir (string, опц.): каталог userData оверлея (UNC-путь для удалённого ПК).`,
      inputSchema: {
        id: z.string().min(1).max(100).describe('id записи в watchlist'),
        data_dir: z.string().optional().describe('Каталог очереди: локально — userData оверлея; удалённо — \\\\<overlay-pc-ip>\\OpenCodeProjectsF\\poe2-kit\\apps\\overlay (зеркало userData read-only)'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, data_dir }) => {
      const dir = resolveDataDir(data_dir);
      try {
        const { queued } = appendQueue(dir, { watchRemove: [id] });
        return {
          content: [
            {
              type: 'text' as const,
              text: `✅ id поставлен в очередь watchRemove (${queued}) в ${dir}. Оверлей удалит запись за ≤2 с.`,
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `❌ Не удалось записать очередь в ${dir}: ${err instanceof Error ? err.message : err}` }],
        };
      }
    },
  );
  n++;

  return n;
}
