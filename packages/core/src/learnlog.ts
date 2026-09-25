/**
 * Журнал обучения (learn log) — opt-in сбор знаний о предметах.
 *
 * Зачем: у PoE2-инструментов самая хрупкая часть — соответствие
 * «текст мода ↔ stat-id trade2» и «имя ↔ база ↔ категория». Каждый патч
 * GGG меняет схему stat-id, и прайс-чек раров ломается. Чем больше живых
 * предметов видит kit — тем точнее офлайн-библиотека.
 *
 * Приватность (важно, см. docs/CONTRIBUTING.md):
 *   - сбор ВЫКЛЮЧЕН по умолчанию; включается env POE2K_LEARN=1;
 *   - пишется только структура предмета (редкость/база/класс/моды/стат-id),
 *     БЕЗ имени персонажа, аккаунта, лиги профиля и т.п.;
 *   - журнал локальный (JSONL в ~/.poe2-kit/learn), никуда не отправляется
 *     сам по себе — пользователь сам формирует дайджест `npm run
 *     contribute-items` и прикладывает его к issue.
 *
 * Каталог: env POE2_KIT_LEARN_DIR, иначе <homedir>/.poe2-kit/learn.
 */

import { HAS_DISK, fsMod, osMod, pathMod } from './nodeenv.js';

/** Одна запись журнала: предмет, который пользователь проверил прайс-чеком. */
export interface LearnedItemEntry {
  /** Время проверки (ISO 8601). */
  at: string;
  /** Лига, в которой проверяли. */
  league?: string | null;
  /** Откуда вызван прайс-чек: 'overlay' | 'web' | 'mcp' | 'cli'. */
  source?: string;
  /** Редкость: Unique/Rare/Currency/… */
  rarity: string;
  /** Имя (Unique/Rare) или null. НЕ персонаж — имя предмета. */
  name?: string | null;
  /** Базовый тип. */
  baseType: string;
  /** Item Class, например "Body Armours". */
  itemClass?: string | null;
  /** Item Level предмета. */
  itemLevel?: number | null;
  /** Требуемый уровень. */
  reqLevel?: number | null;
  /** Тексты explicit-модов. */
  mods: string[];
  /** Stat-id trade2, которые матчились по explicit-модам. */
  statIds?: string[];
}

/** Дайджест для вклада в библиотеку (то, что отправляется мейнтейнеру). */
export interface ItemContribution {
  /** Формат дайджеста. */
  version: 1;
  /** Когда сформирован. */
  generatedAt: string;
  /** Версия kit (из package.json, для совместимости). */
  kitVersion?: string;
  /** Лиги, в которых проверялись предметы (для контекста данных). */
  leagues: string[];
  /** Дедуплицированные «формы» предметов. */
  entries: LearnedItemEntry[];
}

const JSONL_NAME = 'items.jsonl';
const MAX_CONTRIB_ENTRIES = 5000;

/** Включён ли журнал обучения (opt-in: env POE2K_LEARN=1/true/yes). */
export function isLearnEnabled(): boolean {
  if (!HAS_DISK) return false;
  const v = (process.env['POE2K_LEARN'] ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function learnDir(): string | null {
  if (!HAS_DISK) return null;
  const fs = fsMod!;
  const dir =
    process.env['POE2_KIT_LEARN_DIR'] ??
    pathMod!.join(osMod!.homedir(), '.poe2-kit', 'learn');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

/** Записать проверенный предмет в локальный журнал (best-effort, без throw).
 *  Ничего не делает, если сбор не включён (opt-in) или нет диска. */
export function recordLearnedItem(entry: LearnedItemEntry): void {
  if (!isLearnEnabled()) return;
  const dir = learnDir();
  if (!dir) return;
  try {
    // санитайз: обрезаем строки, чтобы журнал не разрастался от мусора
    const safe: LearnedItemEntry = {
      at: new Date().toISOString(),
      league: entry.league ?? undefined,
      source: entry.source ?? undefined,
      rarity: String(entry.rarity ?? 'Unknown').slice(0, 32),
      name: entry.name ? String(entry.name).slice(0, 128) : null,
      baseType: String(entry.baseType ?? 'Unknown').slice(0, 128),
      itemClass: entry.itemClass ? String(entry.itemClass).slice(0, 64) : null,
      itemLevel: typeof entry.itemLevel === 'number' ? entry.itemLevel : null,
      reqLevel: typeof entry.reqLevel === 'number' ? entry.reqLevel : null,
      mods: (entry.mods ?? [])
        .filter((m) => typeof m === 'string' && m.trim())
        .map((m) => m.slice(0, 256))
        .slice(0, 24),
      statIds: (entry.statIds ?? [])
        .filter((id) => typeof id === 'string' && /^[\w.\-]{1,64}$/.test(id))
        .slice(0, 24),
    };
    fsMod!.appendFileSync(
      pathMod!.join(dir, JSONL_NAME),
      JSON.stringify(safe) + '\n',
      'utf8',
    );
  } catch {
    // журнал обучения никогда не ломает прайс-чек
  }
}

/** Прочитать журнал: последние `limit` записей (по умолчанию все). */
export function readLearnedItems(limit?: number): LearnedItemEntry[] {
  const dir = learnDir();
  if (!dir) return [];
  try {
    const raw = fsMod!.readFileSync(pathMod!.join(dir, JSONL_NAME), 'utf8');
    const out: LearnedItemEntry[] = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t) as LearnedItemEntry);
      } catch {
        // битая строка — пропускаем, журнал не должен ломать дайджест
      }
    }
    return typeof limit === 'number' && limit > 0 ? out.slice(-limit) : out;
  } catch {
    return [];
  }
}

/** Ключ дедупликации: форма предмета без времени/лиги/значений роллов. */
function shapeKey(e: LearnedItemEntry): string {
  const norm = (s: string) =>
    s.toLowerCase().replace(/\d+(?:\.\d+)?/g, '#').replace(/\s+/g, ' ').trim();
  return [
    e.rarity,
    e.name ?? '',
    e.baseType,
    e.mods.map(norm).sort().join('|'),
  ].join('\u0001');
}

/** Сформировать дайджест-вклад в библиотеку из локального журнала
 *  (дедуп по «форме» предмета: числа роллов нормализуются в #). */
export function buildItemContribution(items?: LearnedItemEntry[]): ItemContribution {
  const all = items ?? readLearnedItems();
  const byShape = new Map<string, LearnedItemEntry>();
  const leagues = new Set<string>();
  for (const e of all) {
    if (e.baseType == null) continue;
    const k = shapeKey(e);
    if (!k) continue;
    const cur = byShape.get(k);
    // держим самую свежую запись формы (у неё самые актуальные stat-id)
    if (!cur || (e.at ?? '') > (cur.at ?? '')) byShape.set(k, e);
    if (e.league) leagues.add(e.league);
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    leagues: Array.from(leagues).sort(),
    entries: Array.from(byShape.values()).slice(0, MAX_CONTRIB_ENTRIES),
  };
}

/** Сводка журнала (для диагностики/MCP): сколько записей, где лежит. */
export function learnLogInfo(): {
  enabled: boolean;
  records: number;
  dir: string | null;
} {
  const dir = hasLearnDir();
  return {
    enabled: isLearnEnabled(),
    records: dir ? readLearnedItems().length : 0,
    dir,
  };
}

function hasLearnDir(): string | null {
  if (!HAS_DISK) return null;
  const dir =
    process.env['POE2_KIT_LEARN_DIR'] ??
    pathMod!.join(osMod!.homedir(), '.poe2-kit', 'learn');
  return fsMod!.existsSync(dir) ? dir : null;
}
