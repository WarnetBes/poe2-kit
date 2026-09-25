/**
 * Библиотека выученных статов (community-learned stat library).
 *
 * Это «коллективная память» соответствий stat-id ↔ текст-шаблон trade2:
 *   data/game/learned/stat_text_map.json  { statId: "#-шаблон текста" }
 *
 * Откуда берутся данные: opt-in журнал обучения пользователей (см.
 * learnlog.ts) → дайджест `npm run contribute-items` → issue на SourceCraft →
 * валидация packages/core/merge-contributions.mjs → коммит в этот датасет.
 *
 * Зачем: каждый патч GGG меняет схему stat-id trade2 — матчинг модов раров
 * ломается до выхода фикса. Последний известный маппинг из библиотеки
 * держит прайс-чек раров на плаву (stale-if-error для каталога статов).
 *
 * Безопасность: файл — ТОЛЬКО данные (JSON, см. SECURITY.md), читается
 * через JSON.parse и никогда не исполняется; тексты шаблонов проходят
 * строгую валидацию в merge-contributions.mjs (только '#'-шаблоны
 * торговых статов, длина ≤ 160 символов, id-формат stat-*).
 */

import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';

export interface LearnedStatMapFile {
  version: number;
  /** Когда библиотека последний раз пополнялась (ISO или null). */
  updated?: string | null;
  entries: Record<string, string>;
}

export interface SimpleStatEntry {
  id: string;
  text: string;
}

function learnedPath(): string {
  return pathMod!.join(
    pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)),
    '..',
    'data',
    'game',
    'learned',
    'stat_text_map.json',
  );
}

let cache: SimpleStatEntry[] | null = null;

/** Выученные статы в виде записей каталога (совместимо с matchStatFilter).
 *  В браузере/без диска — пусто (есть только живой/HTTP путь). */
export function getLearnedStatTemplates(): SimpleStatEntry[] {
  if (!HAS_DISK) return [];
  if (cache) return cache;
  try {
    const raw = JSON.parse(fsMod!.readFileSync(learnedPath(), 'utf8')) as LearnedStatMapFile;
    const out: SimpleStatEntry[] = [];
    for (const [id, text] of Object.entries(raw.entries ?? {})) {
      if (typeof id === 'string' && typeof text === 'string' && text.includes('#')) {
        out.push({ id, text });
      }
    }
    cache = out;
    return out;
  } catch {
    return [];
  }
}

/** Сводка по библиотеке: сколько stat-id выучено сообществом. */
export function learnedStatsInfo(): { learnedStatIds: number; updatedAt: string | null } {
  if (!HAS_DISK) return { learnedStatIds: 0, updatedAt: null };
  try {
    const raw = JSON.parse(fsMod!.readFileSync(learnedPath(), 'utf8')) as LearnedStatMapFile;
    return {
      learnedStatIds: Object.keys(raw.entries ?? {}).length,
      updatedAt: raw.updated ?? null,
    };
  } catch {
    return { learnedStatIds: 0, updatedAt: null };
  }
}
