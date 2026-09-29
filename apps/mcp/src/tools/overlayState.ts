/**
 * MCP-инструменты №69: состояние PoE2 Kit Overlay + анализ "чего не хватает".
 *
 * Читает userData оверлея (JSON-файлы, которыми оверлей сам персистит себя):
 *  - league.txt, overlay-settings.json, build-state.json,
 *    watchlist.json, char-sync.json, хвост overlay.log.
 * Никакого POESESSID и аккаунтных данных там нет — только локальные файлы.
 *
 * Каталог по умолчанию (DataDir):
 *  1. аргумент data_dir;
 *  2. env POE2K_OVERLAY_DATA;
 *  3. %APPDATA%\@poe2-kit\overlay (локальный запуск).
 * Для удалённого ПК (у друга): передать data_dir=\\\\<ip>\\poe2kit-appdata\\overlay.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function resolveDataDir(explicit?: string): string {
  if (explicit) return explicit;
  const env = process.env['POE2K_OVERLAY_DATA'];
  if (env) return env;
  return path.join(os.homedir(), 'AppData', 'Roaming', '@poe2-kit', 'overlay');
}

function readJson(file: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readFileHead(file: string, chars: number): string {
  try {
    return fs.readFileSync(file, 'utf8').slice(0, chars);
  } catch {
    return '';
  }
}

function logTail(file: string, lines: number): string[] {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (!text) return [];
    const chunk = text.slice(-64 * 1024);
    const arr = chunk.split(/\r?\n/).filter((l) => l.trim());
    return arr.slice(-lines);
  } catch {
    return [];
  }
}

interface SlotLike {
  slot?: string;
  name?: string;
  rarity?: string;
  median?: number | null;
  status?: string;
}
interface WatchLike {
  id?: string;
  label?: string;
  rarity?: string;
  lastPrice?: number | null;
  enabled?: boolean;
  alerted?: boolean;
  updatedAt?: number;
}
interface BuildStateLike {
  className?: string;
  ascendancy?: string;
  level?: number;
  importedAt?: number;
  slots?: SlotLike[];
  skills?: unknown[];
  gemSetups?: unknown | null;
  gemSeen?: unknown | null;
  tree?: { resolved?: number; total?: number } | null;
}

function fmtDate(ms?: number): string {
  if (!ms) return '?';
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

function buildStateReport(dir: string): string[] {
  const out: string[] = [];
  const raw = readJson(path.join(dir, 'build-state.json')) as BuildStateLike | null;
  if (!raw) {
    out.push('- build-state.json: НЕТ (билд не импортирован — Ctrl+F3 в оверлее)');
    return out;
  }
  const slots = Array.isArray(raw.slots) ? raw.slots : [];
  const priced = slots.filter((s) => s.median != null);
  const bought = slots.filter((s) => s.status === 'bought');
  out.push(
    `- Билд: ${raw.className ?? '?'} / ${raw.ascendancy ?? '?'}, ур. ${raw.level ?? '?'}, импорт ${fmtDate(raw.importedAt)}`,
  );
  out.push(
    `- Слоты: ${slots.length}, с ценой: ${priced.length}, куплено: ${bought.length}, дерево: ${
      raw.tree ? `${raw.tree.resolved ?? '?'}/${raw.tree.total ?? '?'}` : 'НЕТ'
    }`,
  );
  out.push(`- Сетапы камней: ${raw.gemSetups ? 'есть' : 'НЕТ'}`);
  return out;
}

function gapsReport(dir: string): string[] {
  const out: string[] = [];
  const bs = readJson(path.join(dir, 'build-state.json')) as BuildStateLike | null;
  if (!bs) {
    out.push('⚠ Билд не импортирован. → попросите игрока Ctrl+F3 (PoB-код) и повторите.');
    return out;
  }
  const slots = Array.isArray(bs.slots) ? bs.slots : [];
  const unpriced = slots.filter((s) => s.median == null && s.status !== 'bought');
  if (unpriced.length) {
    out.push(
      `⚠ Непооцененных слотов: ${unpriced.length} — ${unpriced
        .map((s) => `${s.slot ?? s.name ?? '?'}`)
        .slice(0, 10)
        .join(', ')}${unpriced.length > 10 ? ', …' : ''}`,
    );
    out.push('  → чем чинить: poe2_poe2db_lookup (точное имя базы), poe2_trade_search (листинги), poe2_currency_* (курс).');
  }
  if (!bs.tree) out.push('⚠ Дерево пассивок не в state (неразобранный импорт). → попросите Ctrl+F3 повторно с полным PoB-кодом.');
  if (!bs.gemSetups) out.push('⚠ Сетапы камней не рассчитаны. → повторный импорт билда (Ctrl+F3) их досчитает.');
  if (!bs.level) out.push('⚠ Уровень персонажа неизвестен. → poe2_log_state или poe2_characters.');

  const wl = readJson(path.join(dir, 'watchlist.json')) as WatchLike[] | null;
  if (Array.isArray(wl)) {
    const broken = wl.filter((e) => e.enabled !== false && e.lastPrice == null);
    if (broken.length) {
      out.push(
        `⚠ Watchlist без цены: ${broken.length} — ${broken
          .map((e) => e.label ?? '?')
          .slice(0, 8)
          .join(', ')}${broken.length > 8 ? ', …' : ''}`,
      );
      out.push('  → чем чинить: poe2_trade_search по имени; RU-база без перевода — poe2_poe2db_lookup RU→EN.');
    }
  }

  const league = readFileHead(path.join(dir, 'league.txt'), 100).trim();
  if (!league) {
    out.push('⚠ Лига не выбрана. → poe2_leagues, попросите игрока выбрать в ⚙ оверлея.');
  }

  return out;
}

export function registerOverlayStateTools(server: McpServer): number {
  let n = 0;

  server.registerTool(
    'poe2_overlay_state',
    {
      title: 'PoE2 Kit Overlay State',
      description: `Что происходит у игрока прямо сейчас: состояние PoE2 Kit Overlay из его userData (JSON оверлея + хвост overlay.log).

Читает: лига, настройки (высота/хоткеи/режимы), билд (класс/ур./слоты/цены/камни/дерево), watchlist, char-sync. Никаких аккаунтных данных.

Аргументы:
  - data_dir (string, опц.): каталог userData оверлея. По умолчанию: env POE2K_OVERLAY_DATA, иначе %APPDATA%\\@poe2-kit\\overlay. Для удалённого ПК: data_dir="\\\\192.168.0.195\\poe2kit-appdata\\overlay".
  - log_tail (number, опц.): сколько строк overlay.log показать (по умолчанию 15, max 80).

Используйте вместе с poe2_log_state (живая игра из Client.txt) для полной картины.`,
      inputSchema: {
        data_dir: z.string().optional().describe('Каталог userData оверлея (UNC-путь для удалённого ПК)'),
        log_tail: z.number().int().min(1).max(80).optional().describe('Строк хвоста overlay.log'),
      },
      annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ data_dir, log_tail }) => {
      const dir = resolveDataDir(data_dir);
      const lines: string[] = [`## Overlay state: ${dir}`, ''];

      if (!fs.existsSync(dir)) {
        lines.push(
          `Каталог не найден. Укажите data_dir (для удалённого ПК — UNC-путь к poe2kit-appdata\\overlay) или env POE2K_OVERLAY_DATA.`,
        );
      } else {
        const league = readFileHead(path.join(dir, 'league.txt'), 100).trim();
        lines.push(`- Лига: ${league || 'не выбрана'}`);
        const st = readJson(path.join(dir, 'overlay-settings.json')) as Record<string, unknown> | null;
        if (st) {
          const short = Object.keys(st)
            .sort()
            .map((k) => `${k}=${JSON.stringify(st[k])}`)
            .join('; ');
          lines.push(`- Настройки: ${short}`);
        } else {
          lines.push('- overlay-settings.json: нет (дефолты)');
        }
        lines.push('', '### Билд');
        lines.push(...buildStateReport(dir));
        lines.push('', '### Watchlist');
        const wl = readJson(path.join(dir, 'watchlist.json')) as WatchLike[] | null;
        if (Array.isArray(wl) && wl.length) {
          for (const e of wl.slice(0, 15)) {
            lines.push(
              `- ${e.label ?? '?'} [${e.rarity ?? '?'}]: цена=${e.lastPrice ?? '—'}, ${
                e.enabled === false ? 'OFF' : 'on'
              }, upd ${fmtDate(e.updatedAt)}`,
            );
          }
          if (wl.length > 15) lines.push(`- … всего ${wl.length}`);
        } else {
          lines.push('- пуст');
        }
        const cs = readJson(path.join(dir, 'char-sync.json')) as Record<string, unknown> | null;
        if (cs) lines.push('', `### char-sync: ${JSON.stringify(cs).slice(0, 300)}`);

        const tail = logTail(path.join(dir, 'overlay.log'), log_tail ?? 15);
        if (tail.length) {
          lines.push('', `### overlay.log (хвост ${tail.length})`);
          lines.push(...tail.map((l) => '> ' + l.slice(0, 200)));
        }
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
  n++;

  server.registerTool(
    'poe2_overlay_gaps',
    {
      title: 'PoE2 Kit Info Gaps',
      description: `Чего НЕ ХВАТАЕТ для полноценной помощи игроку: автодиагностика данных оверлея.

Возвращает явный список дыр и к какому инструменту обращаться для закрытия каждой:
  - слоты билда без цены, отсутствие дерева/камней,
  - watchlist-позиции, которые не прайсятся,
  - невыбранная лига/уровень.
Работает по тем же файлам, что poe2_overlay_state. После закрытия дыр повторите для проверки.`,
      inputSchema: {
        data_dir: z.string().optional().describe('Каталог userData оверлея (UNC-путь для удалённого ПК)'),
      },
      annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ data_dir }) => {
      const dir = resolveDataDir(data_dir);
      const lines: string[] = [`## Info gaps: ${dir}`, ''];
      if (!fs.existsSync(dir)) {
        lines.push('Каталог не найден — укажите data_dir.');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }
      const gaps = gapsReport(dir);
      if (!gaps.length) lines.push('Дыр не найдено: билд оценен, дерево и камни на месте, watchlist прайсится. ✅');
      else lines.push(...gaps);
      lines.push('', 'Подсказка: нужен ли внешний добор — poe2_sources_list (библиотека источников).');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
  n++;

  return n;
}
