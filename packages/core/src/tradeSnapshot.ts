/**
 * Оффлайн-снапшот каталога статов официального trade2 (trade/data/stats).
 *
 * Файл: `data/game/trade/stats_snapshot.json` — нетронутый ответ
 * `https://www.pathofexile.com/api/trade2/data/stats` (853 КБ, ~8.3k записей).
 * Назначение: второй слой фолбэка матчинга статов (live каталог → снапшот →
 * learned), чинит «сеть лежит / trade2 недоступен» без потери качества: в
 * снапшоте — полный набор stat_id ↔ шаблон, а не подмножество из learned.
 *
 * ⚠️ Протухание: снапшот снимается вручную (см. scripts/ — скрипт обновления
 * ниже в файле). GGG меняет хэши stat_id патчами — после крупного патча файл
 * нужно перезалить: `curl -o stats_snapshot.json
 * https://www.pathofexile.com/api/trade2/data/stats`. матчинг по ТЕКСТУ при
 * этом остаётся валидным (тексты меняются редко) — устаревший снапшот хуже
 * живого каталога, но лучше пустоты. Источник данных © Grinding Gear Games,
 * публичный API торгового сайта.
 */

import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';
import type { TradeStatEntry } from './trade.js';

function snapshotPath(): string {
  return pathMod!.join(
    pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)),
    '..',
    'data',
    'game',
    'trade',
    'stats_snapshot.json',
  );
}

interface SnapshotFile {
  result?: Array<{ id?: string; entries?: TradeStatEntry[] }>;
}

let cache: TradeStatEntry[] | null = null;

/**
 * Снапшот каталога статов в том же виде, что возвращает fetchTradeStats()
 * (плоский список {id,text,type} по всем группам). В браузере/без диска — пусто.
 */
export function getTradeStatSnapshot(): TradeStatEntry[] {
  if (!HAS_DISK) return [];
  if (cache) return cache;
  try {
    const raw = JSON.parse(fsMod!.readFileSync(snapshotPath(), 'utf8')) as SnapshotFile;
    const out: TradeStatEntry[] = [];
    for (const group of raw.result ?? []) {
      for (const e of group.entries ?? []) {
        if (typeof e.id === 'string' && typeof e.text === 'string') {
          out.push({ id: e.id, text: e.text, type: group.id ?? e.type });
        }
      }
    }
    cache = out;
    return out;
  } catch {
    return [];
  }
}

/** Сводка по снапшоту для само-отчёта (тул poe2_kit_info / отладка). */
export function tradeSnapshotInfo(): { entries: number; groups: number } {
  const all = getTradeStatSnapshot();
  const groups = new Set(all.map((e) => e.type ?? ''));
  return { entries: all.length, groups: groups.size };
}
