/**
 * Заметки по зонам и актам для прокачки PoE2.
 *
 * Данные: `data/zoneNotes.json` — перенос из
 * `_research/path-of-levelling-2/src/main/profiles/poe2/referenceData/zoneNotes.json`
 * (копирование разрешено; источник — сообщество path-of-levelling-2).
 *
 * Связка: log.ts (getClientState) → getLevelingContext() → заметки текущей
 * зоны + следующих зон + сводка акта. Это сердце «GemTracker»-напоминаний:
 * notes содержат, каких боссов убить и какие награды (гемы/пассивки) получить.
 */

import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';

import type { ClientGameState } from './log.js';
import type { LevelingZone } from './types.js';
import { getZonesByAct, nextZones, levelDiff, rewardsOf } from './leveling.js';

function dataDir(): string {
  return pathMod!.join(pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)), '..', 'data');
}

interface RawZoneNote {
  lockNoteOption: string;
  zoneCode: string;
  zoneName: string;
  notes: string;
  notes_ru?: string;
}

interface RawActNote {
  lockNoteOption: string;
  actName: string;
  notes: string;
  notes_ru?: string;
}

let zoneCache: RawZoneNote[] | null = null;
let actCache: RawActNote[] | null = null;

function load(): { zoneNotes: RawZoneNote[]; actNotes: RawActNote[] } {
  if (!zoneCache || !actCache) {
    const raw = JSON.parse(fsMod!.readFileSync(pathMod!.join(dataDir(), 'zoneNotes.json'), 'utf8')) as {
      zoneNotes?: RawZoneNote[];
      actNotes?: RawActNote[];
    };
    zoneCache = raw.zoneNotes ?? [];
    actCache = raw.actNotes ?? [];
  }
  return { zoneNotes: zoneCache, actNotes: actCache };
}

/** Заметка по коду зоны (G1_1, G1_2, ...). */
export function getZoneNote(zoneCode: string): { zoneName: string; notes: string; notes_ru?: string } | null {
  const hit = load().zoneNotes.find((z) => z.zoneCode === zoneCode);
  return hit ? { zoneName: hit.zoneName, notes: hit.notes, notes_ru: hit.notes_ru } : null;
}

/** Заметка по имени зоны (регистр не важен). */
export function getZoneNoteByName(zoneName: string): { zoneCode: string; zoneName: string; notes: string; notes_ru?: string } | null {
  const q = zoneName.trim().toLowerCase();
  const hit = load().zoneNotes.find((z) => z.zoneName.toLowerCase() === q);
  return hit ? { zoneCode: hit.zoneCode, zoneName: hit.zoneName, notes: hit.notes, notes_ru: hit.notes_ru } : null;
}

/** Заметка по акту (1..4) или Interludes. */
export function getActNote(act: number | 'Interludes'): { actName: string; notes: string; notes_ru?: string } | null {
  const name = act === 'Interludes' ? act : `Act ${act}`;
  const hit = load().actNotes.find((a) => a.actName === name);
  return hit ? { actName: hit.actName, notes: hit.notes, notes_ru: hit.notes_ru } : null;
}

/** Список всех заметок по зонам (для UI-оверлея — показать всё сразу). */
export function listZoneNotes(): Array<{ zoneCode: string; zoneName: string; notes: string; notes_ru?: string }> {
  return load().zoneNotes.map((z) => ({ zoneCode: z.zoneCode, zoneName: z.zoneName, notes: z.notes, notes_ru: z.notes_ru }));
}

