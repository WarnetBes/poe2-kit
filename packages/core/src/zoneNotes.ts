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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type { ClientGameState } from './log.js';
import type { LevelingZone } from './types.js';
import { getZonesByAct, nextZones, levelDiff, rewardsOf } from './leveling.js';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

interface RawZoneNote {
  lockNoteOption: string;
  zoneCode: string;
  zoneName: string;
  notes: string;
}

interface RawActNote {
  lockNoteOption: string;
  actName: string;
  notes: string;
}

let zoneCache: RawZoneNote[] | null = null;
let actCache: RawActNote[] | null = null;

function load(): { zoneNotes: RawZoneNote[]; actNotes: RawActNote[] } {
  if (!zoneCache || !actCache) {
    const raw = JSON.parse(readFileSync(path.join(dataDir, 'zoneNotes.json'), 'utf8')) as {
      zoneNotes?: RawZoneNote[];
      actNotes?: RawActNote[];
    };
    zoneCache = raw.zoneNotes ?? [];
    actCache = raw.actNotes ?? [];
  }
  return { zoneNotes: zoneCache, actNotes: actCache };
}

/** Заметка по коду зоны (G1_1, G1_2, ...). */
export function getZoneNote(zoneCode: string): { zoneName: string; notes: string } | null {
  const hit = load().zoneNotes.find((z) => z.zoneCode === zoneCode);
  return hit ? { zoneName: hit.zoneName, notes: hit.notes } : null;
}

/** Заметка по имени зоны (регистр не важен). */
export function getZoneNoteByName(zoneName: string): { zoneCode: string; zoneName: string; notes: string } | null {
  const q = zoneName.trim().toLowerCase();
  const hit = load().zoneNotes.find((z) => z.zoneName.toLowerCase() === q);
  return hit ? { zoneCode: hit.zoneCode, zoneName: hit.zoneName, notes: hit.notes } : null;
}

/** Заметка по акту (1..4) или Interludes. */
export function getActNote(act: number | 'Interludes'): { actName: string; notes: string } | null {
  const name = act === 'Interludes' ? act : `Act ${act}`;
  const hit = load().actNotes.find((a) => a.actName === name);
  return hit ? { actName: hit.actName, notes: hit.notes } : null;
}

/** Список всех заметок по зонам (для UI-оверлея — показать всё сразу). */
export function listZoneNotes(): Array<{ zoneCode: string; zoneName: string; notes: string }> {
  return load().zoneNotes.map((z) => ({ zoneCode: z.zoneCode, zoneName: z.zoneName, notes: z.notes }));
}

export interface LevelingContext {
  /** Есть ли живое состояние клиента. */
  available: boolean;
  /** Сводка состояния (персонаж/класс/уровень). */
  summary: string;
  /** Код и имя текущей зоны. */
  zone: { areaCode: string; zoneName: string | null } | null;
  /** Заметки текущей зоны (что сделать, каких боссов убить, награды). */
  zoneNotes: { zoneName: string; notes: string } | null;
  /** Сводные заметки акта (награды за квесты по всем зонам). */
  actNotes: { actName: string; notes: string } | null;
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
  const level = state?.level ?? null;

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
    // Первые строки заметок зоны — самые важные действия.
    const heads = zoneNotes.notes
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('['))
      .slice(0, 3);
    hints.push(...heads.map((h) => `📍 ${h}`));
  }
  for (const z of nextZonesWithMeta.slice(0, 3)) {
    const lvlHint = z.levelDelta != null ? (z.levelDelta > 2 ? ` (⚠️инг +${z.levelDelta} к уровню зоны)` : '') : '';
    hints.push(`➡️ ${z.zone}${lvlHint}${z.rewardList.length ? ` — награды: ${z.rewardList.join(', ')}` : ''}`);
  }

  return {
    available: !!state?.available,
    summary: state
      ? [state.character, state.klass, state.level ? `ур. ${state.level}` : null].filter(Boolean).join(' · ') || 'персонаж неизвестен'
      : 'клиент недоступен',
    zone: areaCode ? { areaCode, zoneName } : null,
    zoneNotes,
    actNotes,
    nextZones: nextZonesWithMeta,
    actZones: currentActZones,
    hints,
  };
}