export interface LevelingContext {
  /** Есть ли живое состояние клиента. */
  available: boolean;
  /** Сводка состояния (персонаж/класс/уровень). */
  summary: string;
  /** Код и имя текущей зоны. */
  zone: { areaCode: string; zoneName: string | null } | null;
  /** Заметки текущей зоны (что сделать, каких боссов убить, награды). */
  zoneNotes: { zoneName: string; notes: string; notes_ru?: string } | null;
  /** Сводные заметки акта (награды за квесты по всем зонам). */
  actNotes: { actName: string; notes: string; notes_ru?: string } | null;
  /** Следующие рекомендуемые зоны (для уровня персонажа). */
  nextZones: Array<LevelingZone & { rewardList: string[]; levelDelta: number | null }>;
  /** Зоны текущего акта (для оверлея). */
  actZones: LevelingZone[];
  /** Рекомендации-напоминания строкой (для MCP/AI). */
  hints: string[];
}

/**
 * Собрать «контекст прокачки» из состояния клиента (log.ts getClientState):
 * заметки текущей зоны/акта + следующие зоны для уровня персонажа.
 * Если state=null/недоступен — по actFallback (1..4).
 */
export function getLevelingContext(
  state: ClientGameState | null,
  opts: { actFallback?: number } = {},
): LevelingContext {
  const act = state?.act ?? opts.actFallback ?? 1;
  const areaCode = state?.zone?.areaCode ?? null;
  const zoneName = state?.zone?.zoneName ?? null;
  // PoE2 не пишет level_up в Client.txt (проверено на живом клиенте 29.09,
  // см. журнал КУБ-2 №20): state.level почти всегда null. Прокси — уровень
  // текущей зоны areaLevel (обычно ±2-3 от уровня персонажа при нормальном
  //progression), чтобы levelDelta для next-зон всё же считался.
  const level = state?.level ?? state?.zone?.areaLevel ?? null;

  const zoneNotes = areaCode ? getZoneNote(areaCode) : zoneName ? getZoneNoteByName(zoneName) : null;
  const actNotes = getActNote(act);

  const currentActZones = getZonesByAct(act);
  const nz = nextZones(act, zoneName ?? undefined);
  const nextZonesWithMeta = nz.map((z) => ({
    ...z,
    rewardList: rewardsOf(z.zone),
    levelDelta: level != null ? levelDiff(level, z) : null,
  }));

  const hints: string[] = [];
  if (zoneNotes) {
    // Для русского вывода предпочитаем русскую сводку; первые строки — важные действия.
    const src = zoneNotes.notes_ru ?? zoneNotes.notes;
    const heads = src
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('[') && !l.startsWith('•'))
      .slice(0, 3);
    hints.push(...heads.map((h) => `📍 ${h}`));
  }
  if (actNotes?.notes_ru) {
    // Краткая русская сводка акта: берём первый реальный пункт награды (строку после заголовка).
    const firstReward =
      actNotes.notes_ru
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('•')) ?? actNotes.notes_ru.split('\n')[0];
    hints.push(`🗂 Акт-награды: ${firstReward.replace(/^•\s*/, '')}`);
  }
  for (const z of nextZonesWithMeta.slice(0, 3)) {
    const lvlHint = z.levelDelta != null ? (z.levelDelta > 2 ? ` (⚠️инг +${z.levelDelta} к уровню зоны)` : '') : '';
    hints.push(`➡️ ${z.zone}${lvlHint}${z.rewardList.length ? ` — награды: ${z.rewardList.join(', ')}` : ''}`);
  }

  return {
    available: !!state?.available,
    summary: state
      ? // Персонаж из лога PoE2 недоступен (level_up не пишется): показываем
        // фактический контекст — зону и её уровень вместо «персонаж неизвестен».
        [
          state.character ? [state.character, state.klass, state.level ? `ур. ${state.level}` : null].filter(Boolean).join(' · ') : null,
          state.character ? null : zoneName,
          state.character || !state.zone ? null : state.zone.areaLevel ? `зона ур. ${state.zone.areaLevel}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'персонаж неизвестен'
      : 'клиент недоступен',
    zone: areaCode ? { areaCode, zoneName } : null,
    zoneNotes,
    actNotes,
    nextZones: nextZonesWithMeta,
    actZones: currentActZones,
    hints,
  };
}
